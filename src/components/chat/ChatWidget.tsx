// src/components/chat/ChatWidget.tsx
"use client";

import { FormEvent, useState } from "react";
import { ChevronDown, Loader2, Mic, Plus, Sparkles } from "lucide-react";

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type PlanResponse = {
  text: string;
  reasoning?: string;
  motions?: Array<{
    joint: string;
    angle: number;
    time: number;
  }>;
  error?: string;
};

type JointLimits = Record<string, { lower?: number; upper?: number }>;

type UrdfMeta = {
  availableJoints: string[];
  jointLimitsRadians: JointLimits;
};

const EMPTY_HINT = "LLM 답변은 이 자리에서 바로 확인할 수 있어요.";

// ✅ 여기에 “공식 alias”를 필요하면 추가해두면 됨 (가장 안정적)
const DEFAULT_JOINT_NAME_MAP: Record<string, string> = {
  // 예시:
  // shoulder_joint: "l_shoulder_pitch",
  // elbow_joint: "l_elbow_pitch",
};

const normalizeJointKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_\.]/g, "")
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

  // 0) 공식 매핑 우선
  const mapped =
    map[llmJoint] ??
    map[llmJoint.toLowerCase()] ??
    map[n] ??
    null;

  if (mapped && available.includes(mapped)) return mapped;

  // 1) exact match (case-insensitive)
  const exact = available.find((a) => a.toLowerCase() === llmJoint.toLowerCase());
  if (exact) return exact;

  // 2) normalized exact
  const nExact = available.find((a) => normalizeJointKey(a) === n);
  if (nExact) return nExact;

  // 3) includes heuristic
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

  // 1) UrdfViewer가 window에 노출해준 값 우선 사용
  const jointsFromWindow: unknown = w.__URDF_JOINTS__;
  const limitsFromWindow: unknown = w.__URDF_JOINT_LIMITS__;

  const availableJoints =
    Array.isArray(jointsFromWindow) ? (jointsFromWindow as string[]) : [];

  const jointLimitsRadians =
    limitsFromWindow && typeof limitsFromWindow === "object"
      ? (limitsFromWindow as JointLimits)
      : {};

  if (availableJoints.length > 0) {
    return { availableJoints, jointLimitsRadians };
  }

  // 2) fallback: DOM에서 직접 viewer 조회
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

        if (typeof lower === "number" || typeof upper === "number") {
          limits[k] = { lower, upper };
        }
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

  // 너무 길어지면 모델이 싫어할 수 있어서 limit는 있는 것만 보내고,
  // 그래도 길면 joints만 보내도 충분함.
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

    const historyPayload = messages.map(({ role, content }) => ({
      role,
      content,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);
    setError(null);

    try {
      // ✅ 현재 로드된 URDF 메타를 Planner에 전달 (joint 이름 mismatch 방지 핵심)
      const urdfMeta = getUrdfMetaFromWindowOrDom();
      const context = buildPlannerContext(urdfMeta);

      // 1) Planner 호출
      const planResponse = await fetch("/api/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload,
          context,
        }),
      });

      const planData: PlanResponse = await planResponse.json();

      if (!planResponse.ok) {
        throw new Error(planData?.error || "모션 플랜을 가져오지 못했습니다.");
      }

      // 2) Planner의 설명 텍스트 표시
      const displayText = planData?.text?.trim();
      if (displayText) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: displayText,
          },
        ]);
      }

      // 3) 모션 실행기 호출 (+ viewer로 이벤트 전달)
      if (Array.isArray(planData?.motions) && planData.motions.length > 0) {
        void (async () => {
          try {
            const execResponse = await fetch("/api/execute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ motions: planData.motions }),
            });

            const execData = await execResponse.json().catch(() => null);

            // ✅ execute 결과(또는 fallback) motions를 viewer로 전달
            if (execResponse.ok && typeof window !== "undefined") {
              const finalMotions =
                (Array.isArray(execData?.motions) && execData.motions.length > 0)
                  ? execData.motions
                  : planData.motions;

              // ✅ 핵심: 이벤트 디스패치 전에 joint 이름을 가능한 경우 실제 URDF joint로 변환
              const latestMeta = getUrdfMetaFromWindowOrDom() ?? urdfMeta;
              const available = latestMeta?.availableJoints ?? [];

              const mappedMotions = (available.length > 0)
                ? finalMotions.map((m: any) => {
                    const resolved = resolveJointName(m.joint, available, DEFAULT_JOINT_NAME_MAP);
                    if (!resolved) {
                      console.warn("[ChatWidget] unresolved joint:", m.joint);
                      return m; // 변환 실패하면 그대로 전달 (UrdfViewer에서 2차 resolve)
                    }
                    if (resolved !== m.joint) {
                      console.info("[ChatWidget] joint mapped:", m.joint, "->", resolved);
                    }
                    return { ...m, joint: resolved };
                  })
                : finalMotions;

              window.dispatchEvent(
                new CustomEvent("robot:moveJoints", {
                  detail: {
                    motions: mappedMotions,
                    options: {
                      animate: true,
                      defaultDurationMs: 350,
                      // ✅ UrdfViewer에서 2차로 mapping 쓰고 싶으면 같이 전달
                      jointNameMap: DEFAULT_JOINT_NAME_MAP,
                    },
                  },
                }),
              );

              console.log(
                "[ChatWidget] 이벤트 발송:",
                mappedMotions.length,
                "개 모션",
                available.length ? `(URDF joints loaded: ${available.length})` : "(URDF joints not ready)",
              );
            } else if (!execResponse.ok) {
              console.warn("[execute] 실패:", execResponse.status, execData);
            }
          } catch (e) {
            console.error("[execute] 에러:", e);
          }
        })();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 sm:right-auto sm:w-[360px]">
      <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_60px_rgba(0,0,0,0.15)] backdrop-blur-xl">
        <h2 className="text-lg font-semibold text-[#1c1c1c]">
          어디서부터 시작할까요?
        </h2>

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
                  className={`flex ${
                    item.role === "assistant" ? "justify-start" : "justify-end"
                  }`}
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
