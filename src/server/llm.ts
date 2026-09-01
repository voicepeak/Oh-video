import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  agentSuggestionSchema,
  applyAgentSuggestion,
  shotPlanSchema,
  type AgentSuggestion,
  type CineSpec,
  type ShotPlan,
} from "../shared/cinespec";
import { config } from "./config";

export const shotPlannerPrompt = readFileSync(
  new URL("./prompts/shot-planner-v1.md", import.meta.url),
  "utf8",
).trim();

const rawShotPlanSchema = shotPlanSchema.omit({ suggestions: true }).extend({
  suggestions: z.array(z.unknown()).max(30),
});

const getAtPath = (source: CineSpec, path: string) => path.slice(1).split("/").reduce<unknown>((current, key) => {
  if (!current || typeof current !== "object") return undefined;
  return (current as Record<string, unknown>)[key];
}, source);

const isMissing = (value: unknown) => value === null || value === undefined || value === "";

export function isLlmConfigured() {
  return Boolean(config.llmBaseUrl && config.llmApiKey && config.llmModel);
}

export function sanitizeSuggestions(spec: CineSpec, input: unknown): AgentSuggestion[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.flatMap((candidate) => {
    const parsed = agentSuggestionSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data.path) || !isMissing(getAtPath(spec, parsed.data.path))) return [];
    try {
      applyAgentSuggestion(spec, parsed.data);
    } catch {
      return [];
    }
    seen.add(parsed.data.path);
    return [parsed.data];
  });
}

function parseJsonContent(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

const normalizeNegativeConstraint = (value: string) => value
  .replace(/^(?:禁止|不要|避免出现[:：]?|不得|不可)/, "")
  .replace(/^不(?=循环|返回|原地|重复|人物|身份|瞬移|运动方向|肢体)/, "")
  .trim();

export function normalizeShotPlan(spec: CineSpec, input: unknown): ShotPlan {
  const raw = rawShotPlanSchema.parse(input);
  const plan = shotPlanSchema.parse({
    ...raw,
    suggestions: sanitizeSuggestions(spec, raw.suggestions),
  });

  if (plan.subjectCount !== plan.continuityLocks.subjectCount) {
    throw new Error("Shot Planner 返回的人物数量与连续性锁不一致。");
  }

  const timeline = [...plan.timeline].sort((a, b) => a.start - b.start);
  if (spec.duration >= 8 && timeline.length !== 3) {
    throw new Error("10 秒镜头必须拆成恰好 3 个连续时间段。");
  }
  const epsilon = 0.01;
  if (
    Math.abs(timeline[0].start) > epsilon
    || Math.abs(timeline.at(-1)!.end - spec.duration) > epsilon
    || timeline.some((beat) => beat.end <= beat.start)
    || timeline.slice(1).some((beat, index) => Math.abs(beat.start - timeline[index].end) > epsilon)
  ) {
    throw new Error("Shot Planner 时间轴存在重叠、空档或倒序。");
  }

  const negativeConstraints = [...new Set(plan.negativeConstraints.map(normalizeNegativeConstraint).filter(Boolean))];
  return { ...plan, timeline, negativeConstraints };
}

export async function createShotPlan(spec: CineSpec, previousFailures: string[] = []): Promise<ShotPlan> {
  if (!isLlmConfigured()) throw new Error("LLM 尚未配置。当前请使用 Codex MCP 协作填写镜头结构。");

  const response = await fetch(`${config.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.llmModel,
      temperature: 0.2,
      max_tokens: 4096,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: shotPlannerPrompt },
        {
          role: "user",
          content: JSON.stringify({
            targetModel: "wan3.0-video",
            duration: spec.duration,
            resolution: spec.resolution,
            mode: spec.mode,
            currentSpec: spec,
            previousFailures,
          }),
        },
      ],
    }),
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const nested = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : null;
    throw new Error(`LLM 返回错误：${String(nested?.message || body.message || `HTTP ${response.status}`)}`);
  }
  const choices = Array.isArray(body.choices) ? body.choices as Array<{ message?: { content?: string } }> : [];
  const content = choices[0]?.message?.content;
  if (!content) throw new Error("LLM 没有返回可解析的镜头计划。");
  return normalizeShotPlan(spec, parseJsonContent(content));
}
