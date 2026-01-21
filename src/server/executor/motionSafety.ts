// src/server/executor/motionSafety.ts
import type { RobotMotion } from "../robot/controller";

export type JointLimit = { lower?: number; upper?: number };
export type JointLimits = Record<string, JointLimit>;

export type UrdfMeta = {
  availableJoints?: string[];
  jointLimitsRadians?: JointLimits;
};

export function parseUrdfMetaFromContext(context?: string): UrdfMeta | null {
  if (!context || typeof context !== "string") return null;

  // context는 여러 줄일 수 있어서 라인 단위로 안전하게 파싱
  const line = context
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("URDF_CONTEXT_JSON="));

  if (!line) return null;

  const jsonText = line.slice("URDF_CONTEXT_JSON=".length).trim();
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as UrdfMeta;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp(v: number, lo?: number, hi?: number): number {
  let out = v;
  if (isFiniteNumber(lo) && out < lo) out = lo;
  if (isFiniteNumber(hi) && out > hi) out = hi;
  return out;
}

export function sanitizeRobotMotions(
  input: Array<Partial<RobotMotion>>,
  meta?: UrdfMeta | null,
  options?: {
    defaultTimeMs?: number;
    maxTimeMs?: number;
    maxMotions?: number;
  },
): { motions: RobotMotion[]; warnings: string[] } {
  const warnings: string[] = [];

  const defaultTimeMs = options?.defaultTimeMs ?? 350;
  const maxTimeMs = options?.maxTimeMs ?? 5000;
  const maxMotions = options?.maxMotions ?? 64;

  const available = Array.isArray(meta?.availableJoints) ? meta!.availableJoints! : null;
  const limits = meta?.jointLimitsRadians && typeof meta.jointLimitsRadians === "object"
    ? meta.jointLimitsRadians
    : null;

  const raw = Array.isArray(input) ? input.slice(0, maxMotions) : [];
  const out: RobotMotion[] = [];

  for (const m of raw) {
    const joint = typeof m?.joint === "string" ? m.joint.trim() : "";
    const angle = m?.angle;
    const time = m?.time;
    const speed = m?.speed;

    if (!joint) {
      warnings.push("drop: empty joint");
      continue;
    }

    if (available && available.length > 0 && !available.includes(joint)) {
      warnings.push(`drop: joint not in URDF availableJoints (${joint})`);
      continue;
    }

    if (!isFiniteNumber(angle)) {
      warnings.push(`drop: invalid angle (${joint})`);
      continue;
    }

    const lim = limits?.[joint];
    const clampedAngle = lim ? clamp(angle, lim.lower, lim.upper) : angle;

    // time이 없으면 default
    const t0 = isFiniteNumber(time) ? time : defaultTimeMs;
    const clampedTime = Math.max(0, Math.min(maxTimeMs, Math.round(t0)));

    const motion: RobotMotion = {
      joint,
      angle: clampedAngle,
      time: clampedTime,
      ...(isFiniteNumber(speed) ? { speed } : {}),
    };

    out.push(motion);
  }

  if (out.length === 0) {
    // 완전 실패면 에러 대신 “안전 no-op”로 바꾸고 싶으면 여기서 처리 가능
    // 지금은 명확히 실패를 반환하는 쪽으로.
    throw new Error("No valid motions after safety validation.");
  }

  return { motions: out, warnings };
}
