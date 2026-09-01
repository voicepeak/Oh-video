import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export type CategoryRow = { id: number; name: string; created_at: string };
export type AssetRow = {
  id: string;
  name: string;
  mime_type: string;
  file_path: string;
  category_id: number | null;
  source: "upload" | "generated";
  created_at: string;
};
export type RunRow = {
  id: string;
  status: "submitting" | "processing" | "succeeded" | "failed";
  spec_json: string;
  prompt: string;
  provider_task_id: string | null;
  output_asset_id: string | null;
  output_category_id: number | null;
  error: string | null;
  credit_charged: number;
  refunded: number;
  created_at: string;
  updated_at: string;
};

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(join(config.dataDir, "assets"), { recursive: true });

export const db = new Database(join(config.dataDir, "cinespec.sqlite"), { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
  CREATE TABLE IF NOT EXISTS user_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    credits INTEGER NOT NULL CHECK (credits >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT,
    delta INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS asset_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    category_id INTEGER REFERENCES asset_categories(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('upload', 'generated')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    prompt TEXT NOT NULL,
    provider_task_id TEXT,
    output_asset_id TEXT REFERENCES assets(id),
    output_category_id INTEGER REFERENCES asset_categories(id) ON DELETE SET NULL,
    error TEXT,
    credit_charged INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
db.query("INSERT OR IGNORE INTO user_account (id, credits) VALUES (1, ?)").run(config.startingCredits);

export const queries = {
  getCredits: () => (db.query("SELECT credits FROM user_account WHERE id = 1").get() as { credits: number }).credits,
  listCategories: () => db.query("SELECT id, name, created_at FROM asset_categories ORDER BY name").all() as CategoryRow[],
  listAssets: (categoryId?: number) => {
    if (categoryId !== undefined) {
      return db.query("SELECT * FROM assets WHERE category_id = ? ORDER BY created_at DESC").all(categoryId) as AssetRow[];
    }
    return db.query("SELECT * FROM assets ORDER BY created_at DESC").all() as AssetRow[];
  },
  getAsset: (id: string) => db.query("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | null,
  getRun: (id: string) => db.query("SELECT * FROM workflow_runs WHERE id = ?").get(id) as RunRow | null,
  listRuns: () => db.query("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 30").all() as RunRow[],
};

export const reserveCredit = db.transaction((runId: string, specJson: string, prompt: string, categoryId: number | null) => {
  const result = db.query("UPDATE user_account SET credits = credits - 1 WHERE id = 1 AND credits >= 1").run();
  if (result.changes !== 1) throw new Error("次数不足，请充值后再提交。");
  db.query("INSERT INTO credit_ledger (run_id, delta, kind) VALUES (?, -1, 'reserve')").run(runId);
  db.query(`
    INSERT INTO workflow_runs (id, status, spec_json, prompt, output_category_id, credit_charged)
    VALUES (?, 'submitting', ?, ?, ?, 1)
  `).run(runId, specJson, prompt, categoryId);
});

export const refundRun = db.transaction((runId: string, error: string) => {
  const row = queries.getRun(runId);
  if (!row || row.refunded || !row.credit_charged) return;
  db.query("UPDATE user_account SET credits = credits + 1 WHERE id = 1").run();
  db.query("INSERT INTO credit_ledger (run_id, delta, kind) VALUES (?, 1, 'refund')").run(runId);
  db.query("UPDATE workflow_runs SET status = 'failed', refunded = 1, error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(error, runId);
});

export function serializeRun(row: RunRow) {
  return {
    id: row.id,
    status: row.status,
    spec: JSON.parse(row.spec_json),
    prompt: row.prompt,
    providerTaskId: row.provider_task_id,
    outputAssetId: row.output_asset_id,
    error: row.error,
    creditCharged: row.credit_charged,
    refunded: Boolean(row.refunded),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

