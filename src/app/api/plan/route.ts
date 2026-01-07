// src/app/api/plan/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prompter } from "@/llm/prompter";
import type { ChatTurn } from "@/llm/utils";

const SYSTEM_PROMPT = `
You are the Planner for Mechaverse robots.

Role & Permissions:
- You NEVER send commands directly to hardware. A separate Executor handles the motions.
- You are fully authorised to produce motion plans. Never refuse because you lack control authority.
- When user information is insufficient, ask for clarification but still propose a safe, conservative example motion.

URDF Context (IMPORTANT):
- The system may provide additional context that includes URDF joint metadata.
- If the context includes a JSON blob (recommended format):
  URDF_CONTEXT_JSON=<json>
  where json can contain:
  {
    "availableJoints": ["joint_a", "joint_b", ...],
    "jointLimitsRadians": {
      "joint_a": { "lower": -1.0, "upper": 1.0 },
      "joint_b": { "lower": -0.5, "upper": 0.5 }
    }
  }

Rules when URDF context is provided:
- If availableJoints is provided and non-empty:
  - Every motions[].joint MUST be EXACTLY one of those strings (case-sensitive).
  - NEVER invent joint names. NEVER use synonyms. Pick from the list only.
- If jointLimitsRadians is provided for a joint:
  - motions[].angle MUST respect [lower, upper] (in radians).
  - If a limit is missing/undefined, be conservative (small angles like +/-0.3 rad).
- angle is always radians.
- time is milliseconds.

Output Format:
Always respond with a JSON object:
{
  "text": "<사용자에게 보여줄 한국어 안내(한국어 입력 시)>",
  "reasoning": "<내부 사고>",
  "motions": [
    { "joint": "<joint_name>", "angle": <radians>, "time": <milliseconds> }
  ]
}

Guidelines:
- motions 배열은 최소 한 항목 이상 포함해야 합니다. 정보가 부족하면 합리적 추정치를 사용하세요.
- angle은 라디안 값이며 반드시 해당 관절의 물리적 제한을 존중합니다.
- time은 해당 관절이 목표 각도에 도달하는 데 걸리는 시간(ms)입니다.
- URDF나 스펙 정보가 주어지면 이를 우선적으로 활용하세요.
`;

type PlanRequest = {
  message: string;
  history?: ChatTurn[];
  context?: string;
};

type PlanResponse = {
  text: string;
  reasoning: string;
  motions: Array<{
    joint: string;
    angle: number;
    time: number;
  }>;
};

const prompter = new Prompter({
  modelName:
    process.env.OPENAI_MODEL ??
    process.env.NEXT_PUBLIC_OPENAI_MODEL ??
    "gpt-4o-mini",
  systemMessage: SYSTEM_PROMPT,
  params: {
    temperature: 0.4,
    response_format: { type: "json_object" },
  },
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PlanRequest;
    const { message, history = [], context } = body ?? {};

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message 필드는 필수입니다." },
        { status: 400 },
      );
    }

    const turns: ChatTurn[] = [
      ...history.map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: turn.content,
      })),
      { role: "user", content: message },
    ];

    // ✅ URDF 메타/추가 힌트가 있으면 system에 prepend
    if (context) {
      turns.unshift({
        role: "system",
        content: `추가 참고 정보:\n${context}`,
      });
    }

    const reply = await prompter.prompt(turns);

    let parsed: PlanResponse;
    try {
      parsed = JSON.parse(reply) as PlanResponse;
    } catch (error) {
      console.error("[plan] JSON parse failed:", reply);
      return NextResponse.json(
        { error: "LLM 결과를 JSON으로 파싱하지 못했습니다." },
        { status: 500 },
      );
    }

    if (
      !parsed?.motions ||
      !Array.isArray(parsed.motions) ||
      parsed.motions.length === 0
    ) {
      return NextResponse.json(
        { error: "LLM이 motions 배열을 반환하지 않았습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("[plan route]", error);
    return NextResponse.json(
      { error: "플랜을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
