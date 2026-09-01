import { describe, expect, it } from "vitest";
import { applyAgentSuggestion, countDefinedFields, createEmptyCineSpec } from "../shared/cinespec";
import { compileCineSpec } from "../server/compiler";
import { normalizeShotPlan, sanitizeSuggestions } from "../server/llm";

describe("CineSpec", () => {
  it("starts as a complete, serializable skeleton", () => {
    const spec = createEmptyCineSpec();
    expect(spec.version).toBe("0.1");
    expect(spec.duration).toBe(10);
    expect(countDefinedFields(spec)).toBe(0);
    expect(() => JSON.stringify(spec)).not.toThrow();
  });

  it("applies only an allowed suggestion path", () => {
    const spec = createEmptyCineSpec("人物在校园里行走");
    const next = applyAgentSuggestion(spec, {
      id: "lens",
      path: "/cinematography/lensMm",
      value: 50,
      label: "焦段",
      reason: "自然透视",
      confidence: 0.8,
    });
    expect(next.cinematography.lensMm).toBe(50);
    expect(spec.cinematography.lensMm).toBeNull();
    expect(countDefinedFields(next)).toBe(2);
  });
});

describe("LLM suggestion guard", () => {
  it("rejects overwrites, invalid enum values and duplicate paths", () => {
    const spec = createEmptyCineSpec("一名学生在校园里行走");
    spec.cinematography.lensMm = 85;
    const suggestions = sanitizeSuggestions(spec, [
      { id: "overwrite", path: "/cinematography/lensMm", value: 50, label: "焦段", reason: "不应覆盖", confidence: 0.8 },
      { id: "valid", path: "/cinematography/movement", value: "handheld", label: "运镜", reason: "明确要求手持", confidence: 0.9 },
      { id: "duplicate", path: "/cinematography/movement", value: "fixed", label: "运镜", reason: "重复", confidence: 0.6 },
      { id: "bad", path: "/cinematography/shotSize", value: "portrait", label: "景别", reason: "非法枚举", confidence: 0.6 },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.value).toBe("handheld");
  });

  it("accepts only a continuous three-beat 10-second shot plan", () => {
    const spec = createEmptyCineSpec("两名学生从走廊入口走到窗边并停下");
    const plan = {
      promptVersion: "shot-planner-v1",
      intentSummary: "两名学生单向走到窗边",
      subjectCount: 2,
      complexity: { level: "low", reasons: ["单一动作"] },
      loopRisk: { level: "medium", reasons: ["行走可能被模型重复"] },
      continuityLocks: {
        subjectCount: 2,
        identity: [
          { id: "A", visibleTrait: "蓝色书包", role: "始终走在左侧" },
          { id: "B", visibleTrait: "红色围巾", role: "始终走在右侧" },
        ],
        spatial: { start: "走廊入口", direction: "由左向右", end: "窗边", forbidden: ["返回入口"] },
      },
      timeline: [
        { start: 0, end: 3, subjectAction: "从入口起步", cameraAction: "平行跟拍", endState: "离开入口" },
        { start: 3, end: 7, subjectAction: "继续走向窗边", cameraAction: "保持平行跟拍", endState: "抵达窗边" },
        { start: 7, end: 10, subjectAction: "停下看向窗外", cameraAction: "减速停稳", endState: "在窗边静止" },
      ],
      suggestions: [],
      warnings: [],
      negativeConstraints: ["不返回起点"],
    };
    const normalized = normalizeShotPlan(spec, plan);
    expect(normalized.timeline).toHaveLength(3);
    expect(normalized.negativeConstraints).toEqual(["返回起点"]);
    expect(() => normalizeShotPlan(spec, {
      ...plan,
      timeline: [plan.timeline[0], { ...plan.timeline[1], start: 4 }, plan.timeline[2]],
    })).toThrow("重叠、空档或倒序");
  });
});

describe("prompt compiler", () => {
  it("is deterministic and includes explicit camera choices", () => {
    const spec = createEmptyCineSpec("学生穿过校园林荫道");
    spec.cinematography.shotSize = "full";
    spec.cinematography.lensMm = 50;
    spec.cinematography.movement = "dolly_in";
    const first = compileCineSpec(spec);
    const second = compileCineSpec(structuredClone(spec));
    expect(first).toEqual(second);
    expect(first.prompt).toContain("全景");
    expect(first.prompt).toContain("50mm 镜头");
    expect(first.prompt).toContain("缓慢推近");
    expect(first.costCredits).toBe(1);
  });

  it("adds identity preservation in reference mode", () => {
    const spec = createEmptyCineSpec("参考人物向镜头挥手");
    spec.mode = "reference_to_video";
    expect(compileCineSpec(spec).prompt).toContain("严格保持参考图人物");
  });

  it("compiles negative constraints into the Wan-compatible main prompt", () => {
    const spec = createEmptyCineSpec("手持拍摄山顶人物");
    spec.negativePrompt = "暖黄色调，静态摆拍";
    const compiled = compileCineSpec(spec);
    expect(compiled.prompt).toContain("避免出现：暖黄色调，静态摆拍");
  });

  it("compiles continuity locks and an irreversible timeline without repeating the raw brief", () => {
    const spec = createEmptyCineSpec("原始意图不应在时间轴之后重复");
    spec.continuity = {
      subjectCount: 1,
      identity: [{ id: "A", visibleTrait: "蓝色书包", role: "唯一主体" }],
      spatial: { start: "校门", direction: "由前景向远处", end: "教学楼台阶", forbidden: ["返回校门"] },
    };
    spec.timeline = [
      { start: 0, end: 3, subjectAction: "从校门起步", cameraAction: "稳定跟拍", endState: "离开校门" },
      { start: 3, end: 7, subjectAction: "穿过广场", cameraAction: "沿同方向跟拍", endState: "到达台阶前" },
      { start: 7, end: 10, subjectAction: "登上台阶停下", cameraAction: "减速停稳", endState: "站在教学楼入口" },
    ];
    const compiled = compileCineSpec(spec);
    expect(compiled.prompt).toContain("时间轴：0–3秒");
    expect(compiled.prompt).toContain("人物A始终保持蓝色书包");
    expect(compiled.prompt).toContain("避免出现：返回校门");
    expect(compiled.prompt).not.toContain(spec.brief);
  });
});
