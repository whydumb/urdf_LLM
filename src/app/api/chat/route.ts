import { NextResponse } from "next/server";

import { Prompter } from "@/llm/prompter";
import type { ChatTurn } from "@/llm/utils";

const prompter = new Prompter({
  modelName: process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? "gpt-4o-mini",
  baseUrl: process.env.OPENAI_BASE_URL,
  params: {
    temperature: 0.6,
  },
});

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
    .filter((value): value is ChatTurn => Boolean(value))
    .slice(-MAX_HISTORY);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, history } = body ?? {};

    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "메시지를 입력해주세요." },
        { status: 400 },
      );
    }

    const userTurn: ChatTurn = { role: "user", content: message.trim() };
    const turns = [...sanitizeHistory(history), userTurn];

    const reply = await prompter.prompt(turns);

    return NextResponse.json({ reply });
  } catch (error: unknown) {
    console.error("[chat route]", error);

    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error && "message" in error && typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";

    if (message.includes("API key")) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다. keys.json 파일이나 환경 변수를 확인하세요." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "답변을 생성하지 못했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }
}
