export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { runDynamicAction } from "@/server/executor/runDynamicAction";
import {
  parseUrdfMetaFromContext,
  sanitizeRobotMotions,
} from "@/server/executor/motionSafety";
import {
  MUJOCO_JOINT_ORDER,
  JOINT_CONSTRAINTS,
} from "@/constants/jointConfig";
import type { JointName } from "@/constants/jointConfig";
import type { RobotMotion } from "@/server/robot/controller";

interface ExecuteRequestBody {
  motions?: Array<Partial<RobotMotion>>;
  context?: string;
}

// ─── MuJoCo 관절 제약 기반 sanitize ──────────────────────────

function sanitizeMujocoMotions(
  motions: Array<Partial<RobotMotion>>,
  opts: { defaultTimeMs: number; maxTimeMs: number; maxMotions: number },
): { motions: RobotMotion[]; warnings: string[] } {
  const warnings: string[] = [];
  const mujocoNames = new Set<string>(MUJOCO_JOINT_ORDER);

  const safe: RobotMotion[] = [];

  for (const m of motions.slice(0, opts.maxMotions)) {
    if (!m.joint || typeof m.joint !== "string") {
      warnings.push(`joint 이름 없음, 스킵`);
      continue;
    }

    // 관절명 해상도
    let resolved: JointName | null = null;
    if (mujocoNames.has(m.joint)) {
      resolved = m.joint as JointName;
    } else {
      // 정규화 매칭
      const norm = m.joint.toLowerCase().replace(/[\s\-_.]/g, "");
      for (const jn of MUJOCO_JOINT_ORDER) {
        const jnNorm = jn.toLowerCase().replace(/[\s\-_.]/g, "");
        if (jnNorm === norm || jnNorm.includes(norm) || norm.includes(jnNorm)) {
          resolved = jn;
          break;
        }
      }
    }

    if (!resolved) {
      warnings.push(`알 수 없는 관절: ${m.joint}, 스킵`);
      continue;
    }

    let angle = typeof m.angle === "number" ? m.angle : 0;
    const c = JOINT_CONSTRAINTS[resolved];

    // 후처리
    switch (c.postProcess) {
      case "abs": angle = Math.abs(angle); break;
      case "neg_abs": angle = -Math.abs(angle); break;
      case "pos_abs": angle = Math.abs(angle); break;
    }

    // 클램핑
    angle = Math.max(c.min, Math.min(c.max, angle));

    let time = typeof m.time === "number" ? m.time : opts.defaultTimeMs;
    time = Math.max(0, Math.min(opts.maxTimeMs, time));

    safe.push({
      joint: resolved,
      angle,
      time,
      speed: typeof m.speed === "number" ? m.speed : undefined,
    } as RobotMotion);
  }

  return { motions: safe, warnings };
}

// ─── context에 MuJoCo 정보가 있는지 판별 ─────────────────────

function isMujocoContext(context?: string): boolean {
  if (!context) return false;
  return context.includes("MUJOCO_JOINT_CONTEXT") ||
    context.includes("l_hip_pitch") ||
    context.includes("r_knee");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ExecuteRequestBody;

    const motions = Array.isArray(body.motions) ? body.motions : [];
    const context = typeof body.context === "string" ? body.context : undefined;

    if (motions.length === 0) {
      return NextResponse.json(
        { error: "motions 배열이 필요합니다." },
        { status: 400 },
      );
    }

    let safeMotions: RobotMotion[];
    let warnings: string[];

    if (isMujocoContext(context)) {
      // ─── MuJoCo 모드 ───
      const result = sanitizeMujocoMotions(motions, {
        defaultTimeMs: 350,
        maxTimeMs: 5000,
        maxMotions: 64,
      });
      safeMotions = result.motions;
      warnings = result.warnings;
    } else {
      // ─── 기존 URDF 모드 (하위 호환) ───
      const meta = parseUrdfMetaFromContext(context);
      const result = sanitizeRobotMotions(motions, meta, {
        defaultTimeMs: 350,
        maxTimeMs: 5000,
        maxMotions: 64,
      });
      safeMotions = result.motions;
      warnings = result.warnings;
    }

    await runDynamicAction(safeMotions);

    return NextResponse.json({ ok: true, motions: safeMotions, warnings });
  } catch (error: unknown) {
    console.error("[execute]", error);

    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "알 수 없는 오류가 발생했습니다.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
