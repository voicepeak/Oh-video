import type { CineSpec } from "./cinespec";

export const labels = {
  shotSize: {
    extreme_wide: "大远景",
    wide: "远景",
    full: "全景",
    medium: "中景",
    close_up: "近景",
    extreme_close_up: "特写",
  },
  cameraAngle: {
    eye_level: "平视",
    low: "低机位仰拍",
    high: "高机位俯拍",
    overhead: "顶拍",
    dutch: "荷兰角",
    over_shoulder: "过肩视角",
  },
  movement: {
    fixed: "固定镜头",
    dolly_in: "缓慢推近",
    dolly_out: "缓慢拉远",
    pan_left: "向左摇摄",
    pan_right: "向右摇摄",
    tilt_up: "向上摇摄",
    tilt_down: "向下摇摄",
    truck_left: "向左横移",
    truck_right: "向右横移",
    orbit: "环绕运镜",
    handheld: "手持摄影",
  },
  depthOfField: { shallow: "浅景深", normal: "自然景深", deep: "深景深" },
  motionSpeed: { slow: "慢速", normal: "自然速度", fast: "快速" },
} satisfies Record<string, Record<string, string>>;

export function labelFor<T extends keyof typeof labels>(group: T, value: keyof (typeof labels)[T] | null) {
  return value ? (labels[group] as Record<string, string>)[String(value)] : "";
}

export function specSummary(spec: CineSpec) {
  return [
    spec.cinematography.shotSize && labelFor("shotSize", spec.cinematography.shotSize),
    spec.cinematography.cameraAngle && labelFor("cameraAngle", spec.cinematography.cameraAngle),
    spec.cinematography.lensMm && `${spec.cinematography.lensMm}mm`,
    spec.cinematography.movement && labelFor("movement", spec.cinematography.movement),
  ].filter(Boolean);
}
