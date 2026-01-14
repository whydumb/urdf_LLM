// src/components/viewer/urdfHardwareBridge.ts
import type { URDFViewerElement } from "./urdfViewer"; // TODO: 실제 파일명으로 맞추기

export type HwBridgeOutgoing =
  | {
      type: "cmd_joint";
      joints: Record<string, number>; // viewer joint or mapped hw joint
      units: "rad";
      seq: number;
      ts: number;
    }
  | {
      type: "cmd_torque";
      enabled: boolean;
      seq: number;
      ts: number;
    }
  | { type: "ping"; ts: number };

export type HwBridgeIncoming =
  | {
      type: "state_joint";
      joints: Record<string, number>;
      units?: "rad" | "deg";
      ts?: number;
      errors?: Record<string, number>;
    }
  | { type: "pong"; ts?: number }
  | { type: "ack"; seq?: number; ok?: boolean; err?: string };

export type ViewerHardwareBridgeOptions = {
  wsUrl: string;

  /**
   * viewer joint name -> hardware joint name(or servo id as string)
   * 예: { ax12a_joint: "1" }  // 백엔드가 "1"을 서보ID로 해석
   * 예: { ax12a_joint: "ax12a_joint" } // 그대로
   */
  jointNameMap?: Record<string, string>;

  /** 하드웨어로 명령 보내는 최대 주파수(Hz). rAF 폭격 방지. */
  sendHz?: number; // default 25

  /** 변화량이 이 값보다 작으면 명령 전송 생략(노이즈/떨림 방지) */
  deadbandRad?: number; // default 0.002 rad (~0.11deg)

  /** UI에서 setJointValue 호출 시, 화면을 즉시(optimistic) 업데이트할지 */
  optimisticViewerUpdate?: boolean; // default true

  /** 하드웨어에서 오는 state_joint를 viewer에 반영할지 */
  applyIncomingToViewer?: boolean; // default true

  /** jointNameMap에 없으면 전송 막을지 */
  allowUnmappedJoints?: boolean; // default true

  debug?: boolean;

  onStatus?: (s: { connected: boolean; lastStateTs?: number; lastError?: string }) => void;
};

export type ViewerHardwareBridgeHandle = {
  close: () => void;
  sendTorque: (enabled: boolean) => void;
  sendJoints: (joints: Record<string, number>) => void;
  isConnected: () => boolean;
};

function degToRad(v: number) {
  return (v * Math.PI) / 180;
}

function clampWithViewerLimits(viewer: URDFViewerElement, joint: string, value: number): number {
  const lim = viewer.jointLimits?.[joint];
  if (!lim) return value;
  if (typeof lim.lower === "number") value = Math.max(lim.lower, value);
  if (typeof lim.upper === "number") value = Math.min(lim.upper, value);
  return value;
}

export function setupViewerWsHardwareBridge(
  viewer: URDFViewerElement,
  opts: ViewerHardwareBridgeOptions
): ViewerHardwareBridgeHandle {
  const {
    wsUrl,
    jointNameMap = {},
    sendHz = 25,
    deadbandRad = 0.002,
    optimisticViewerUpdate = true,
    applyIncomingToViewer = true,
    allowUnmappedJoints = true,
    debug = false,
    onStatus,
  } = opts;

  // 이 시점의 setJointValue를 “베이스”로 저장 (joint limits wrapper 등 포함될 수 있음)
  const originalSetJointValue = viewer.setJointValue;

  let ws: WebSocket | null = null;
  let connected = false;
  let seq = 0;

  const minIntervalMs = Math.max(5, Math.floor(1000 / Math.max(1, sendHz)));

  // viewer->hw / hw->viewer 매핑
  const toHw = (viewerJoint: string) => jointNameMap[viewerJoint] ?? viewerJoint;

  const fromHw = (() => {
    const rev: Record<string, string> = {};
    for (const [v, h] of Object.entries(jointNameMap)) rev[h] = v;
    return (hwJoint: string) => rev[hwJoint] ?? hwJoint;
  })();

  // throttle queue
  const pending: Record<string, number> = {};
  const lastSent: Record<string, number> = {};
  let flushTimer: number | null = null;

  const emitStatus = (patch: Partial<{ connected: boolean; lastStateTs?: number; lastError?: string }>) => {
    onStatus?.({ connected, ...patch });
  };

  const safeSend = (msg: HwBridgeOutgoing) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch (e) {
      if (debug) console.warn("[urdf bridge] ws send failed:", e);
      return false;
    }
  };

  const scheduleFlush = () => {
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(() => {
      flushTimer = null;

      const joints = { ...pending };
      const keys = Object.keys(joints);
      if (!keys.length) return;

      // 연결 안됐으면 pending 유지하고 나중에 재시도
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        scheduleFlush();
        return;
      }

      // 먼저 비워두고 전송 (전송 중 새 값이 들어오면 pending에 다시 쌓이게)
      for (const k of keys) delete pending[k];

      const msg: HwBridgeOutgoing = {
        type: "cmd_joint",
        joints,
        units: "rad",
        seq: ++seq,
        ts: Date.now(),
      };

      safeSend(msg);

      for (const [k, v] of Object.entries(joints)) lastSent[k] = v;
    }, minIntervalMs);
  };

  const queueJoint = (viewerJoint: string, valueRad: number) => {
    if (!Number.isFinite(valueRad)) return;

    const hwJoint = toHw(viewerJoint);
    if (!allowUnmappedJoints && !(viewerJoint in jointNameMap)) return;

    const prev = lastSent[hwJoint];
    if (typeof prev === "number" && Math.abs(prev - valueRad) < deadbandRad) return;

    pending[hwJoint] = valueRad;
    scheduleFlush();
  };

  // Incoming state -> viewer 적용 (echo 방지: originalSetJointValue를 직접 호출)
  const applyStateToViewer = (joints: Record<string, number>, units: "rad" | "deg" = "rad") => {
    if (!applyIncomingToViewer) return;

    const conv = units === "deg" ? degToRad : (v: number) => v;

    for (const [hwName, raw] of Object.entries(joints)) {
      const viewerJoint = fromHw(hwName);
      const v = clampWithViewerLimits(viewer, viewerJoint, conv(raw));
      try {
        originalSetJointValue.call(viewer, viewerJoint, v);
      } catch (e) {
        if (debug) console.warn("[urdf bridge] applyState failed:", viewerJoint, e);
      }
    }
    viewer.redraw?.();
  };

  // WebSocket connect
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    if (debug) console.error("[urdf bridge] websocket init failed:", e);
    emitStatus({ connected: false, lastError: "WebSocket init failed" });
  }

  if (ws) {
    ws.onopen = () => {
      connected = true;
      emitStatus({ connected: true });
      if (debug) console.log("[urdf bridge] connected:", wsUrl);
      safeSend({ type: "ping", ts: Date.now() });
    };

    ws.onclose = () => {
      connected = false;
      emitStatus({ connected: false });
      if (debug) console.log("[urdf bridge] disconnected");
    };

    ws.onerror = () => {
      emitStatus({ connected: false, lastError: "WebSocket error" });
    };

    ws.onmessage = (ev) => {
      let msg: HwBridgeIncoming | null = null;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "state_joint" && msg.joints) {
        applyStateToViewer(msg.joints, msg.units ?? "rad");
        emitStatus({ connected: true, lastStateTs: msg.ts ?? Date.now() });
      }
    };
  }

  // === 핵심: setJointValue 래핑해서 “화면 업데이트 + 하드웨어 전송” 동시에 ===
  viewer.setJointValue = (joint: string, value: number) => {
    const clamped = clampWithViewerLimits(viewer, joint, value);

    // 화면 즉시 반영(기본 true)
    if (optimisticViewerUpdate) {
      originalSetJointValue.call(viewer, joint, clamped);
    }

    // 하드웨어 전송은 throttle로 큐잉
    queueJoint(joint, clamped);
  };

  return {
    close: () => {
      // 원복
      viewer.setJointValue = originalSetJointValue;

      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      try {
        ws?.close();
      } catch {}
      ws = null;

      connected = false;
      emitStatus({ connected: false });
    },

    sendTorque: (enabled: boolean) => {
      safeSend({
        type: "cmd_torque",
        enabled,
        seq: ++seq,
        ts: Date.now(),
      });
    },

    sendJoints: (joints: Record<string, number>) => {
      for (const [j, v] of Object.entries(joints)) {
        queueJoint(j, clampWithViewerLimits(viewer, j, v));
      }
    },

    isConnected: () => connected && !!ws && ws.readyState === WebSocket.OPEN,
  };
}
