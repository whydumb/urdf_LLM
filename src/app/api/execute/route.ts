// src/app/api/execute/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { runDynamicAction } from "@/server/executor/runDynamicAction";
import { parseUrdfMetaFromContext, sanitizeRobotMotions } from "@/server/executor/motionSafety";
import type { RobotMotion } from "@/server/robot/controller";

interface ExecuteRequestBody {
  motions?: Array<Partial<RobotMotion>>;
  context?: string; // ✅ optional: URDF_CONTEXT_JSON 포함 가능
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ExecuteRequestBody;

    const motions = Array.isArray(body.motions) ? body.motions : [];
    const context = typeof body.context === "string" ? body.context : undefined;

    if (motions.length === 0) {
      return NextResponse.json({ error: "motions 배열이 필요합니다." }, { status: 400 });
    }

    const meta = parseUrdfMetaFromContext(context);
    const { motions: safeMotions, warnings } = sanitizeRobotMotions(motions, meta, {
      defaultTimeMs: 350,
      maxTimeMs: 5000,
      maxMotions: 64,
    });

    await runDynamicAction(safeMotions);

    // ✅ viewer 쪽에서 최종 결과를 쓰게 motions를 반환
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
