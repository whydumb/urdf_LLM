export const runtime = "node";

import { NextResponse } from "next/server";

import { runDynamicAction } from "@/server/executor/runDynamicAction";
import type { RobotMotion } from "@/server/robot/controller";

interface ExecuteRequestBody {
  motions?: Array<Partial<RobotMotion>>;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ExecuteRequestBody;

    const motions = Array.isArray(body.motions) ? body.motions : [];

    if (motions.length === 0) {
      return NextResponse.json(
        { error: "motions 배열이 필요합니다." },
        { status: 400 },
      );
    }

    await runDynamicAction(motions);

    return NextResponse.json({ ok: true });
  } catch (error) {
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
