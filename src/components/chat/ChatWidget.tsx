// src/components/chat/ChatWidget.tsx
"use client";

import { FormEvent, useState } from "react";
import { ChevronDown, Loader2, Mic, Plus, Sparkles } from "lucide-react";

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
    constraints?: Record<string, unknown>;
  };
  error?: string;
};

type MotorResponse = {
  motions: Array<{
    joint: string;
    angle: number;
    time: number;
    speed?: number;
  }>;
  error?: string;
};

type ExecuteResponse = {
  ok?: boolean;
  motions?: Array<{
    joint: string;
    angle: number;
    time?: number;
    speed?: number;
  }>;
  warnings?: string[];
  error?: string;
};

type JointLimits = Record<string, { lower?: number; upper?: number }>;
type UrdfMeta = { availableJoints: string[]; jointLimitsRadians: JointLimits };

const EMPTY_HINT = "LLM 답변은 이 자리에서 바로 확인할 수 있어요.";

const DEFAULT_JOINT_NAME_MAP: Record<string, string> = {};

const normalizeJointKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/joint/g, "")
    .trim();

function resolveJointName(
  llmJoint: string,
  available: string[],
  map: Record<string, string>,
): string | null {
  if (!llmJoint) return null;
  if (!Array.isArray(available) || available.length === 0) return null;

  const n = normalizeJointKey(llmJoint);

  const mapped = map[llmJoint] ?? map[llmJoint.toLowerCase()] ?? map[n] ?? null;
  if (mapped && available.includes(mapped)) return mapped;

  const exact = available.find((a) => a.toLowerCase() === llmJoint.toLowerCase());
  if (exact) return exact;

  const nExact = available.find((a) => normalizeJointKey(a) === n);
  if (nExact) return nExact;

  const partial = available.find((a) => {
    const an = normalizeJointKey(a);
    return an.includes(n) || n.includes(an);
  });
  if (partial) return partial;

  return null;
}

function getUrdfMetaFromWindowOrDom(): UrdfMeta | null {
  if (typeof window === "undefined") return null;

  const w = window as any;
  const jointsFromWindow: unknown = w.__URDF_JOINTS__;
  const limitsFromWindow: unknown = w.__URDF_JOINT_LIMITS__;

  const availableJoints =
    Array.isArray(jointsFromWindow) ? (jointsFromWindow as string[]) : [];

  const jointLimitsRadians =
    limitsFromWindow && typeof limitsFromWindow === "object"
      ? (limitsFromWindow as JointLimits)
      : {};

  if (availableJoints.length > 0) return { availableJoints, jointLimitsRadians };

  try {
    const viewer = document.querySelector("urdf-viewer") as any;
    const joints = viewer?.robot?.joints;
    if (joints && typeof joints === "object") {
      const keys = Object.keys(joints);
      const limits: JointLimits = {};

      for (const k of keys) {
        const j = joints[k];
        const lim = j?.limit ?? j?.limits ?? null;

        const lower =
          (typeof lim?.lower === "number" ? lim.lower : undefined) ??
          (typeof lim?.min === "number" ? lim.min : undefined);

        const upper =
          (typeof lim?.upper === "number" ? lim.upper : undefined) ??
          (typeof lim?.max === "number" ? lim.max : undefined);

        if (typeof lower === "number" || typeof upper === "number") limits[k] = { lower, upper };
      }

      return { availableJoints: keys, jointLimitsRadians: limits };
    }
  } catch {
    // ignore
  }

  return null;
}

function buildPlannerContext(meta: UrdfMeta | null): string | undefined {
  if (!meta?.availableJoints?.length) return undefined;

  const payload = {
    availableJoints: meta.availableJoints,
    jointLimitsRadians: meta.jointLimitsRadians,
  };

  return [
    `URDF_CONTEXT_JSON=${JSON.stringify(payload)}`,
    "",
    "Rules:",
    "- Use ONLY joints from availableJoints exactly (no invented names).",
    "- Angles are radians.",
    "- Respect jointLimitsRadians when provided. If missing, keep angles small (e.g. +/-0.3 rad).",
    "- time is milliseconds.",
  ].join("\n");
}

type Stage = "intent" | "motor" | "execute";
type Phase = "start" | "end";

function estTok(chars: number) {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  // 터미널 HUD용 대충 추정치(정확 토큰은 아님)
  return Math.max(1, Math.round(chars / 4));
}

function emitAiStage(detail: {
  stage: Stage;
  phase: Phase;
  ok?: boolean;
  ms?: number;
  inChars?: number;
  outChars?: number;
  inTok?: number;
  outTok?: number;
}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ai:stage", { detail }));
}

export default function ChatWidget() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = message.trim();
    if (!trimmed) return;

    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    const historyPayload = messages.map(({ role, content }) => ({ role, content }));

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);
    setError(null);

    try {
      const urdfMeta = getUrdfMetaFromWindowOrDom();
      const context = buildPlannerContext(urdfMeta);

      // ================================
      // 1) intent
      // ================================
      const intentReqBody = {
        message: trimmed,
        history: historyPayload,
        context,
      };
      const intentInChars = JSON.stringify(intentReqBody).length;
      emitAiStage({ stage: "intent", phase: "start", inChars: intentInChars, inTok: estTok(intentInChars) });

      const tIntent = performance.now();
      let intentResp: Response;
      let intentData: IntentResponse;

      try {
        intentResp = await fetch("/api/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intentReqBody),
        });

        intentData = (await intentResp.json()) as IntentResponse;
      } catch (e) {
        emitAiStage({ stage: "intent", phase: "end", ok: false, ms: Math.round(performance.now() - tIntent) });
        throw e;
      }

      const intentMs = Math.round(performance.now() - tIntent);
      const intentOutChars = JSON.stringify(intentData).length;

      emitAiStage({
        stage: "intent",
        phase: "end",
        ok: intentResp.ok,
        ms: intentMs,
        inChars: intentInChars,
        outChars: intentOutChars,
        inTok: estTok(intentInChars),
        outTok: estTok(intentOutChars),
      });

      if (!intentResp.ok) {
        throw new Error(intentData?.error || "명령 해석(intent)에 실패했습니다.");
      }

      const displayText = intentData?.text?.trim();
      if (displayText) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content: displayText },
        ]);
      }

      // ================================
      // 2) motor
      // ================================
      const motorReqBody = {
        intent: intentData.intent,
        context,
        message: trimmed,
      };
      const motorInChars = JSON.stringify(motorReqBody).length;
      emitAiStage({ stage: "motor", phase: "start", inChars: motorInChars, inTok: estTok(motorInChars) });

      const tMotor = performance.now();
      let motorResp: Response;
      let motorData: MotorResponse;

      try {
        motorResp = await fetch("/api/motor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(motorReqBody),
        });

        motorData = (await motorResp.json()) as MotorResponse;
      } catch (e) {
        emitAiStage({ stage: "motor", phase: "end", ok: false, ms: Math.round(performance.now() - tMotor) });
        throw e;
      }

      const motorMs = Math.round(performance.now() - tMotor);
      const motorOutChars = JSON.stringify(motorData).length;

      emitAiStage({
        stage: "motor",
        phase: "end",
        ok: motorResp.ok,
        ms: motorMs,
        inChars: motorInChars,
        outChars: motorOutChars,
        inTok: estTok(motorInChars),
        outTok: estTok(motorOutChars),
      });

      if (!motorResp.ok) {
        throw new Error(motorData?.error || "모터 모션 생성(motor compile)에 실패했습니다.");
      }

      if (!Array.isArray(motorData?.motions) || motorData.motions.length === 0) {
        throw new Error("motor API가 motions를 반환하지 않았습니다.");
      }

      // ================================
      // 3) execute (async)
      // ================================
      void (async () => {
        const execReqBody = { motions: motorData.motions, context };
        const execInChars = JSON.stringify(execReqBody).length;
        emitAiStage({ stage: "execute", phase: "start", inChars: execInChars, inTok: estTok(execInChars) });

        const tExec = performance.now();
        try {
          const execResponse = await fetch("/api/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(execReqBody),
          });

          const execData: ExecuteResponse | null = await execResponse.json().catch(() => null);
          const execMs = Math.round(performance.now() - tExec);

          const execOutChars = execData ? JSON.stringify(execData).length : 0;
          emitAiStage({
            stage: "execute",
            phase: "end",
            ok: execResponse.ok,
            ms: execMs,
            inChars: execInChars,
            outChars: execOutChars,
            inTok: estTok(execInChars),
            outTok: estTok(execOutChars),
          });

          if (!execResponse.ok) {
            console.warn("[execute] failed:", execResponse.status, execData);
            return;
          }

          const finalMotions =
            Array.isArray(execData?.motions) && execData!.motions!.length > 0
              ? execData!.motions!
              : motorData.motions;

          if (execData?.warnings?.length) console.info("[execute warnings]", execData.warnings);

          const latestMeta = getUrdfMetaFromWindowOrDom() ?? urdfMeta;
          const available = latestMeta?.availableJoints ?? [];

          const mappedMotions =
            available.length > 0
              ? finalMotions.map((m: any) => {
                  const resolved = resolveJointName(m.joint, available, DEFAULT_JOINT_NAME_MAP);
                  if (!resolved) return m;
                  return resolved !== m.joint ? { ...m, joint: resolved } : m;
                })
              : finalMotions;

          window.dispatchEvent(
            new CustomEvent("robot:moveJoints", {
              detail: {
                motions: mappedMotions,
                options: {
                  animate: true,
                  defaultDurationMs: 350,
                  jointNameMap: DEFAULT_JOINT_NAME_MAP,
                },
              },
            }),
          );
        } catch (e) {
          emitAiStage({ stage: "execute", phase: "end", ok: false, ms: Math.round(performance.now() - tExec) });
          console.error("[execute] error:", e);
        }
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 sm:right-auto sm:w-[360px]">
      <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.15)] backdrop-blur-xl">
        <h2 className="text-lg font-semibold text-[#1c1c1c]">어디서부터 시작할까요?</h2>

        <div className="mt-4 space-y-3">
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1 text-sm text-[#2f2f2f]">
            {messages.length === 0 ? (
              <p className="rounded-2xl border border-[#f3e9ce] bg-[#fffbf3] px-4 py-3 text-[#7d7256]">
                {EMPTY_HINT}
              </p>
            ) : (
              messages.map((item) => (
                <div
                  key={item.id}
                  className={`flex ${item.role === "assistant" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                      item.role === "assistant"
                        ? "border border-[#e7dcbd] bg-white text-[#3f381f]"
                        : "bg-[#121212] text-white"
                    }`}
                  >
                    {item.content}
                  </div>
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-[#7d7256]">
                <Loader2 className="h-4 w-4 animate-spin" />
                생각을 정리하고 있어요…
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <form className="flex flex-col gap-3" onSubmit={handleSubmit} role="search">
            <div className="flex items-center gap-3 rounded-2xl border border-[#efe4c8] bg-[#fffbf3] px-2.5 py-1.5">
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f2e7cc] bg-white text-[#968812] transition-colors hover:bg-[#fbf3dc]"
                aria-label="파일이나 프롬프트 템플릿 추가"
                disabled={isLoading}
              >
                <Plus className="h-5 w-5" strokeWidth={2.4} />
              </button>

              <input
                aria-label="LLM에게 질문하기"
                autoComplete="off"
                className="flex-1 bg-transparent text-base text-[#3a3425] placeholder:text-[#b9ae8f] focus:outline-none"
                onChange={(event) => setMessage(event.target.value)}
                placeholder="무엇이든 물어보세요"
                value={message}
              />

              <button
                type="submit"
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#121212] text-white transition-colors hover:bg-black disabled:opacity-60"
                aria-label="메시지 전송"
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.2} />
                ) : (
                  <Mic className="h-5 w-5" strokeWidth={2.2} />
                )}
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="flex w-max items-center gap-1.5 rounded-full border border-[#eee2c3] bg-white/80 px-4 py-2 text-sm text-[#5f5a4a] transition hover:bg-[#fdf7e6]"
                disabled
              >
                <Sparkles className="h-4 w-4 text-[#c59f34]" strokeWidth={2.4} />
                Extended thinking
                <ChevronDown className="h-4 w-4" strokeWidth={2.2} />
              </button>

              <p className="text-xs text-[#9b9076]">{EMPTY_HINT}</p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
