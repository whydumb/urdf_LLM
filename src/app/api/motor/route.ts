// src/app/api/motor/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prompter } from "@/llm/prompter";
import { getModelForStage, shouldDebugModels } from "@/server/llm/modelConfig";

function isLegacyGpt5(modelName: string) {
  const m = modelName.toLowerCase();
  if (!m.startsWith("gpt-5")) return false;
  return !(m.startsWith("gpt-5.1") || m.startsWith("gpt-5.2"));
}

function readIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const SYSTEM_PROMPT = `
You are the Motor Compiler (Stage-2) for Mechaverse robots.

IMPORTANT: Output must be valid json. (json only)
Return ONLY a JSON object with this shape:
{ "motions": [ { "joint": "<string>", "angle": <number radians>, "time": <number ms>, "speed": <optional number> } ] }

Hard rules:
- No extra keys. No text. No reasoning. JSON only.
- motions must be a non-empty array.
- angle is radians, time is milliseconds.

URDF rules (if provided):
- If availableJoints is provided: motions[].joint MUST be exactly one of them.
- Respect jointLimitsRadians if present (stay within bounds).
- Keep it conservative and <= 20 motions.
`;

type MotorRequest = {
  intent: unknown;
  context?: string;
  message?: string;
};

type MotorResponse = {
  motions: Array<{
    joint: string;
    angle: number;
    time: number;
    speed?: number;
  }>;
};

function createPrompter() {
  const modelName = getModelForStage("motor");
  if (shouldDebugModels()) console.log("[motor] model =", modelName);

  const params: Record<string, unknown> = {
    response_format: { type: "json_object" },
    max_completion_tokens: readIntEnv("OPENAI_MAX_COMPLETION_TOKENS_MOTOR", 1200),
  };

  if (isLegacyGpt5(modelName)) {
    params.reasoning_effort = process.env.OPENAI_REASONING_EFFORT_MOTOR ?? "low";
    params.verbosity = process.env.OPENAI_VERBOSITY_MOTOR ?? "low";
  } else {
    params.temperature = Number(process.env.OPENAI_TEMPERATURE_MOTOR ?? "0.1");
  }

  return new Prompter({
    name: "MotorCompiler",
    modelName,
    baseUrl: process.env.OPENAI_BASE_URL,
    systemMessage: SYSTEM_PROMPT,
    params,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<MotorRequest>;
    const intent = body.intent;
    const context = typeof body.context === "string" ? body.context : undefined;
    const userMessage = typeof body.message === "string" ? body.message.trim() : "";

    if (!intent || typeof intent !== "object") {
      return NextResponse.json({ error: "intent 객체가 필요합니다." }, { status: 400 });
    }

    const inputLines = [
      context ? `URDF/Context:\n${context}` : "",
      userMessage ? `USER_COMMAND=${userMessage}` : "",
      `INTENT_JSON=${JSON.stringify(intent)}`,
    ].filter(Boolean);

    const prompter = createPrompter();
    const reply = await prompter.prompt([{ role: "user", content: inputLines.join("\n\n") }]);

    let parsed: MotorResponse;
    try {
      parsed = JSON.parse(reply) as MotorResponse;
    } catch {
      console.error("[motor] JSON parse failed:", reply);
      return NextResponse.json({ error: "LLM 결과를 JSON으로 파싱하지 못했습니다." }, { status: 500 });
    }

    if (!parsed?.motions || !Array.isArray(parsed.motions) || parsed.motions.length === 0) {
      return NextResponse.json({ error: "LLM이 motions 배열을 반환하지 않았습니다." }, { status: 500 });
    }

    const cleaned = parsed.motions.filter((m) =>
      m &&
      typeof m.joint === "string" &&
      m.joint.trim() &&
      typeof m.angle === "number" &&
      Number.isFinite(m.angle) &&
      typeof m.time === "number" &&
      Number.isFinite(m.time),
    );

    if (cleaned.length === 0) {
      return NextResponse.json({ error: "motions가 유효한 형식이 아닙니다." }, { status: 500 });
    }

    return NextResponse.json({ motions: cleaned });
  } catch (error: unknown) {
    console.error("[motor route]", error);

    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "알 수 없는 오류가 발생했습니다.";

    if (msg.toLowerCase().includes("openai_api_key") || msg.toLowerCase().includes("api key")) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다. 환경 변수를 확인하세요." },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
