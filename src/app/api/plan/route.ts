// src/app/api/plan/route.ts
export const runtime = "node";

import { NextResponse } from "next/server";
import { Prompter } from "@/llm/prompter";
import type { ChatTurn } from "@/llm/utils";

const SYSTEM_PROMPT = `
You are the Planner for Mechaverse robots.

- Your responsibility is to inspect the request and produce a JSON motion plan.
- You NEVER execute motions yourself; a separate Executor handles hardware.
- Never refuse because you lack control authority. Always return the best plan you can.
- Use any URDF/context provided to reason about joints, limits, axes, etc.
- Return valid JSON with fields:
  {
    "text": "<friendly display text in Korean if user speaks Korean>",
    "reasoning": "<short internal reasoning>",
    "motions": [
      { "joint": "<joint_name>", "angle": <radians>, "time": <milliseconds> }
    ]
  }
- `angle` must be in radians and respect joint limits. `time` is the duration (ms) for the motion.
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

    if (!parsed?.motions || !Array.isArray(parsed.motions)) {
      return NextResponse.json(
        { error: "LLM이 motions 배열을 반환하지 않았습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json(parsed satisfies PlanResponse);
  } catch (error) {
    console.error("[plan route]", error);
    return NextResponse.json(
      { error: "플랜을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
