// src/app/api/intent/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { Prompter } from "@/llm/prompter";
import type { ChatTurn } from "@/llm/utils";
import { getModelForStage, shouldDebugModels } from "@/server/llm/modelConfig";

// GPT-5 계열(특히 gpt-5, gpt-5-mini, gpt-5-nano)은 temperature/top_p/logprobs 넣으면 에러가 날 수 있음.
// 대신 reasoning_effort / verbosity / max_completion_tokens 쓰는 방식으로 안정화. :contentReference[oaicite:3]{index=3}

function isLegacyGpt5(modelName: string) {
  const m = modelName.toLowerCase();
  if (!m.startsWith("gpt-5")) return false;
  // gpt-5.1 / gpt-5.2는 별도 규칙이 있을 수 있으니 여기선 “구형 GPT-5 계열”만 잡는다.
  return !(m.startsWith("gpt-5.1") || m.startsWith("gpt-5.2"));
}

function readIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const SYSTEM_PROMPT = `
You are the Intent Planner (Stage-1) for Mechaverse robots.

Goal:
- Convert the user's natural language command into a high-level INTENT.
- Do NOT output motor motions. (No joint angles, no per-joint commands.)
- Provide a short Korean explanation text for the user.

IMPORTANT: Output must be valid json. (json only)
Return ONLY a json object with this shape:
{
  "text": "<user-facing explanation in Korean if user wrote Korean>",
  "intent": {
    "goal": "<string, what the user wants>",
    "style": "<optional string: gentle/slow/fast/etc>",
    "duration_ms": <optional number, milliseconds>,
    "sketch": [
      { "joint_hint": "<string>", "delta_rad": <optional number>, "target_angle_rad": <optional number> }
    ],
    "constraints": {
      "max_abs_angle_rad": <optional number>,
      "max_time_ms": <optional number>
    }
  }
}

Rules:
- NEVER include "motions".
- JSON only. No extra keys.
- If info is missing, still output a safe, conservative intent.
`;

type IntentRequest = {
  message: string;
  history?: ChatTurn[];
  context?: string;
};

type IntentResponse = {
  text: string;
  intent: {
    goal: string;
    style?: string;
    duration_ms?: number;
    sketch?: Array<{
      joint_hint: string;
      delta_rad?: number;
      target_angle_rad?: number;
    }>;
    constraints?: {
      max_abs_angle_rad?: number;
      max_time_ms?: number;
    };
  };
};

const MAX_HISTORY = 12;

function sanitizeHistory(entries: unknown): ChatTurn[] {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const role = (entry as Partial<ChatTurn>).role;
      const content = (entry as Partial<ChatTurn>).content;
      if (typeof content !== "string" || !content.trim()) return null;

      return {
        role: role === "assistant" ? "assistant" : "user",
        content: content.trim(),
      } satisfies ChatTurn;
    })
    .filter((v): v is ChatTurn => Boolean(v))
    .slice(-MAX_HISTORY);
}

function createPrompter() {
  const modelName = getModelForStage("intent");
  if (shouldDebugModels()) console.log("[intent] model =", modelName);

  // GPT-5 계열 안정 세팅
  const params: Record<string, unknown> = {
    response_format: { type: "json_object" },
    // reasoning 토큰까지 포함하는 상한 (너무 작으면 출력이 비거나 잘릴 수 있음) :contentReference[oaicite:4]{index=4}
    max_completion_tokens: readIntEnv("OPENAI_MAX_COMPLETION_TOKENS_INTENT", 1500),
  };

  if (isLegacyGpt5(modelName)) {
    params.reasoning_effort = process.env.OPENAI_REASONING_EFFORT_INTENT ?? "low";
    params.verbosity = process.env.OPENAI_VERBOSITY_INTENT ?? "low";
    // ⚠️ temperature/top_p/logprobs는 넣지 않는다. (구형 GPT-5에서 에러 유발) :contentReference[oaicite:5]{index=5}
  } else {
    // 구형 GPT-5가 아닌 모델은 원하면 temperature 사용 가능(기본은 낮게)
    params.temperature = Number(process.env.OPENAI_TEMPERATURE_INTENT ?? "0.2");
  }

  return new Prompter({
    name: "IntentPlanner",
    modelName,
    baseUrl: process.env.OPENAI_BASE_URL,
    systemMessage: SYSTEM_PROMPT,
    params,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<IntentRequest>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const history = sanitizeHistory(body.history);
    const context = typeof body.context === "string" ? body.context : undefined;

    if (!message) {
      return NextResponse.json({ error: "message 필드는 필수입니다." }, { status: 400 });
    }

    const turns: ChatTurn[] = [...history, { role: "user", content: message }];

    if (context) {
      turns.unshift({ role: "system", content: `추가 참고 정보:\n${context}` });
    }

    const prompter = createPrompter();
    const reply = await prompter.prompt(turns);

    let parsed: IntentResponse;
    try {
      parsed = JSON.parse(reply) as IntentResponse;
    } catch {
      console.error("[intent] JSON parse failed:", reply);
      return NextResponse.json({ error: "LLM 결과를 JSON으로 파싱하지 못했습니다." }, { status: 500 });
    }

    if (
      !parsed ||
      typeof parsed.text !== "string" ||
      !parsed.intent ||
      typeof parsed.intent !== "object" ||
      typeof parsed.intent.goal !== "string" ||
      !parsed.intent.goal.trim()
    ) {
      return NextResponse.json({ error: "LLM이 올바른 intent 포맷을 반환하지 않았습니다." }, { status: 500 });
    }

    parsed.text = parsed.text.trim();
    parsed.intent.goal = parsed.intent.goal.trim();

    return NextResponse.json(parsed);
  } catch (error: unknown) {
    console.error("[intent route]", error);

    const msg =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "intent 생성 실패";

    if (msg.toLowerCase().includes("openai_api_key") || msg.toLowerCase().includes("api key")) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다. 환경 변수를 확인하세요." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "명령 해석(intent)을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
