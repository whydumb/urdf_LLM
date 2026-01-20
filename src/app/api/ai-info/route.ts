// src/app/api/ai-info/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";

function pickModel(envKey: string) {
  return (
    process.env[envKey] ??
    process.env.OPENAI_MODEL ??
    process.env.NEXT_PUBLIC_OPENAI_MODEL ??
    "gpt-4o-mini"
  );
}

function maskBaseUrl(url?: string) {
  if (!url) return "default";
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "custom";
  }
}

export async function GET() {
  const intentModel = pickModel("OPENAI_MODEL_INTENT");
  const motorModel = pickModel("OPENAI_MODEL_MOTOR");

  return NextResponse.json({
    ok: true,
    intentModel,
    motorModel,
    defaultModel:
      process.env.OPENAI_MODEL ?? process.env.NEXT_PUBLIC_OPENAI_MODEL ?? "gpt-4o-mini",
    baseUrl: maskBaseUrl(process.env.OPENAI_BASE_URL),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    appVersion: process.env.npm_package_version ?? null,
    ts: new Date().toISOString(),
  });
}
