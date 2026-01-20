// src/components/AiVersionHud.tsx
"use client";

import { useEffect, useState } from "react";

type AiInfo = {
  ok: boolean;
  intentModel: string;
  motorModel: string;
  defaultModel: string;
  baseUrl: string;
  hasApiKey: boolean;
  nodeEnv: string;
  appVersion: string | null;
  ts: string;
};

type Stage = "intent" | "motor" | "execute";
type Phase = "start" | "end";

type StageEvent = {
  stage: Stage;
  phase: Phase;
  ok?: boolean;
  ms?: number;
  inChars?: number;
  outChars?: number;
  inTok?: number; // estimated
  outTok?: number; // estimated
};

type StageStat = {
  state: "idle" | "running" | "ok" | "fail";
  ms?: number;
  inTok?: number;
  outTok?: number;
  inChars?: number;
  outChars?: number;
  at?: number;
};

function fmtTime(t?: number) {
  if (!t) return "--:--:--";
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function statusColor(state: StageStat["state"]) {
  if (state === "ok") return "text-emerald-300";
  if (state === "fail") return "text-red-300";
  if (state === "running") return "text-yellow-300";
  return "text-zinc-500";
}

function statusText(state: StageStat["state"]) {
  if (state === "ok") return "OK ";
  if (state === "fail") return "FAIL";
  if (state === "running") return "RUN";
  return "IDLE";
}

function StageLine({
  tag,
  model,
  stat,
}: {
  tag: string;
  model?: string;
  stat: StageStat;
}) {
  const sColor = statusColor(stat.state);

  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-[70px] text-emerald-400">{tag}</span>

      <span className="inline-block w-[150px] text-cyan-300">
        {model ?? "-"}
      </span>

      <span className={`inline-block w-[44px] ${sColor}`}>
        {statusText(stat.state)}
      </span>

      <span className="inline-block w-[70px] text-zinc-300">
        {typeof stat.ms === "number" ? `${stat.ms}ms` : "--"}
      </span>

      <span className="inline-block w-[140px] text-zinc-400">
        {typeof stat.inTok === "number" ? `in~${stat.inTok}t` : "in~--"}
        {"  "}
        {typeof stat.outTok === "number" ? `out~${stat.outTok}t` : "out~--"}
      </span>

      <span className="text-zinc-500">{fmtTime(stat.at)}</span>
    </div>
  );
}

export default function AiVersionHud() {
  const [info, setInfo] = useState<AiInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // ✅ hydration-safe: 서버/클라 첫 렌더 동일하게 "unknown"
  const [host, setHost] = useState<string>("unknown");

  const [stats, setStats] = useState<Record<Stage, StageStat>>({
    intent: { state: "idle" },
    motor: { state: "idle" },
    execute: { state: "idle" },
  });

  const title = "C:\\MECHAVERSE> ai-status";

  const refresh = () => {
    setErr(null);
    fetch("/api/ai-info")
      .then((r) => r.json())
      .then((j: AiInfo) => setInfo(j))
      .catch((e) => setErr(e instanceof Error ? e.message : "refresh failed"));
  };

  useEffect(() => {
    // ✅ mount 후에만 host 업데이트 → hydration mismatch 방지
    try {
      setHost(window.location.host || "unknown");
    } catch {
      setHost("unknown");
    }

    refresh();

    const onAiEvent = (ev: Event) => {
      const ce = ev as CustomEvent<StageEvent>;
      const d = ce.detail;

      if (!d?.stage || !d?.phase) return;

      setStats((prev) => {
        const cur = prev[d.stage] ?? { state: "idle" };

        if (d.phase === "start") {
          return {
            ...prev,
            [d.stage]: {
              ...cur,
              state: "running",
              ms: undefined,
              outTok: undefined,
              outChars: undefined,
              inTok: typeof d.inTok === "number" ? d.inTok : cur.inTok,
              inChars: typeof d.inChars === "number" ? d.inChars : cur.inChars,
              at: Date.now(),
            },
          };
        }

        const ok = Boolean(d.ok);
        return {
          ...prev,
          [d.stage]: {
            state: ok ? "ok" : "fail",
            ms: typeof d.ms === "number" ? d.ms : cur.ms,
            inTok: typeof d.inTok === "number" ? d.inTok : cur.inTok,
            outTok: typeof d.outTok === "number" ? d.outTok : cur.outTok,
            inChars: typeof d.inChars === "number" ? d.inChars : cur.inChars,
            outChars: typeof d.outChars === "number" ? d.outChars : cur.outChars,
            at: Date.now(),
          },
        };
      });
    };

    window.addEventListener("ai:stage", onAiEvent as any);
    return () => window.removeEventListener("ai:stage", onAiEvent as any);
  }, []);

  return (
    <div className="fixed right-4 top-4 z-[60] select-none">
      <div className="w-[560px] rounded-md border border-emerald-400/40 bg-black/85 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="flex items-center justify-between border-b border-emerald-400/20 px-3 py-2">
          <div className="font-mono text-[11px] text-emerald-300">{title}</div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="rounded border border-emerald-400/30 px-2 py-0.5 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/10"
            >
              REFRESH
            </button>

            <button
              onClick={() => setCollapsed((v) => !v)}
              className="rounded border border-emerald-400/30 px-2 py-0.5 font-mono text-[10px] text-emerald-200 hover:bg-emerald-500/10"
            >
              {collapsed ? "OPEN" : "HIDE"}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="px-3 py-2 font-mono text-[11px] leading-4">
            <div className="text-zinc-400">
              <span className="text-emerald-400">[HOST]</span>{" "}
              <span className="text-cyan-300">{host}</span>{" "}
              <span className="text-zinc-500">
                {info?.appVersion ? `v${info.appVersion}` : "dev"}
              </span>{" "}
              <span className="text-zinc-500">env={info?.nodeEnv ?? "…"}</span>
            </div>

            <div className="mt-1 text-zinc-400">
              <span className="text-emerald-400">[API]</span>{" "}
              <span className="text-cyan-300">{info?.baseUrl ?? "…"}</span>{" "}
              <span className="text-zinc-500">key=</span>{" "}
              {info?.hasApiKey ? (
                <span className="text-emerald-300">OK</span>
              ) : (
                <span className="text-red-300">MISSING</span>
              )}
            </div>

            <div className="mt-2 border-t border-emerald-400/15 pt-2 text-zinc-400">
              <div className="text-zinc-500">
                <span className="text-emerald-400">[STAGE]</span>{" "}
                (model / status / ms / tok-est / time)
              </div>

              <div className="mt-1 space-y-1">
                <StageLine tag="[CHAT]" model={info?.intentModel} stat={stats.intent} />
                <StageLine tag="[MOTOR]" model={info?.motorModel} stat={stats.motor} />
                <StageLine tag="[EXEC]" model={"-"} stat={stats.execute} />
              </div>
            </div>

            {err && (
              <div className="mt-2 text-red-300">
                [ERR] <span className="text-red-200">{err}</span>
              </div>
            )}

            <div className="mt-2 text-zinc-600">
              tip: token은 <span className="text-zinc-500">chars/4</span> 추정치
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
