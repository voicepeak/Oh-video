import type { CineSpec } from "../shared/cinespec";
import { labelFor } from "../shared/labels";

export type CompiledPrompt = {
  prompt: string;
  negativePrompt: string | null;
  warnings: string[];
  costCredits: number;
};

const clean = (items: Array<string | number | null | false | undefined>) =>
  items.filter((item): item is string | number => item !== null && item !== undefined && item !== false && item !== "");

const normalizeNegative = (value: string) => value
  .replace(/^(?:禁止|不要|避免出现[:：]?|不得|不可)/, "")
  .replace(/^不(?=循环|返回|原地|重复|人物|身份|瞬移|运动方向|肢体)/, "")
  .trim();

export function compileCineSpec(spec: CineSpec): CompiledPrompt {
  const warnings: string[] = [];
  const intentText = [spec.brief, spec.subject.action, spec.look.style, spec.look.mood].filter(Boolean).join(" ");
  if (!spec.brief.trim()) warnings.push("请先填写创作意图。");
  if (spec.mode === "reference_to_video" && !spec.subject.identityLock) {
    warnings.push("参考图模式建议开启人物一致性保护。");
  }
  if (spec.cinematography.movement === "handheld" && spec.cinematography.motionSpeed === "fast" && !/(剧烈|晃动|躁动|失序|拖影)/.test(intentText)) {
    warnings.push("快速手持容易造成画面失真，建议降低运动速度。");
  }

  const hasTimeline = spec.timeline.length > 0;
  if (hasTimeline) {
    const ordered = [...spec.timeline].sort((a, b) => a.start - b.start);
    const hasGap = Math.abs(ordered[0].start) > 0.01
      || Math.abs(ordered.at(-1)!.end - spec.duration) > 0.01
      || ordered.slice(1).some((beat, index) => Math.abs(beat.start - ordered[index].end) > 0.01);
    if (hasGap) warnings.push("连续性时间轴没有完整覆盖 0–10 秒，请重新运行镜头分析。");
  }

  const identity = spec.mode === "reference_to_video" && spec.subject.identityLock
    ? "严格保持参考图人物的面部、发型、服装与主体特征一致"
    : null;
  const subject = clean([spec.subject.description, hasTimeline ? null : spec.subject.action]).join("，");
  const scene = clean([
    spec.scene.environment,
    spec.scene.time,
    spec.scene.atmosphere,
  ]).join("，");
  const camera = clean([
    spec.cinematography.shotSize && labelFor("shotSize", spec.cinematography.shotSize),
    spec.cinematography.cameraAngle && labelFor("cameraAngle", spec.cinematography.cameraAngle),
    spec.cinematography.lensMm && `${spec.cinematography.lensMm}mm 镜头`,
    spec.cinematography.depthOfField && labelFor("depthOfField", spec.cinematography.depthOfField),
    spec.cinematography.movement && labelFor("movement", spec.cinematography.movement),
    spec.cinematography.motionSpeed && labelFor("motionSpeed", spec.cinematography.motionSpeed),
  ]).join("，");
  const look = clean([
    spec.look.style,
    spec.look.lighting,
    spec.look.color,
    spec.look.mood,
  ]).join("，");
  const audio = spec.audio.enabled
    ? spec.audio.ambience ? `同期环境声：${spec.audio.ambience}` : "自然同期环境声"
    : "无音轨";
  const identityLocks = spec.continuity.identity.length
    ? `人物身份锁：${spec.continuity.identity.map((item) => `人物${item.id}始终保持${item.visibleTrait}，固定角色为${item.role}`).join("；")}`
    : null;
  const spatialLock = clean([
    spec.continuity.spatial.start && `起始状态：${spec.continuity.spatial.start}`,
    spec.continuity.spatial.direction && `唯一运动方向：${spec.continuity.spatial.direction}`,
    spec.continuity.spatial.end && `最终状态：${spec.continuity.spatial.end}`,
  ]).join("；");
  const timeline = hasTimeline
    ? `时间轴：${spec.timeline.map((beat) => `${beat.start}–${beat.end}秒，人物：${beat.subjectAction}；摄影机：${beat.cameraAction}；段末状态：${beat.endState}`).join("。")}`
    : null;
  const negativeItems = [
    ...(spec.negativePrompt ? spec.negativePrompt.split(/[，,；;]/).map(normalizeNegative).filter(Boolean) : []),
    ...spec.continuity.spatial.forbidden,
  ];
  const negative = [...new Set(negativeItems)].join("，");
  const negativeConstraint = negative ? `避免出现：${negative}` : null;
  const intentionallyUnstable = /(剧烈|晃动|躁动|失序|破碎|拖影|模糊|过曝)/.test(intentText);
  const subjectGuard = spec.continuity.subjectCount
    ? `${spec.continuity.subjectCount}名人物数量稳定，身份不交换`
    : "主体数量稳定";
  const qualityGuard = intentionallyUnstable
    ? `单一连续镜头，${subjectGuard}，面部与肢体结构完整，保留有意的晃动、拖影与局部过曝`
    : `单一连续镜头，时间单向推进，动作连贯，${subjectGuard}，画面细节清晰`;

  const prompt = clean([
    hasTimeline ? `${spec.duration}秒单一连续镜头，不循环、不返回起点` : spec.brief,
    identity,
    identityLocks,
    subject && `主体：${subject}`,
    scene && `场景：${scene}`,
    spatialLock,
    timeline,
    camera && `摄影：${camera}`,
    look && `视觉：${look}`,
    audio,
    negativeConstraint,
    qualityGuard,
  ]).join("。") + "。";

  return { prompt, negativePrompt: negative || null, warnings, costCredits: 1 };
}
