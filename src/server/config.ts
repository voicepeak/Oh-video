import { resolve } from "node:path";

const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const runtimeEnv = typeof Bun !== "undefined" ? Bun.env : process.env;

export const config = {
  port: numberFromEnv(runtimeEnv.PORT, 8788),
  dataDir: resolve(runtimeEnv.APP_DATA_DIR || ".data"),
  startingCredits: numberFromEnv(runtimeEnv.STARTING_CREDITS, 3),
  dashscopeApiKey: runtimeEnv.DASHSCOPE_API_KEY?.trim() || "",
  dashscopeBaseUrl: (runtimeEnv.DASHSCOPE_BASE_URL || "").replace(/\/$/, ""),
  wanModel: runtimeEnv.WAN_MODEL?.trim() || "wan3.0-video",
  llmBaseUrl: runtimeEnv.LLM_BASE_URL?.trim().replace(/\/$/, "") || "",
  llmApiKey: runtimeEnv.LLM_API_KEY?.trim() || "",
  llmModel: runtimeEnv.LLM_MODEL?.trim() || "",
};
