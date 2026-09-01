import { z } from "zod";

export const videoModes = ["text_to_video", "reference_to_video"] as const;
export const shotSizes = ["extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"] as const;
export const cameraAngles = ["eye_level", "low", "high", "overhead", "dutch", "over_shoulder"] as const;
export const cameraMovements = [
  "fixed",
  "dolly_in",
  "dolly_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "truck_left",
  "truck_right",
  "orbit",
  "handheld",
] as const;
export const depthOfFields = ["shallow", "normal", "deep"] as const;
export const motionSpeeds = ["slow", "normal", "fast"] as const;

const optionalText = z.string().trim().max(500).nullable();

export const identityLockSchema = z.object({
  id: z.string().trim().min(1).max(20),
  visibleTrait: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
});

export const spatialContinuitySchema = z.object({
  start: z.string().trim().max(300).nullable(),
  direction: z.string().trim().max(300).nullable(),
  end: z.string().trim().max(300).nullable(),
  forbidden: z.array(z.string().trim().min(1).max(120)).max(12),
});

export const continuitySchema = z.object({
  subjectCount: z.number().int().min(1).max(10).nullable(),
  identity: z.array(identityLockSchema).max(10),
  spatial: spatialContinuitySchema,
});

export const timelineBeatSchema = z.object({
  start: z.number().min(0).max(30),
  end: z.number().min(0).max(30),
  subjectAction: z.string().trim().min(1).max(500),
  cameraAction: z.string().trim().min(1).max(500),
  endState: z.string().trim().min(1).max(500),
});

export const emptyContinuity: z.input<typeof continuitySchema> = {
  subjectCount: null,
  identity: [],
  spatial: { start: null, direction: null, end: null, forbidden: [] },
};

export const cineSpecSchema = z.object({
  version: z.literal("0.1"),
  mode: z.enum(videoModes),
  brief: z.string().trim().max(1000),
  duration: z.literal(10),
  resolution: z.literal("480P"),
  aspectRatio: z.enum(["adaptive", "16:9", "9:16", "1:1"]),
  subject: z.object({
    description: optionalText,
    action: optionalText,
    identityLock: z.boolean(),
  }),
  scene: z.object({
    environment: optionalText,
    time: optionalText,
    atmosphere: optionalText,
  }),
  cinematography: z.object({
    shotSize: z.enum(shotSizes).nullable(),
    cameraAngle: z.enum(cameraAngles).nullable(),
    lensMm: z.union([z.literal(18), z.literal(24), z.literal(35), z.literal(50), z.literal(85), z.literal(135)]).nullable(),
    depthOfField: z.enum(depthOfFields).nullable(),
    movement: z.enum(cameraMovements).nullable(),
    motionSpeed: z.enum(motionSpeeds).nullable(),
  }),
  look: z.object({
    style: optionalText,
    lighting: optionalText,
    color: optionalText,
    mood: optionalText,
  }),
  audio: z.object({
    enabled: z.boolean(),
    ambience: optionalText,
  }),
  negativePrompt: optionalText,
  continuity: continuitySchema.default(emptyContinuity),
  timeline: z.array(timelineBeatSchema).max(6).default([]),
});

export type CineSpec = z.infer<typeof cineSpecSchema>;

export const agentPatchPaths = [
  "/subject/description",
  "/subject/action",
  "/scene/environment",
  "/scene/time",
  "/scene/atmosphere",
  "/cinematography/shotSize",
  "/cinematography/cameraAngle",
  "/cinematography/lensMm",
  "/cinematography/depthOfField",
  "/cinematography/movement",
  "/cinematography/motionSpeed",
  "/look/style",
  "/look/lighting",
  "/look/color",
  "/look/mood",
  "/audio/ambience",
  "/negativePrompt",
] as const;

export const agentSuggestionSchema = z.object({
  id: z.string().min(1),
  path: z.enum(agentPatchPaths),
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export type AgentSuggestion = z.infer<typeof agentSuggestionSchema>;

export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export const shotPlanSchema = z.object({
  promptVersion: z.literal("shot-planner-v1"),
  intentSummary: z.string().trim().min(1).max(500),
  subjectCount: z.number().int().min(1).max(10),
  complexity: z.object({
    level: riskLevelSchema,
    reasons: z.array(z.string().trim().min(1).max(300)).max(10),
  }),
  loopRisk: z.object({
    level: riskLevelSchema,
    reasons: z.array(z.string().trim().min(1).max(300)).max(10),
  }),
  continuityLocks: continuitySchema,
  timeline: z.array(timelineBeatSchema).min(1).max(6),
  suggestions: z.array(agentSuggestionSchema).max(20),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
  negativeConstraints: z.array(z.string().trim().min(1).max(160)).max(20),
});

export type ShotPlan = z.infer<typeof shotPlanSchema>;

export function createEmptyCineSpec(brief = ""): CineSpec {
  return {
    version: "0.1",
    mode: "text_to_video",
    brief,
    duration: 10,
    resolution: "480P",
    aspectRatio: "adaptive",
    subject: { description: null, action: null, identityLock: true },
    scene: { environment: null, time: null, atmosphere: null },
    cinematography: {
      shotSize: null,
      cameraAngle: null,
      lensMm: null,
      depthOfField: null,
      movement: null,
      motionSpeed: null,
    },
    look: { style: null, lighting: null, color: null, mood: null },
    audio: { enabled: true, ambience: null },
    negativePrompt: null,
    continuity: structuredClone(emptyContinuity),
    timeline: [],
  };
}

const qualityFields = [
  "brief",
  "subject.description",
  "subject.action",
  "scene.environment",
  "scene.time",
  "scene.atmosphere",
  "cinematography.shotSize",
  "cinematography.cameraAngle",
  "cinematography.lensMm",
  "cinematography.depthOfField",
  "cinematography.movement",
  "look.style",
  "look.lighting",
  "look.mood",
  "audio.ambience",
] as const;

export const qualityFieldTotal = qualityFields.length;

export function countDefinedFields(spec: CineSpec): number {
  return qualityFields.filter((path) => {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, spec);
    return value !== null && value !== undefined && value !== "";
  }).length;
}

export function applyAgentSuggestion(spec: CineSpec, suggestion: AgentSuggestion): CineSpec {
  const parsed = agentSuggestionSchema.parse(suggestion);
  const clone = structuredClone(spec) as unknown as Record<string, unknown>;
  const parts = parsed.path.slice(1).split("/");
  let cursor = clone;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== "object") throw new Error(`Invalid patch path: ${parsed.path}`);
    cursor = next as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = parsed.value;
  return cineSpecSchema.parse(clone);
}
