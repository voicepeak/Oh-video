import { mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { cineSpecSchema } from "../shared/cinespec";
import { compileCineSpec } from "./compiler";
import { config } from "./config";
import { db, queries, refundRun, reserveCredit, serializeRun, type AssetRow } from "./db";
import { createShotPlan, isLlmConfigured } from "./llm";
import { createWanTask, getWanTask, isWanConfigured } from "./wan";

const app = new Hono();
app.use("/api/*", cors({ origin: ["http://127.0.0.1:5174", "http://localhost:5174"] }));

const jsonError = (message: string, status: 400 | 404 | 409 | 500 | 503 = 400) =>
  Response.json({ error: message }, { status });

const assetJson = (asset: AssetRow) => ({
  id: asset.id,
  name: asset.name,
  mimeType: asset.mime_type,
  categoryId: asset.category_id,
  source: asset.source,
  createdAt: asset.created_at,
  contentUrl: `/api/assets/${asset.id}/content`,
});

app.get("/api/health", (c) => c.json({
  ok: true,
  wanConfigured: isWanConfigured(),
  wanModel: config.wanModel,
  analysisMode: isLlmConfigured() ? "llm" : "mcp_manual",
  llmModel: isLlmConfigured() ? config.llmModel : null,
  credits: queries.getCredits(),
}));

app.post("/api/agent/suggestions", async (c) => {
  const parsed = cineSpecSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError("CineSpec 格式无效。") as never;
  if (!isLlmConfigured()) return jsonError("LLM 尚未配置。当前请使用 Codex MCP 协作填写镜头结构。", 503) as never;
  try {
    return c.json({ plan: await createShotPlan(parsed.data) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "LLM 分析失败。", 503) as never;
  }
});

app.post("/api/compile", async (c) => {
  const parsed = cineSpecSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError("CineSpec 格式无效。") as never;
  return c.json(compileCineSpec(parsed.data));
});

app.get("/api/categories", (c) => c.json({ categories: queries.listCategories() }));

app.post("/api/categories", async (c) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(30) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError("分类名需要 1–30 个字符。") as never;
  try {
    const result = db.query("INSERT INTO asset_categories (name) VALUES (?) RETURNING id, name, created_at").get(parsed.data.name);
    return c.json({ category: result }, 201);
  } catch {
    return jsonError("这个分类已经存在。", 409) as never;
  }
});

app.patch("/api/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = z.object({ name: z.string().trim().min(1).max(30) }).safeParse(await c.req.json().catch(() => null));
  if (!Number.isInteger(id) || !parsed.success) return jsonError("分类参数无效。") as never;
  try {
    const result = db.query("UPDATE asset_categories SET name = ? WHERE id = ?").run(parsed.data.name, id);
    if (!result.changes) return jsonError("分类不存在。", 404) as never;
    return c.json({ ok: true });
  } catch {
    return jsonError("这个分类已经存在。", 409) as never;
  }
});

app.delete("/api/categories/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return jsonError("分类参数无效。") as never;
  const result = db.query("DELETE FROM asset_categories WHERE id = ?").run(id);
  if (!result.changes) return jsonError("分类不存在。", 404) as never;
  return c.json({ ok: true });
});

app.get("/api/assets", (c) => {
  const raw = c.req.query("categoryId");
  const categoryId = raw ? Number(raw) : undefined;
  return c.json({ assets: queries.listAssets(categoryId).map(assetJson) });
});

app.post("/api/assets", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return jsonError("请选择要上传的图片或视频。") as never;
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return jsonError("仅支持图片和视频。") as never;
  if (file.size > 30 * 1024 * 1024) return jsonError("MVP 单个素材不能超过 30MB。") as never;
  const categoryRaw = form.get("categoryId");
  const categoryId = categoryRaw ? Number(categoryRaw) : null;
  const id = crypto.randomUUID();
  const safeExt = extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 8);
  const path = join(config.dataDir, "assets", `${id}${safeExt}`);
  await Bun.write(path, file);
  db.query(`INSERT INTO assets (id, name, mime_type, file_path, category_id, source) VALUES (?, ?, ?, ?, ?, 'upload')`)
    .run(id, file.name.slice(0, 200), file.type, path, categoryId);
  return c.json({ asset: assetJson(queries.getAsset(id)!) }, 201);
});

app.get("/api/assets/:id/content", (c) => {
  const asset = queries.getAsset(c.req.param("id"));
  if (!asset) return jsonError("素材不存在。", 404) as never;
  const file = Bun.file(asset.file_path);
  return new Response(file, { headers: { "Content-Type": asset.mime_type, "Cache-Control": "private, max-age=3600" } });
});

const runRequestSchema = z.object({
  spec: cineSpecSchema,
  referenceAssetId: z.string().uuid().nullable().optional(),
  outputCategoryId: z.number().int().positive().nullable().optional(),
});

async function assetToDataUrl(id: string) {
  const asset = queries.getAsset(id);
  if (!asset || !asset.mime_type.startsWith("image/")) throw new Error("参考图素材不存在或不是图片。");
  const bytes = await Bun.file(asset.file_path).arrayBuffer();
  return `data:${asset.mime_type};base64,${Buffer.from(bytes).toString("base64")}`;
}

app.get("/api/runs", (c) => c.json({ runs: queries.listRuns().map(serializeRun) }));

app.post("/api/runs", async (c) => {
  if (!isWanConfigured()) return jsonError("尚未配置阿里云 API Key 与业务空间 Endpoint，先在 .env 中配置后再提交。", 503) as never;
  const parsed = runRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return jsonError("生成参数无效。") as never;
  if (!parsed.data.spec.brief.trim()) return jsonError("请先填写创作意图。") as never;
  if (parsed.data.spec.mode === "reference_to_video" && !parsed.data.referenceAssetId) {
    return jsonError("参考图模式必须选择一张图片。") as never;
  }

  const compiled = compileCineSpec(parsed.data.spec);
  const runId = crypto.randomUUID();
  try {
    reserveCredit(runId, JSON.stringify(parsed.data.spec), compiled.prompt, parsed.data.outputCategoryId ?? null);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "次数不足。", 409) as never;
  }

  try {
    const referenceDataUrl = parsed.data.referenceAssetId ? await assetToDataUrl(parsed.data.referenceAssetId) : undefined;
    const taskId = await createWanTask(parsed.data.spec, compiled.prompt, referenceDataUrl);
    db.query("UPDATE workflow_runs SET status = 'processing', provider_task_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(taskId, runId);
    return c.json({ run: serializeRun(queries.getRun(runId)!), credits: queries.getCredits() }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "提交失败。";
    refundRun(runId, message);
    return jsonError(message, 503) as never;
  }
});

async function finishSucceededRun(runId: string, videoUrl: string) {
  const row = queries.getRun(runId);
  if (!row || row.status === "succeeded") return;
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`生成成功，但视频下载失败：HTTP ${response.status}`);
  const id = crypto.randomUUID();
  const path = join(config.dataDir, "assets", `${id}.mp4`);
  await mkdir(join(config.dataDir, "assets"), { recursive: true });
  await Bun.write(path, response);
  db.transaction(() => {
    db.query(`INSERT INTO assets (id, name, mime_type, file_path, category_id, source) VALUES (?, ?, 'video/mp4', ?, ?, 'generated')`)
      .run(id, `生成视频 ${runId.slice(0, 8)}.mp4`, path, row.output_category_id);
    db.query("UPDATE workflow_runs SET status = 'succeeded', output_asset_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(id, runId);
  })();
}

app.get("/api/runs/:id", async (c) => {
  let row = queries.getRun(c.req.param("id"));
  if (!row) return jsonError("任务不存在。", 404) as never;
  if (row.status === "processing" && row.provider_task_id) {
    try {
      const state = await getWanTask(row.provider_task_id);
      if (state.status === "succeeded" && state.videoUrl) await finishSucceededRun(row.id, state.videoUrl);
      if (state.status === "failed") refundRun(row.id, state.error || "生成失败。");
      row = queries.getRun(row.id)!;
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "任务查询失败。", 503) as never;
    }
  }
  return c.json({ run: serializeRun(row), credits: queries.getCredits() });
});

app.get("*", async (c) => {
  const path = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
  const distDir = resolve(process.cwd(), "dist");
  const candidate = resolve(distDir, path);
  if (candidate !== distDir && !candidate.startsWith(`${distDir}/`)) return c.text("Not found", 404);
  const file = Bun.file(candidate);
  if (await file.exists()) return new Response(file);
  const index = Bun.file(join(process.cwd(), "dist", "index.html"));
  if (await index.exists()) return new Response(index, { headers: { "Content-Type": "text/html" } });
  return c.text("CineSpec API is running. Start Vite on port 5174 for the web interface.");
});

console.log(`CineSpec API · http://127.0.0.1:${config.port}`);
console.log(isWanConfigured() ? `Wan adapter · ${config.wanModel}` : "Wan adapter · not configured");

export default { port: config.port, hostname: "127.0.0.1", fetch: app.fetch };
