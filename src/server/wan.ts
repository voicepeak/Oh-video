import type { CineSpec } from "../shared/cinespec";
import { config } from "./config";

type JsonRecord = Record<string, unknown>;

async function providerRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${config.dashscopeBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.dashscopeApiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) {
    const message = String(body.message || body.code || `HTTP ${response.status}`);
    throw new Error(`阿里云视频接口返回错误：${message}`);
  }
  return body;
}

export function isWanConfigured() {
  return Boolean(config.dashscopeApiKey && config.dashscopeBaseUrl && !config.dashscopeBaseUrl.includes("YOUR_WORKSPACE_ID"));
}

export async function createWanTask(spec: CineSpec, prompt: string, referenceDataUrl?: string) {
  if (!isWanConfigured()) throw new Error("尚未配置 DASHSCOPE_API_KEY 与业务空间 Endpoint，当前只能调试到提示词编译。");
  const media = referenceDataUrl ? [{ type: "reference_image", url: referenceDataUrl }] : undefined;
  const body = await providerRequest("/api/v1/services/aigc/video-generation/video-synthesis", {
    method: "POST",
    headers: { "X-DashScope-Async": "enable" },
    body: JSON.stringify({
      model: config.wanModel,
      input: { prompt, ...(media ? { media } : {}) },
      parameters: {
        resolution: spec.resolution,
        duration: spec.duration,
        ratio: spec.aspectRatio,
        audio: spec.audio.enabled,
        prompt_extend: false,
        watermark: false,
      },
    }),
  });
  const output = (body.output || {}) as JsonRecord;
  const taskId = String(output.task_id || "");
  if (!taskId) throw new Error("阿里云未返回 task_id。请检查模型名与请求参数。");
  return taskId;
}

export type WanTaskState = { status: "processing" | "succeeded" | "failed"; videoUrl?: string; error?: string };

export async function getWanTask(taskId: string): Promise<WanTaskState> {
  const body = await providerRequest(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
  const output = (body.output || {}) as JsonRecord;
  const rawStatus = String(output.task_status || "").toUpperCase();
  if (["PENDING", "RUNNING", "UNKNOWN"].includes(rawStatus)) return { status: "processing" };
  if (rawStatus === "SUCCEEDED") {
    const results = Array.isArray(output.results) ? output.results as JsonRecord[] : [];
    const videoUrl = String(output.video_url || results[0]?.url || results[0]?.video_url || "");
    if (!videoUrl) return { status: "failed", error: "任务成功但响应中没有视频地址。" };
    return { status: "succeeded", videoUrl };
  }
  return {
    status: "failed",
    error: String(output.message || output.code || body.message || `任务状态：${rawStatus || "未知"}`),
  };
}
