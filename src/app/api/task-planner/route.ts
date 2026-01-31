// src/app/api/task-planner/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const summary = body?.summary;

    if (!summary) {
      return NextResponse.json({ error: "missing summary" }, { status: 400 });
    }

    // ✅ TODO: 여기서 너가 쓰는 LLM(= /api/intent에서 쓰는거) 호출해서 plan JSON 생성하면 됨.
    // 지금은 최소 동작/연결 확인용 heuristic planner.
    const best = Number(summary.bestReturn ?? 0);
    const eps = Number(summary.episodes ?? 0);

    // 단순 휴리스틱: 넘어지면 upright 보상↑ / ctrl 패널티↓
    const plan = {
      goal: eps < 5 ? "stabilize upright first" : "increase standing duration",
      rlConfig: {
        reward: {
          alive: 1.0,
          wUpright: best < 10 ? 3.0 : 2.0,
          wHeight: 1.0,
          wCtrl: best < 10 ? 0.0005 : 0.001,
          minUprightForReward: 0.6,
          heightK: 25.0,
        },
        terminate: {
          minUpright: 0.2,
          fallHeightFrac: 0.55,
          minHeightAbs: 0.12,
        },
        frameSkip: Number(summary.frameSkip ?? 5),
        maxSteps: Number(summary.maxSteps ?? 480),
        actionMode: "normalized" as const,
      },
      actionHint: {
        kind: "sine" as const,
        amp: 0.65,
        speed: 1.0,
      },
    };

    const text =
      `🧠 Task planner updated.\n` +
      `- goal: ${plan.goal}\n` +
      `- reward tweak: wUpright=${plan.rlConfig.reward.wUpright}, wCtrl=${plan.rlConfig.reward.wCtrl}\n` +
      `- actionHint: sine amp=${plan.actionHint.amp}, speed=${plan.actionHint.speed}\n` +
      `(best=${best.toFixed(2)}, eps=${eps})`;

    return NextResponse.json({ text, plan });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}