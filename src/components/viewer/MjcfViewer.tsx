"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useMujocoScene } from "@/hooks/useMujocoScene";
import { useRobot } from "@/hooks/useRobot";
import { RotateCcw, Brain, Loader2, Play } from "lucide-react";

import type { RLTrainingSummary, TaskPlannerPlan } from "@/types/rlTaskPlanner";
import { RL_EVENTS } from "@/types/rlTaskPlanner";

type EnvResetDonePayload = {
  obs: ArrayLike<number>;
  info?: {
    obsDim?: number;
    actionDim?: number;
    baseBodyId?: number;
    targetHeight?: number;
    frameSkip?: number;
    maxSteps?: number;
    actionMode?: string;
  };
};

type EnvStepDonePayload = {
  obs: ArrayLike<number>;
  reward: number;
  terminated: boolean;
  truncated: boolean;
  info?: {
    upright?: number;
    height?: number;
    targetHeight?: number;
    fallHeight?: number;
    termReason?: string | null;
    steps?: number;
    frameSkip?: number;
  };
};

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

function buildActionFromHint(
  dim: number,
  t: number,
  hint: TaskPlannerPlan["actionHint"] | null,
  actionMode?: string,
): Float32Array {
  if (dim <= 0) return new Float32Array(0);

  const amp0 = hint?.amp ?? 0.75;
  const speed0 = hint?.speed ?? 1.0;

  const bias =
    Array.isArray(hint?.bias) && hint!.bias!.length === dim ? hint!.bias! : null;
  const scale =
    Array.isArray(hint?.scale) && hint!.scale!.length === dim ? hint!.scale! : null;
  const phase =
    Array.isArray(hint?.phase) && hint!.phase!.length === dim ? hint!.phase! : null;

  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    const ph = phase ? phase[i] : i * 0.6;
    const sc = scale ? scale[i] : 1.0;
    const bi = bias ? bias[i] : 0.0;

    let v = Math.sin(t * speed0 + ph) * amp0 * sc + bi;

    if ((actionMode ?? "normalized") === "normalized") {
      v = clamp(v, -1, 1);
    }

    out[i] = v;
  }
  return out;
}

export default function MjcfViewer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeWindowRef = useRef<Window | null>(null);

  const { registerIframeWindow, resetPose, pauseSimulation, resumeSimulation } =
    useMujocoScene();

  const {
    activeRobotType,
    setActiveRobotType,
    setActiveRobotOwner,
    setActiveRobotName,
  } = useRobot();

  const [isTraining, setIsTraining] = useState(false);
  const isTrainingRef = useRef(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const isReplayingRef = useRef(false);

  const [trainingProgress, setTrainingProgress] = useState(0);
  const [trainingLogs, setTrainingLogs] = useState<string[]>([]);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [bestReward, setBestReward] = useState<number | null>(null);
  const [currentReward, setCurrentReward] = useState<number | null>(null);
  const [lastTrainingSummary, setLastTrainingSummary] = useState<{
    policyLabel: string;
    bestReward: number;
    episodes: number;
  } | null>(null);
  const [mockPolicyVersion, setMockPolicyVersion] = useState(1);
  const [hasReplayPolicy, setHasReplayPolicy] = useState(false);

  const trainingIntervalRef = useRef<number | null>(null);
  const trainingTimeoutRef = useRef<number | null>(null);
  const trainingStartRef = useRef<number>(0);

  const rlLoopIntervalRef = useRef<number | null>(null);
  const rlModeActiveRef = useRef(false);

  // reset 완료 전엔 step을 안 쏘도록
  const rlEnvReadyRef = useRef(false);

  const rlActionDimRef = useRef(0);
  const rlEpisodeCountRef = useRef(0);
  const rlEpisodeReturnRef = useRef(0);
  const currentPolicyLabelRef = useRef("");

  const episodeCountRef = useRef(0);
  const bestRewardRef = useRef<number | null>(null);
  const currentRewardRef = useRef<number | null>(null);

  const bestPolicyRef = useRef<{
    actions: Float32Array[];
    frameSkip: number;
  } | null>(null);
  const currentEpisodeActionsRef = useRef<Float32Array[]>([]);
  const currentEpisodeFrameSkipRef = useRef(5);

  const replayTimerRef = useRef<number | null>(null);
  const replayStateRef = useRef<{
    actions: Float32Array[];
    index: number;
    frameSkip: number;
  } | null>(null);

  const [highlightedBody, setHighlightedBody] = useState<string | null>(null);

  // RL summary / planner plan state
  const termReasonCountsRef = useRef<Record<string, number>>({});
  const lastEnvInfoRef = useRef<{
    obsDim: number;
    actionDim: number;
    baseBodyId?: number;
    targetHeight?: number;
    frameSkip: number;
    maxSteps: number;
    actionMode?: string;
  } | null>(null);

  const plannerPlanRef = useRef<TaskPlannerPlan | null>(null);

  const sendIframeMessage = useCallback((payload: Record<string, any>) => {
    const target = iframeWindowRef.current;
    if (!target) return;
    try {
      target.postMessage(payload, "*");
    } catch (err) {
      console.warn("Failed to post message to iframe", err);
    }
  }, []);

  useEffect(() => {
    if (activeRobotType !== "MJCF") {
      setActiveRobotType("MJCF");
      setActiveRobotOwner("placeholder");
      setActiveRobotName("humanoid");
    }
  }, [
    activeRobotType,
    setActiveRobotType,
    setActiveRobotOwner,
    setActiveRobotName,
  ]);

  // planner plan 적용 이벤트 수신
  useEffect(() => {
    const onApplyPlan = (ev: Event) => {
      const plan = (ev as CustomEvent<TaskPlannerPlan>).detail;
      plannerPlanRef.current = plan;

      if (plan?.goal) {
        setTrainingLogs((prev) => [...prev, `Planner goal: ${plan.goal}`].slice(-12));
      }

      if (plan?.rlConfig) {
        sendIframeMessage({ type: "RL_SET_CONFIG", config: plan.rlConfig });
      }
    };

    window.addEventListener(RL_EVENTS.applyPlan, onApplyPlan as any);
    return () => window.removeEventListener(RL_EVENTS.applyPlan, onApplyPlan as any);
  }, [sendIframeMessage]);

  const stopReplay = useCallback(() => {
    if (replayTimerRef.current !== null) {
      window.clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    replayStateRef.current = null;

    if (isReplayingRef.current) {
      isReplayingRef.current = false;
      setIsReplaying(false);
      sendIframeMessage({ type: "SET_MODE", mode: "interactive" });
      resumeSimulation();
    }
  }, [resumeSimulation, sendIframeMessage]);

  const stopRlLoop = useCallback(() => {
    rlEnvReadyRef.current = false;
    rlActionDimRef.current = 0;

    if (rlLoopIntervalRef.current !== null) {
      window.clearInterval(rlLoopIntervalRef.current);
      rlLoopIntervalRef.current = null;
    }
    if (rlModeActiveRef.current) {
      sendIframeMessage({ type: "SET_MODE", mode: "interactive" });
      rlModeActiveRef.current = false;
    }
  }, [sendIframeMessage]);

  const clearTrainingTimers = useCallback(() => {
    if (trainingIntervalRef.current !== null) {
      window.clearInterval(trainingIntervalRef.current);
      trainingIntervalRef.current = null;
    }
    if (trainingTimeoutRef.current !== null) {
      window.clearTimeout(trainingTimeoutRef.current);
      trainingTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    iframe.onerror = (error) => {
      console.error("[MJCF] iframe load error:", error);
    };

    const handleMessage = (event: MessageEvent) => {
      if (iframe.contentWindow && event.source === iframe.contentWindow) {
        iframeWindowRef.current = iframe.contentWindow;
      }

      switch (event.data?.type) {
        case "IFRAME_READY": {
          if (iframe.contentWindow) {
            iframeWindowRef.current = iframe.contentWindow;
            registerIframeWindow(iframe.contentWindow);
          }
          break;
        }
        case "ERROR": {
          console.error("Iframe error:", event.data.error);
          break;
        }
        case "SCENE_LOADED": {
          resumeSimulation();
          break;
        }
        case "BODY_MOUSEOVER": {
          setHighlightedBody(event.data.bodyName);
          break;
        }
        case "BODY_MOUSEOUT": {
          setHighlightedBody(null);
          break;
        }
        case "SET_MODE_DONE": {
          if (event.data.mode === "interactive") {
            rlModeActiveRef.current = false;
            if (!isTrainingRef.current && !isReplayingRef.current) {
              resumeSimulation();
            }
          } else if (event.data.mode === "rl") {
            rlModeActiveRef.current = true;
          }
          break;
        }

        case "RL_SET_CONFIG_DONE": {
          setTrainingLogs((prev) => [...prev, "RL config applied"].slice(-12));
          break;
        }

        case "ENV_RESET_DONE": {
          const payload = event.data as EnvResetDonePayload;

          rlEpisodeReturnRef.current = 0;
          rlActionDimRef.current = payload.info?.actionDim ?? 0;
          currentEpisodeActionsRef.current = [];
          currentEpisodeFrameSkipRef.current = payload.info?.frameSkip ?? 5;

          lastEnvInfoRef.current = {
            obsDim: payload.info?.obsDim ?? 0,
            actionDim: payload.info?.actionDim ?? 0,
            baseBodyId: payload.info?.baseBodyId,
            targetHeight: payload.info?.targetHeight,
            frameSkip: payload.info?.frameSkip ?? 5,
            maxSteps: payload.info?.maxSteps ?? 480,
            actionMode: payload.info?.actionMode,
          };

          rlEnvReadyRef.current = true;

          if (isTrainingRef.current) {
            const base = payload.info?.baseBodyId;
            const th = payload.info?.targetHeight;
            const ad = rlActionDimRef.current;

            const msg = `[${new Date().toLocaleTimeString()}] Reset env (actionDim=${ad}${
              base != null ? ` base=${base}` : ""
            }${th != null ? ` targetH=${Number(th).toFixed(3)}` : ""})`;
            setTrainingLogs((prev) => [...prev, msg].slice(-12));
          }

          if (isReplayingRef.current) {
            const rep = replayStateRef.current;
            if (rep) {
              rep.index = 0;
              if (replayTimerRef.current !== null) {
                window.clearInterval(replayTimerRef.current);
              }
              replayTimerRef.current = window.setInterval(() => {
                if (!isReplayingRef.current) return;
                const replay = replayStateRef.current;
                if (!replay || replay.index >= replay.actions.length) {
                  stopReplay();
                  return;
                }
                const action = Array.from(replay.actions[replay.index]);
                sendIframeMessage({ type: "ENV_STEP", action });
                replay.index += 1;
              }, 60);
            }
          }
          break;
        }

        case "ENV_STEP_DONE": {
          const payload = event.data as EnvStepDonePayload;
          const reward = Number(payload.reward ?? 0);
          const info = payload.info ?? {};

          if (isTrainingRef.current) {
            rlEpisodeReturnRef.current += reward;

            if ((info.steps ?? 0) % 40 === 0) {
              const stepMsg = `step ${String(info.steps ?? 0).padStart(
                3,
                "0",
              )} | reward=${reward.toFixed(2)} | upright=${(info.upright ?? 0).toFixed(
                2,
              )} | reason=${info.termReason ?? "-"}`;
              setTrainingLogs((prev) => [...prev, stepMsg].slice(-12));
            }

            if (payload.terminated || payload.truncated) {
              const tr = String(info.termReason ?? "unknown");
              termReasonCountsRef.current[tr] = (termReasonCountsRef.current[tr] ?? 0) + 1;

              const episodeReturn = rlEpisodeReturnRef.current;
              rlEpisodeReturnRef.current = 0;

              rlEpisodeCountRef.current += 1;
              episodeCountRef.current = rlEpisodeCountRef.current;
              setEpisodeCount(rlEpisodeCountRef.current);

              currentRewardRef.current = episodeReturn;
              setCurrentReward(episodeReturn);

              const isNewBest =
                bestRewardRef.current === null ||
                episodeReturn > (bestRewardRef.current as number);

              if (isNewBest) {
                bestRewardRef.current = episodeReturn;
                setBestReward(episodeReturn);
                bestPolicyRef.current = {
                  actions: currentEpisodeActionsRef.current.map((arr) =>
                    Float32Array.from(arr),
                  ),
                  frameSkip: currentEpisodeFrameSkipRef.current,
                };
                setHasReplayPolicy(true);
              }

              const epMsg = `ep ${String(rlEpisodeCountRef.current).padStart(
                2,
                "0",
              )} | return=${episodeReturn.toFixed(2)}${isNewBest ? " *" : ""} | upright=${(
                info.upright ?? 0
              ).toFixed(2)} | reason=${info.termReason ?? "-"}`;
              setTrainingLogs((prev) => [...prev, epMsg].slice(-12));

              currentEpisodeActionsRef.current = [];

              if (isTrainingRef.current) {
                rlEnvReadyRef.current = false;

                const nextSeed =
                  (Date.now() + rlEpisodeCountRef.current * 9973) >>> 0;

                sendIframeMessage({
                  type: "ENV_RESET",
                  seed: nextSeed,
                  frameSkip: info.frameSkip ?? currentEpisodeFrameSkipRef.current,
                });
              }
            }
          }

          break;
        }

        default:
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      registerIframeWindow(null);
    };
  }, [registerIframeWindow, resumeSimulation, sendIframeMessage, stopReplay]);

  const startRlLoop = useCallback(
    (options: {
      seed: number;
      frameSkip: number;
      maxSteps: number;
      actionMode: "normalized" | "direct";
    }) => {
      rlEnvReadyRef.current = false;
      rlActionDimRef.current = 0;
      rlEpisodeCountRef.current = 0;
      rlEpisodeReturnRef.current = 0;
      currentEpisodeActionsRef.current = [];
      currentEpisodeFrameSkipRef.current = options.frameSkip;

      sendIframeMessage({
        type: "SET_MODE",
        mode: "rl",
        options,
      });

      const planCfg = plannerPlanRef.current?.rlConfig;
      if (planCfg) {
        sendIframeMessage({ type: "RL_SET_CONFIG", config: planCfg });
      }

      sendIframeMessage({
        type: "ENV_RESET",
        ...options,
      });

      if (rlLoopIntervalRef.current !== null) {
        window.clearInterval(rlLoopIntervalRef.current);
      }

      rlLoopIntervalRef.current = window.setInterval(() => {
        if (!isTrainingRef.current) return;
        if (!rlEnvReadyRef.current) return;

        const dim = rlActionDimRef.current;
        const t = performance.now() / 650;

        const hint = plannerPlanRef.current?.actionHint ?? null;
        const actionMode =
          plannerPlanRef.current?.rlConfig?.actionMode ??
          lastEnvInfoRef.current?.actionMode ??
          options.actionMode;

        const action =
          dim > 0
            ? buildActionFromHint(dim, t, hint, actionMode)
            : new Float32Array(0);

        currentEpisodeActionsRef.current.push(Float32Array.from(action));
        sendIframeMessage({ type: "ENV_STEP", action: Array.from(action) });
      }, 60);
    },
    [sendIframeMessage],
  );

  const finalizeTraining = useCallback(
    (reason: "completed" | "cancelled") => {
      stopRlLoop();
      stopReplay();
      clearTrainingTimers();

      const finalBestRaw =
        typeof bestRewardRef.current === "number"
          ? bestRewardRef.current
          : typeof currentRewardRef.current === "number"
            ? currentRewardRef.current
            : 0;

      const finalBest = Number(finalBestRaw.toFixed(2));

      setBestReward(finalBest);
      setCurrentReward(finalBest);
      setIsTraining(false);
      isTrainingRef.current = false;
      setTrainingProgress(100);

      const tag = reason === "completed" ? "Training session complete" : "Training cancelled";
      const completionMsg = `[${new Date().toLocaleTimeString()}] ${tag}`;
      setTrainingLogs((prev) => [...prev, completionMsg].slice(-12));

      setLastTrainingSummary({
        policyLabel: currentPolicyLabelRef.current,
        bestReward: finalBest,
        episodes: rlEpisodeCountRef.current,
      });

      const env = lastEnvInfoRef.current;
      const summary: RLTrainingSummary = {
        when: new Date().toISOString(),
        policyLabel: currentPolicyLabelRef.current,
        episodes: rlEpisodeCountRef.current,

        bestReturn: finalBest,
        lastReturn:
          typeof currentRewardRef.current === "number" ? currentRewardRef.current : null,

        actionDim: env?.actionDim ?? rlActionDimRef.current ?? 0,
        obsDim: env?.obsDim ?? 0,

        frameSkip: env?.frameSkip ?? currentEpisodeFrameSkipRef.current ?? 5,
        maxSteps: env?.maxSteps ?? 480,

        actionMode: env?.actionMode ?? undefined,

        baseBodyId: env?.baseBodyId ?? null,
        targetHeight: env?.targetHeight ?? null,

        termReasonCounts: { ...termReasonCountsRef.current },
      };

      termReasonCountsRef.current = {};
      window.dispatchEvent(new CustomEvent(RL_EVENTS.trainingSummary, { detail: summary }));

      setMockPolicyVersion((prev) => prev + 1);

      bestRewardRef.current = null;
      currentRewardRef.current = null;

      resumeSimulation();
    },
    [clearTrainingTimers, resumeSimulation, stopReplay, stopRlLoop],
  );

  useEffect(() => {
    return () => {
      stopReplay();
      stopRlLoop();
      clearTrainingTimers();
    };
  }, [clearTrainingTimers, stopReplay, stopRlLoop]);

  // ===== TDZ 방지: 아래 useEffect에서 참조하는 콜백들을 먼저 선언 =====

  const playLearnedPolicy = useCallback(() => {
    if (isTrainingRef.current || isReplayingRef.current) return;
    const best = bestPolicyRef.current;
    if (!best || best.actions.length === 0) return;

    stopReplay();
    stopRlLoop();
    pauseSimulation();

    setIsReplaying(true);
    isReplayingRef.current = true;

    replayStateRef.current = {
      actions: best.actions.map((arr) => Float32Array.from(arr)),
      index: 0,
      frameSkip: best.frameSkip,
    };

    sendIframeMessage({
      type: "SET_MODE",
      mode: "rl",
      options: { frameSkip: best.frameSkip, maxSteps: best.actions.length },
    });

    const planCfg = plannerPlanRef.current?.rlConfig;
    if (planCfg) sendIframeMessage({ type: "RL_SET_CONFIG", config: planCfg });

    sendIframeMessage({
      type: "ENV_RESET",
      seed: Date.now() >>> 0,
      frameSkip: best.frameSkip,
    });
  }, [pauseSimulation, sendIframeMessage, stopReplay, stopRlLoop]);

  const startFakeTraining = useCallback(
    (durationMs?: number) => {
      if (isTrainingRef.current || isReplayingRef.current) return;

      clearTrainingTimers();
      stopReplay();
      stopRlLoop();
      pauseSimulation();

      const policyLabel = `MockPPO-v${mockPolicyVersion}`;
      currentPolicyLabelRef.current = policyLabel;

      // ✅ ChatWidget에서 넘어온 durationMs 반영
      const TRAINING_DURATION_MS =
        typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
          ? Math.min(10 * 60_000, Math.max(3_000, Math.round(durationMs)))
          : 15_000;

      bestPolicyRef.current = null;
      setHasReplayPolicy(false);

      isTrainingRef.current = true;
      setIsTraining(true);
      setTrainingProgress(0);
      setLastTrainingSummary(null);

      termReasonCountsRef.current = {};

      episodeCountRef.current = 0;
      rlEpisodeCountRef.current = 0;
      rlEpisodeReturnRef.current = 0;
      setEpisodeCount(0);

      bestRewardRef.current = null;
      setBestReward(null);
      currentRewardRef.current = null;
      setCurrentReward(null);

      const nowLabel = new Date().toLocaleTimeString();
      setTrainingLogs([
        `[${nowLabel}] Switching to RL stand task`,
        `[${nowLabel}] Requesting environment reset...`,
      ]);

      trainingStartRef.current = performance.now();

      const planCfg = plannerPlanRef.current?.rlConfig;

      const rlOptions = {
        seed: Date.now() >>> 0,
        frameSkip: typeof planCfg?.frameSkip === "number" ? planCfg.frameSkip : 5,
        maxSteps: typeof planCfg?.maxSteps === "number" ? planCfg.maxSteps : 480,
        actionMode: (planCfg?.actionMode === "direct" ? "direct" : "normalized") as const,
      };

      startRlLoop(rlOptions);

      trainingIntervalRef.current = window.setInterval(() => {
        const elapsed = performance.now() - trainingStartRef.current;
        const pct = Math.min(100, Math.round((elapsed / TRAINING_DURATION_MS) * 100));
        setTrainingProgress(pct);

        if (elapsed >= TRAINING_DURATION_MS) {
          window.clearInterval(trainingIntervalRef.current ?? undefined);
          trainingIntervalRef.current = null;

          trainingTimeoutRef.current = window.setTimeout(() => {
            finalizeTraining("completed");
          }, 600);
        }
      }, 450);
    },
    [
      clearTrainingTimers,
      finalizeTraining,
      mockPolicyVersion,
      pauseSimulation,
      startRlLoop,
      stopReplay,
      stopRlLoop,
    ],
  );

  // ✅ LLM chat -> RL control events
  useEffect(() => {
    const onStart = (ev: Event) => {
      const detail = (ev as CustomEvent<{ durationMs?: number }>).detail;
      startFakeTraining(detail?.durationMs);
    };

    const onStop = () => {
      if (isTrainingRef.current) finalizeTraining("cancelled");
    };

    const onReplay = () => {
      playLearnedPolicy();
    };

    window.addEventListener("rl:startTraining", onStart as any);
    window.addEventListener("rl:stopTraining", onStop as any);
    window.addEventListener("rl:replayPolicy", onReplay as any);

    return () => {
      window.removeEventListener("rl:startTraining", onStart as any);
      window.removeEventListener("rl:stopTraining", onStop as any);
      window.removeEventListener("rl:replayPolicy", onReplay as any);
    };
  }, [finalizeTraining, playLearnedPolicy, startFakeTraining]);

  const activePolicyLabel = isTraining
    ? currentPolicyLabelRef.current || `MockPPO-v${mockPolicyVersion}`
    : lastTrainingSummary?.policyLabel ?? `MockPPO-v${mockPolicyVersion}`;

  const displayedEpisodes = isTraining
    ? episodeCount
    : lastTrainingSummary?.episodes ?? episodeCount;

  const bestRewardValue = isTraining
    ? bestReward ?? currentReward ?? (episodeCount > 0 ? 0 : null)
    : lastTrainingSummary?.bestReward ?? bestReward;

  const lastRewardValue = isTraining
    ? currentReward
    : lastTrainingSummary?.bestReward ?? currentReward;

  const bestRewardDisplay =
    typeof bestRewardValue === "number" ? bestRewardValue.toFixed(2) : "–";

  const lastRewardDisplay =
    typeof lastRewardValue === "number" ? lastRewardValue.toFixed(2) : "–";

  const trainingButtonLabel = isTraining
    ? "Training..."
    : lastTrainingSummary
      ? "Retrain Policy"
      : "Mock Train";

  return (
    <div className="w-full h-full flex flex-row relative">
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--mujoco-scene-bg)",
          boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <iframe
          ref={iframeRef}
          src={"/mujoco/mujoco.html"}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          style={{
            width: "100%",
            height: "100%",
            margin: 0,
            padding: 0,
            border: "none",
            display: "block",
            background: "var(--mujoco-scene-bg)",
            borderRadius: "12px",
          }}
          title="MuJoCo Physics Viewer"
          loading="lazy"
          referrerPolicy="no-referrer"
        />

        {(isTraining || lastTrainingSummary || trainingLogs.length > 0) && (
          <div className="absolute top-3 left-3 z-10 w-[260px] text-[#5d4a0a]">
            <div className="space-y-2 rounded-xl border border-[#e7d7aa] bg-[#fff8e3]/95 p-3 shadow-sm backdrop-blur-sm">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="flex items-center gap-1">
                  <Brain size={14} className="text-[#7d6420]" />
                  Mock RL Console
                </span>
                {isTraining ? (
                  <span className="flex items-center gap-1 text-[#967b1e]">
                    <Loader2 size={12} className="animate-spin" />
                    training
                  </span>
                ) : isReplaying ? (
                  <span className="text-[#967b1e]">replay</span>
                ) : lastTrainingSummary ? (
                  <span className="text-[#967b1e]">ready</span>
                ) : null}
              </div>

              <div className="space-y-1 text-[11px] font-mono text-[#7d6a1e]">
                <div className="flex items-center justify-between">
                  <span>Policy</span>
                  <span>{activePolicyLabel}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Episodes</span>
                  <span>{displayedEpisodes}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Best return</span>
                  <span>{bestRewardDisplay}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last return</span>
                  <span>{lastRewardDisplay}</span>
                </div>
              </div>

              {isTraining && (
                <div className="space-y-1 pt-1">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-[#a78628]">
                    <span>progress</span>
                    <span>{trainingProgress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#f1e1b8]">
                    <div
                      className="h-full bg-[#c4a63b] transition-all duration-300 ease-out"
                      style={{ width: `${trainingProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#a78628]">
                  logs
                </div>
                <div className="mt-1 max-h-28 overflow-hidden rounded-md border border-[#ead9aa] bg-[#fffbea]/80 px-2 py-1.5">
                  {trainingLogs.length > 0 ? (
                    <ul className="space-y-1 text-[11px] leading-relaxed">
                      {trainingLogs.slice(-6).map((log, index) => (
                        <li key={`${index}-${log}`} className="truncate">
                          {log}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[11px] text-[#b29c5b]">Awaiting training…</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={resetPose}
          aria-label="Reset Pose"
          className="absolute top-3 right-3 z-10 bg-[#fefbf1] border-none rounded-lg p-2 cursor-pointer hover:bg-[#fefbf1]/80 transition-all"
        >
          <RotateCcw size={22} className="text-[#968612]" />
        </button>

        <div className="absolute bottom-4 left-4 z-10 flex gap-2">
          <button
            onClick={() => startFakeTraining()}
            disabled={isTraining || isReplaying}
            aria-label="Run mock training"
            className={`flex items-center justify-center gap-2 rounded-lg border-none p-2 font-mono text-sm transition-all ${
              isTraining || isReplaying
                ? "cursor-not-allowed bg-[#f2e6c2] text-[#a18a3d] opacity-70"
                : "cursor-pointer bg-[#fef4da] text-[#9b8632] hover:bg-[#f8eab5]"
            }`}
          >
            {isTraining ? (
              <Loader2 size={17} className="animate-spin text-[#967b1e]" />
            ) : (
              <Brain size={17} className="text-[#967b1e]" />
            )}
            {trainingButtonLabel}
          </button>

          <button
            onClick={playLearnedPolicy}
            disabled={!hasReplayPolicy || isTraining || isReplaying}
            aria-label="Replay learned policy"
            className={`flex items-center justify-center gap-2 rounded-lg border border-[#e6d6a0] p-2 font-mono text-sm transition-all ${
              !hasReplayPolicy || isTraining || isReplaying
                ? "cursor-not-allowed bg-[#f8edd1] text-[#b59a4e] opacity-60"
                : "cursor-pointer bg-[#fffdf2] text-[#9d8530] hover:bg-[#f8edd1]"
            }`}
          >
            {isReplaying ? (
              <Loader2 size={16} className="animate-spin text-[#8a731d]" />
            ) : (
              <Play size={16} className="text-[#8a731d]" />
            )}
            {isReplaying ? "Replaying..." : "Replay Policy"}
          </button>
        </div>

        {highlightedBody && (
          <div className="font-mono absolute bottom-4 right-4 text-[#9b8632] px-3 py-2 rounded-md text-sm z-10 flex items-center gap-2">
            <span className="opacity-80">hover:</span>
            {highlightedBody}
          </div>
        )}
      </div>
    </div>
  );
}
