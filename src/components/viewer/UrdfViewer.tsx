// src/components/viewer/UrdfViewer.tsx
"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { cn } from "@/lib/utils";

import { useRobot } from "@/hooks/useRobot";
import { useExampleRobots } from "@/hooks/useExampleRobots";
import { useUrdfRuntime } from "@/hooks/useUrdfRuntime";
import {
  createUrdfViewer,
  setupMeshLoader,
  setupJointHighlighting,
  setupModelLoading,
  setupJointLimits,
  URDFViewerElement,
} from "@/components/viewer/urdfViewerHelpers";
import * as THREE from "three";

const defaultUrdfPath = "/urdf/cassie/cassie.urdf";
let registrationPromise: Promise<void> | null = null;

const registerUrdfManipulator = async (): Promise<void> => {
  if (typeof window === "undefined") return;
  if (customElements.get("urdf-viewer")) return;

  if (!registrationPromise) {
    registrationPromise = (async () => {
      try {
        const urdfModule = await import("urdf-loader/src/urdf-manipulator-element.js");
        const UrdfManipulatorElement = urdfModule.default;

        if (!customElements.get("urdf-viewer")) {
          try {
            customElements.define("urdf-viewer", UrdfManipulatorElement);
          } catch (defineError) {
            const name = (defineError as { name?: string })?.name;
            const message = (defineError as Error)?.message || "";
            const isDuplicate =
              name === "NotSupportedError" || message.includes("has already been used");
            if (!isDuplicate) throw defineError;
          }
        }
      } catch (e) {
        registrationPromise = null;
        throw e;
      }
    })();
  }

  return registrationPromise;
};

// ============================================================================
// Motion Types & Helper Functions
// ============================================================================
type MoveJointMotion = { joint: string; angle: number; time?: number; speed?: number };
type MoveJointsOptions = {
  animate?: boolean;
  defaultDurationMs?: number;
  assumeDegrees?: boolean;
  jointNameMap?: Record<string, string>;
};
type MoveJointsDetail = { motions: MoveJointMotion[]; options?: MoveJointsOptions };

type JointLimits = Record<string, { lower?: number; upper?: number }>;
type UrdfMeta = { availableJoints: string[]; jointLimitsRadians: JointLimits };

const toRadians = (angle: number, assumeDegrees?: boolean) => {
  const TWO_PI = Math.PI * 2;
  if (assumeDegrees) return (angle * Math.PI) / 180;
  // 휴리스틱: 2π보다 크면 deg라고 가정
  if (Math.abs(angle) > TWO_PI + 1e-3) return (angle * Math.PI) / 180;
  return angle;
};

const readUrdfMetaFromViewer = (viewer: any): UrdfMeta | null => {
  const joints = viewer?.robot?.joints;
  if (!joints || typeof joints !== "object") return null;

  const names = Object.keys(joints);
  const jointLimitsRadians: JointLimits = {};

  for (const name of names) {
    const j = joints[name];
    const lim = j?.limit ?? j?.limits ?? null;

    const lower =
      (typeof lim?.lower === "number" ? lim.lower : undefined) ??
      (typeof lim?.min === "number" ? lim.min : undefined);

    const upper =
      (typeof lim?.upper === "number" ? lim.upper : undefined) ??
      (typeof lim?.max === "number" ? lim.max : undefined);

    if (typeof lower === "number" || typeof upper === "number") {
      jointLimitsRadians[name] = { lower, upper };
    }
  }

  return { availableJoints: names, jointLimitsRadians };
};

const exposeUrdfMetaToWindow = (viewer: any) => {
  if (typeof window === "undefined") return;
  const meta = readUrdfMetaFromViewer(viewer);
  if (!meta) return;

  (window as any).__URDF_JOINTS__ = meta.availableJoints;
  (window as any).__URDF_JOINT_LIMITS__ = meta.jointLimitsRadians;

  // 디버깅용 (원하면)
  (window as any).__URDF_VIEWER__ = viewer;
};

const getJointValue = (viewer: any, jointName: string): number => {
  const j = viewer?.robot?.joints?.[jointName];
  const v = j?.jointValue ?? j?.angle ?? j?.value;
  return typeof v === "number" ? v : 0;
};

const clampToJointLimits = (viewer: any, jointName: string, angleRad: number): number => {
  const j = viewer?.robot?.joints?.[jointName];
  const lim = j?.limit ?? j?.limits ?? null;

  const lower =
    (typeof lim?.lower === "number" ? lim.lower : undefined) ??
    (typeof lim?.min === "number" ? lim.min : undefined);

  const upper =
    (typeof lim?.upper === "number" ? lim.upper : undefined) ??
    (typeof lim?.max === "number" ? lim.max : undefined);

  let out = angleRad;
  if (typeof lower === "number" && out < lower) out = lower;
  if (typeof upper === "number" && out > upper) out = upper;
  return out;
};

// --------------------
// Robust joint resolver (exact/normalized/includes/similarity + ambiguous 방지)
// --------------------
const normKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\.|-/g, "_")
    .replace(/\s+/g, "_")
    .replace(/__+/g, "_")
    .replace(/(^_+|_+$)/g, "")
    .replace(/(joint|jnt)$/g, "")
    .replace(/_joint$/g, "");

const tokens = (s: string) =>
  normKey(s)
    .split("_")
    .filter(Boolean)
    .map((t) => {
      if (t === "left") return "l";
      if (t === "right") return "r";
      return t;
    });

const tokenSim = (a: string, b: string) => {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;

  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
};

const levenshtein = (a: string, b: string) => {
  const s = normKey(a);
  const t = normKey(b);
  const n = s.length;
  const m = t.length;
  if (!n) return m;
  if (!m) return n;

  const dp = new Array(m + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= n; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[m];
};

const editSim = (a: string, b: string) => {
  const s = normKey(a);
  const t = normKey(b);
  const dist = levenshtein(s, t);
  const maxLen = Math.max(s.length, t.length) || 1;
  return 1 - dist / maxLen;
};

type ResolveInfo = {
  joint: string | null;
  confidence: number; // 0~1
  reason: string;
  candidates?: Array<{ name: string; score: number }>;
};

const resolveJointTarget = (
  viewer: any,
  requested: string,
  map?: Record<string, string>,
): ResolveInfo => {
  const joints = viewer?.robot?.joints;
  if (!joints) return { joint: null, confidence: 0, reason: "no-joints" };

  const keys = Object.keys(joints);
  if (!keys.length) return { joint: null, confidence: 0, reason: "no-keys" };

  const reqRaw = requested ?? "";
  const reqNorm = normKey(reqRaw);

  // 0) explicit map
  const mapped =
    (map?.[reqRaw] ??
      map?.[reqRaw.toLowerCase()] ??
      map?.[reqNorm] ??
      null) ?? reqRaw;

  if (joints[mapped]) {
    return { joint: mapped, confidence: map ? 1 : 1, reason: map ? "explicit-map" : "exact" };
  }

  const mappedNorm = normKey(mapped);

  // 1) normalized exact
  const nExact = keys.find((k) => normKey(k) === mappedNorm);
  if (nExact) return { joint: nExact, confidence: 0.98, reason: "normalized-exact" };

  // 2) includes
  const partial = keys.find((k) => {
    const kn = normKey(k);
    return kn.includes(mappedNorm) || mappedNorm.includes(kn);
  });
  if (partial) return { joint: partial, confidence: 0.85, reason: "includes" };

  // 3) similarity scoring
  const scored = keys
    .map((name) => {
      const s1 = tokenSim(mapped, name);
      const s2 = editSim(mapped, name);
      const score = 0.6 * s1 + 0.4 * s2;
      return { name, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const best = scored[0];
  if (!best) return { joint: null, confidence: 0, reason: "no-candidates" };

  const threshold = 0.78;
  if (best.score < threshold) {
    return {
      joint: null,
      confidence: best.score,
      reason: "below-threshold",
      candidates: scored,
    };
  }

  // ambiguous 방지: 1,2등 점수 차이가 너무 작으면 매칭 거부
  const second = scored[1];
  if (second && Math.abs(best.score - second.score) < 0.03) {
    return {
      joint: null,
      confidence: best.score,
      reason: "ambiguous",
      candidates: scored,
    };
  }

  return {
    joint: best.name,
    confidence: best.score,
    reason: "similarity",
    candidates: scored,
  };
};

// ============================================================================

const UrdfViewer: React.FC = () => {
  const [highlightedJoint, setHighlightedJoint] = useState<string | null>(null);
  const { activeRobotOwner, activeRobotName } = useRobot();
  const { registerUrdfProcessor } = useUrdfRuntime();
  const { examples } = useExampleRobots();

  const viewerRef = useRef<URDFViewerElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [customUrdfPath, setCustomUrdfPath] = useState<string | null>(null);

  // ✅ 함수를 객체로 감싸서 저장
  const [urlModifierFunc, setUrlModifierFunc] = useState<{
    func: ((url: string) => string) | null;
  }>({ func: null });

  // ============================================================================
  // Motion Animation State
  // ============================================================================
  const pendingMoveRef = useRef<MoveJointsDetail | null>(null);
  const rafRef = useRef<number | null>(null);

  // ============================================================================
  // Motion Application Function
  // ============================================================================
  const applyMotionsToViewer = (viewer: any, motions: MoveJointMotion[], options?: MoveJointsOptions) => {
    if (!viewer || typeof viewer.setJointValue !== "function") return;
    if (!Array.isArray(motions) || motions.length === 0) return;

    // 모델 로드 후 meta 노출 (ChatWidget에서 /api/plan context로 쓰게)
    exposeUrdfMetaToWindow(viewer);

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const animate = options?.animate ?? true;
    const defaultDurationMs = options?.defaultDurationMs ?? 350;
    const assumeDegrees = options?.assumeDegrees ?? false;
    const jointNameMap = options?.jointNameMap ?? {};

    const jointKeys = Object.keys(viewer?.robot?.joints ?? {});
    (window as any).__URDF_JOINTS__ = jointKeys;

    const items: Array<{ joint: string; from: number; to: number; durationMs: number }> = [];

    for (const m of motions) {
      const res = resolveJointTarget(viewer, m.joint, jointNameMap);
      if (!res.joint) {
        console.warn(`[UrdfViewer] joint resolve failed: "${m.joint}" (${res.reason}, conf=${res.confidence.toFixed(2)})`);
        if (res.candidates?.length) console.warn("[UrdfViewer] candidates:", res.candidates);
        continue;
      }

      const raw = typeof m.time === "number" && m.time > 0 ? m.time : defaultDurationMs;
      // 기존 휴리스틱 유지: 20 미만이면 seconds로 보고 ms로 변환
      const durationMs = raw < 20 ? raw * 1000 : raw;

      let to = toRadians(m.angle, assumeDegrees);
      to = clampToJointLimits(viewer, res.joint, to);

      items.push({
        joint: res.joint,
        from: getJointValue(viewer, res.joint),
        to,
        durationMs,
      });
    }

    if (!items.length) return;

    if (!animate) {
      for (const it of items) viewer.setJointValue(it.joint, it.to);
      viewer.redraw?.();
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      let running = false;

      for (const it of items) {
        const t = Math.min(1, (now - start) / it.durationMs);
        const value = it.from + (it.to - it.from) * t;
        viewer.setJointValue(it.joint, value);
        if (t < 1) running = true;
      }

      viewer.redraw?.();

      if (running) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  // ============================================================================
  // Event Listener for robot:moveJoints
  // ============================================================================
  useEffect(() => {
    const handler = (evt: Event) => {
      const raw = (evt as CustomEvent).detail as any;

      const detail: MoveJointsDetail | null =
        raw && Array.isArray(raw.motions) ? raw : null;

      if (!detail?.motions?.length) return;

      const viewer = viewerRef.current as any;

      if (!viewer?.robot) {
        pendingMoveRef.current = detail;
        console.info("[UrdfViewer] viewer not ready yet. queued motions.");
        return;
      }

      applyMotionsToViewer(viewer, detail.motions, detail.options);
    };

    window.addEventListener("robot:moveJoints", handler as EventListener);

    return () => {
      window.removeEventListener("robot:moveJoints", handler as EventListener);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // ============================================================================
  // URDF Processor
  // ============================================================================
  const urdfProcessor = useMemo(
    () => ({
      loadUrdf: (urdfPath: string) => {
        setCustomUrdfPath(urdfPath);
      },
      setUrlModifierFunc: (func: (url: string) => string) => {
        setUrlModifierFunc({ func }); // ✅ 객체로 감싸서 저장
      },
    }),
    [],
  );

  useEffect(() => {
    registerUrdfProcessor(urdfProcessor);
  }, [registerUrdfProcessor, urdfProcessor]);

  // ============================================================================
  // Viewer Setup
  // ============================================================================
  useEffect(() => {
    if (!containerRef.current) return;

    const cleanupFunctions: (() => void)[] = [];

    registerUrdfManipulator().then(() => {
      const viewer = createUrdfViewer(containerRef.current!);
      viewerRef.current = viewer;

      setupMeshLoader(viewer, urlModifierFunc.func); // ✅ .func 접근

      let urdfPath = defaultUrdfPath;
      if (examples && activeRobotOwner && activeRobotName) {
        const match = examples.find(
          (ex) => ex.owner === activeRobotOwner && ex.repo_name === activeRobotName,
        );
        if (match?.fileType === "URDF" && match.path) {
          urdfPath = match.path;
        }
      }

      if (urdfPath) {
        setupModelLoading(viewer, urdfPath);
      }

      const onModelProcessed = async () => {
        if (viewerRef.current) {
          fitRobotToView(viewerRef.current);

          try {
            await setupJointLimits(viewerRef.current, urdfPath);
          } catch (error) {
            console.warn("Failed to setup joint limits:", error);
          }

          // ✅ URDF meta 노출 (Planner context / 디버깅용)
          exposeUrdfMetaToWindow(viewerRef.current);

          const pending = pendingMoveRef.current;
          if (pending && viewerRef.current) {
            applyMotionsToViewer(viewerRef.current as any, pending.motions, pending.options);
            pendingMoveRef.current = null;
          }
        }
      };

      const cleanupJointHighlighting = setupJointHighlighting(viewer, setHighlightedJoint);
      cleanupFunctions.push(cleanupJointHighlighting);

      viewer.addEventListener("urdf-processed", onModelProcessed);
      cleanupFunctions.push(() => {
        viewer.removeEventListener("urdf-processed", onModelProcessed);
      });
    });

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  }, [urlModifierFunc, examples, activeRobotOwner, activeRobotName]);

  // ============================================================================
  // Fit Robot to View
  // ============================================================================
  const fitRobotToView = (viewer: URDFViewerElement) => {
    if (!viewer || !viewer.robot) {
      return;
    }

    try {
      const boundingBox = new THREE.Box3().setFromObject(viewer.robot);
      const center = new THREE.Vector3();
      boundingBox.getCenter(center);

      const size = new THREE.Vector3();
      boundingBox.getSize(size);

      const maxDim = Math.max(size.x, size.y, size.z);

      const isoDirection = new THREE.Vector3(1, 1, 1).normalize();
      const distance = maxDim * 1.8;
      const position = center.clone().add(isoDirection.multiplyScalar(distance));
      viewer.camera.position.copy(position);
      viewer.controls.target.copy(center);

      viewer.controls.update();
      viewer.redraw();
    } catch (error) {
      console.error("[UrdfViewer] Error fitting robot to view:", error);
    }
  };

  // ============================================================================
  // Robot Selection Change
  // ============================================================================
  useEffect(() => {
    if (!viewerRef.current) return;
    if (!examples || !activeRobotOwner || !activeRobotName) return;

    const match = examples.find(
      (ex) => ex.owner === activeRobotOwner && ex.repo_name === activeRobotName,
    );
    if (!match || match.fileType !== "URDF" || !match.path) return;

    const urdfPath = match.path;

    viewerRef.current.removeAttribute("urdf");

    setTimeout(() => {
      if (viewerRef.current) {
        setupMeshLoader(viewerRef.current, urlModifierFunc.func);

        const onUrdfProcessed = async () => {
          if (viewerRef.current) {
            fitRobotToView(viewerRef.current);

            try {
              await setupJointLimits(viewerRef.current, urdfPath);
            } catch (error) {
              console.warn("Failed to setup joint limits:", error);
            }

            // ✅ meta 노출
            exposeUrdfMetaToWindow(viewerRef.current);

            const pending = pendingMoveRef.current;
            if (pending && viewerRef.current) {
              applyMotionsToViewer(viewerRef.current as any, pending.motions, pending.options);
              pendingMoveRef.current = null;
            }
          }

          viewerRef.current?.removeEventListener("urdf-processed", onUrdfProcessed);
        };

        viewerRef.current.addEventListener("urdf-processed", onUrdfProcessed);

        viewerRef.current.setAttribute("urdf", urdfPath);

        viewerRef.current.redraw?.();
      }
    }, 100);
  }, [examples, activeRobotOwner, activeRobotName, urlModifierFunc]);

  // ============================================================================
  // Custom URDF Drop
  // ============================================================================
  useEffect(() => {
    if (!viewerRef.current || !customUrdfPath) return;

    const loadPath =
      customUrdfPath.startsWith("blob:") && !customUrdfPath.includes("#.")
        ? customUrdfPath + "#.urdf"
        : customUrdfPath;

    viewerRef.current.removeAttribute("urdf");

    setTimeout(() => {
      if (viewerRef.current) {
        setupMeshLoader(viewerRef.current, urlModifierFunc.func);

        const onUrdfProcessed = async () => {
          if (viewerRef.current) {
            fitRobotToView(viewerRef.current);

            try {
              await setupJointLimits(viewerRef.current, loadPath);
            } catch (error) {
              console.warn("Failed to setup joint limits:", error);
            }

            // ✅ meta 노출
            exposeUrdfMetaToWindow(viewerRef.current);

            const pending = pendingMoveRef.current;
            if (pending && viewerRef.current) {
              applyMotionsToViewer(viewerRef.current as any, pending.motions, pending.options);
              pendingMoveRef.current = null;
            }
          }

          viewerRef.current?.removeEventListener("urdf-processed", onUrdfProcessed);
        };

        viewerRef.current.addEventListener("urdf-processed", onUrdfProcessed);

        viewerRef.current.setAttribute("urdf", loadPath);

        viewerRef.current.redraw?.();
      }
    }, 100);
  }, [customUrdfPath, urlModifierFunc]);

  // ============================================================================
  // URL Modifier Update
  // ============================================================================
  useEffect(() => {
    if (!viewerRef.current) return;
    setupMeshLoader(viewerRef.current, urlModifierFunc.func);
  }, [urlModifierFunc]);

  return (
    <div className={cn("w-full h-full transition-all duration-300 ease-in-out relative rounded-xl")}>
      <div ref={containerRef} className="w-full h-full absolute inset-0" />

      {highlightedJoint && (
        <div className="font-mono absolute bottom-4 right-4 text-[#9b8632] px-3 py-2 rounded-md text-sm z-10 flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="17"
            height="16"
            viewBox="0 0 17 16"
            fill="none"
          >
            <mask
              id="mask0_2_350"
              style={{ maskType: "alpha" }}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="17"
              height="16"
            >
              <rect x="0.5" width="16" height="16" fill="#D9D9D9" />
            </mask>
            <g mask="url(#mask0_2_350)">
              <path
                d="M4.15006 14C3.87229 14 3.63618 13.9028 3.44173 13.7083C3.24729 13.5139 3.15007 13.2778 3.15007 13C3.15007 12.7222 3.24729 12.4861 3.44173 12.2916C3.63618 12.0972 3.87229 12 4.15006 12H5.21673L3.51673 6.43331C3.21673 6.26664 2.96951 6.0222 2.77507 5.69997C2.58062 5.37775 2.4834 5.03331 2.4834 4.66664C2.4834 4.11109 2.67784 3.63886 3.06673 3.24997C3.45562 2.86109 3.92784 2.66664 4.4834 2.66664C4.91673 2.66664 5.30284 2.79164 5.64173 3.04164C5.98062 3.29164 6.21673 3.61109 6.35006 3.99997H8.4834V3.33331C8.4834 3.14442 8.54729 2.98609 8.67507 2.85831C8.80284 2.73053 8.96118 2.66664 9.15006 2.66664C9.25006 2.66664 9.34729 2.68886 9.44173 2.73331C9.53618 2.77775 9.61673 2.84442 9.6834 2.93331L10.8167 1.86664C10.9167 1.76664 11.0362 1.70275 11.1751 1.67497C11.314 1.6472 11.4501 1.66664 11.5834 1.73331L14.1834 2.93331C14.3167 2.99997 14.4084 3.0972 14.4584 3.22497C14.5084 3.35275 14.5056 3.47775 14.4501 3.59997C14.3834 3.73331 14.2862 3.81942 14.1584 3.85831C14.0306 3.8972 13.9056 3.88886 13.7834 3.83331L11.3834 2.73331L9.81673 4.19997V5.13331L11.3834 6.56664L13.7834 5.46664C13.9056 5.41109 14.0334 5.40553 14.1667 5.44997C14.3001 5.49442 14.3945 5.57775 14.4501 5.69997C14.5167 5.83331 14.5223 5.96109 14.4667 6.08331C14.4112 6.20553 14.3167 6.29997 14.1834 6.36664L11.5834 7.59997C11.4501 7.66664 11.314 7.68609 11.1751 7.65831C11.0362 7.63053 10.9167 7.56664 10.8167 7.46664L9.6834 6.39997C9.61673 6.46664 9.53618 6.52775 9.44173 6.58331C9.34729 6.63886 9.25006 6.66664 9.15006 6.66664C8.96118 6.66664 8.80284 6.60275 8.67507 6.47497C8.54729 6.3472 8.4834 6.18886 8.4834 5.99997V5.33331H6.35006C6.31673 5.4222 6.28062 5.50553 6.24173 5.58331C6.20284 5.66109 6.15006 5.74442 6.0834 5.83331L9.41673 12H10.8167C11.0945 12 11.3306 12.0972 11.5251 12.2916C11.7195 12.4861 11.8167 12.7222 11.8167 13C11.8167 13.2778 11.7195 13.5139 11.5251 13.7083C11.3306 13.9028 11.0945 14 10.8167 14H4.15006ZM4.4834 5.33331C4.67229 5.33331 4.83062 5.26942 4.9584 5.14164C5.08618 5.01386 5.15006 4.85553 5.15006 4.66664C5.15006 4.47775 5.08618 4.31942 4.9584 4.19164C4.83062 4.06386 4.67229 3.99997 4.4834 3.99997C4.29451 3.99997 4.13618 4.06386 4.0084 4.19164C3.88062 4.31942 3.81673 4.47775 3.81673 4.66664C3.81673 4.85553 3.88062 5.01386 4.0084 5.14164C4.13618 5.26942 4.29451 5.33331 4.4834 5.33331ZM6.5834 12H7.8834L5.01673 6.66664H4.95006L6.5834 12Z"
                fill="#968612"
              />
            </g>
          </svg>
          {highlightedJoint}
        </div>
      )}
    </div>
  );
};

export default UrdfViewer;
