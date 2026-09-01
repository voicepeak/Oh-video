import type { CineSpec, ShotPlan } from "../../shared/cinespec";

export type Health = {
  ok: true;
  wanConfigured: boolean;
  wanModel: string;
  analysisMode: "llm" | "mcp_manual";
  llmModel: string | null;
  credits: number;
};
export type Category = { id: number; name: string; created_at: string };
export type Asset = {
  id: string;
  name: string;
  mimeType: string;
  categoryId: number | null;
  source: "upload" | "generated";
  createdAt: string;
  contentUrl: string;
};
export type Compiled = { prompt: string; negativePrompt: string | null; warnings: string[]; costCredits: number };
export type Run = {
  id: string;
  status: "submitting" | "processing" | "succeeded" | "failed";
  spec: CineSpec;
  prompt: string;
  providerTaskId: string | null;
  outputAssetId: string | null;
  error: string | null;
  creditCharged: number;
  refunded: boolean;
  createdAt: string;
  updatedAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`);
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  health: () => request<Health>("/api/health"),
  categories: () => request<{ categories: Category[] }>("/api/categories"),
  createCategory: (name: string) => request<{ category: Category }>("/api/categories", json("POST", { name })),
  renameCategory: (id: number, name: string) => request<{ ok: true }>(`/api/categories/${id}`, json("PATCH", { name })),
  deleteCategory: (id: number) => request<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE" }),
  assets: (categoryId?: number) => request<{ assets: Asset[] }>(`/api/assets${categoryId ? `?categoryId=${categoryId}` : ""}`),
  uploadAsset: (file: File, categoryId: number | null) => {
    const body = new FormData();
    body.set("file", file);
    if (categoryId) body.set("categoryId", String(categoryId));
    return request<{ asset: Asset }>("/api/assets", { method: "POST", body });
  },
  suggestions: (spec: CineSpec) => request<{ plan: ShotPlan }>("/api/agent/suggestions", json("POST", spec)),
  compile: (spec: CineSpec) => request<Compiled>("/api/compile", json("POST", spec)),
  createRun: (spec: CineSpec, referenceAssetId: string | null, outputCategoryId: number | null) =>
    request<{ run: Run; credits: number }>("/api/runs", json("POST", { spec, referenceAssetId, outputCategoryId })),
  getRun: (id: string) => request<{ run: Run; credits: number }>(`/api/runs/${id}`),
  runs: () => request<{ runs: Run[] }>("/api/runs"),
};
