// src/components/viewer/urdfHardwareBridge.ts
import type { URDFViewerElement } from "./urdfViewerHelpers";

/**
 * URDF Viewer -> CM-530 (RC100 u16 packet) Serial bridge
 *
 * - viewer.setJointValue()를 래핑해서, viewer가 움직일 때마다 DXL ID별 목표값을 큐(pending)에 쌓고,
 * - SEND_INTERVAL마다 "최근 조작 우선"으로 1개씩 전송합니다.
 * - 모터가 바뀔 때만 SELECT(30000+ID), 같은 모터면 POS(0~1023)만 연속 전송합니다.
 *
 * ✅ Web Serial API 사용 (Chrome/Edge). connect()는 반드시 유저 제스처(클릭)에서 호출해야 합니다.
 */

const CMD_BASE = 30000; // 30000=ALL, 30000+ID=select
const ALL_ID = 254;

function clampInt(v: number, lo: number, hi: number) {
  const iv = Math.round(v);
  return Math.max(lo, Math.min(hi, iv));
}

function makeSelectCode(dxlId: number) {
  if (dxlId === ALL_ID) return CMD_BASE; // ALL
  if (dxlId >= 1 && dxlId <= 254) return CMD_BASE + dxlId;
  throw new Error(`dxl_id must be 1..254 or 254(ALL). got=${dxlId}`);
}

/** RC100 스타일 u16 패킷: FF 55 lb ~lb hb ~hb */
function makeRc100PacketU16(data16: number): Uint8Array {
  const v = data16 & 0xffff;
  const lb = v & 0xff;
  const hb = (v >> 8) & 0xff;
  return new Uint8Array([0xff, 0x55, lb, lb ^ 0xff, hb, hb ^ 0xff]);
}

function clampWithViewerLimits(viewer: URDFViewerElement, joint: string, value: number): number {
  const lim = viewer.jointLimits?.[joint];
  if (!lim) return value;
  let v = value;
  if (typeof lim.lower === "number") v = Math.max(lim.lower, v);
  if (typeof lim.upper === "number") v = Math.min(lim.upper, v);
  return v;
}

function defaultRadToPosFactory(posMin: number, posMax: number) {
  return (viewerJoint: string, rad: number, viewer: URDFViewerElement) => {
    // URDF joint limit이 있으면 그 범위를 0~1023에 선형 매핑
    const lim = viewer.jointLimits?.[viewerJoint];
    const lo = typeof lim?.lower === "number" ? lim.lower : -Math.PI;
    const hi = typeof lim?.upper === "number" ? lim.upper : Math.PI;

    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) {
      return clampInt((posMin + posMax) / 2, posMin, posMax);
    }

    const r = Math.max(lo, Math.min(hi, rad));
    const t = (r - lo) / (hi - lo); // 0..1
    const pos = posMin + t * (posMax - posMin);
    return clampInt(pos, posMin, posMax);
  };
}

export type ViewerHardwareBridgeOptions = {
  /**
   * (레거시 호환용) 예전 ws 버전에서 쓰던 값.
   * 지금은 Serial 브릿지라 사용 안 함.
   */
  wsUrl?: string;

  /** viewer joint name -> "dxl id" 문자열 (예: { "r_shoulder": "1" }) */
  jointNameMap?: Record<string, string>;

  /** 하드웨어로 명령 보내는 최대 주파수(Hz). (sendIntervalMs가 없을 때만 사용) */
  sendHz?: number;

  /** 전송 간격(ms). 지정하면 sendHz보다 우선. (기본 15ms 추천) */
  sendIntervalMs?: number;

  /** 변화량이 이 값보다 작으면 전송 생략 (rad) */
  deadbandRad?: number;

  /** setJointValue 호출 시 viewer를 즉시 업데이트 */
  optimisticViewerUpdate?: boolean;

  /** jointNameMap에 없으면 전송 막기 (Serial은 ID가 필요하니 기본 false 추천) */
  allowUnmappedJoints?: boolean;

  /** Serial baudrate (CM-530 보통 57600) */
  baudRate?: number;

  /**
   * true면 이전에 권한 승인된 포트가 있으면 prompt 없이 getPorts()로 자동 연결 시도.
   * (처음 1회는 반드시 requestPort가 필요)
   */
  autoConnect?: boolean;

  /** requestPort 필터(선택) */
  requestPortFilters?: Array<{ usbVendorId?: number; usbProductId?: number }>;

  /** POS 범위 (AX-12A: 0~1023) */
  posMin?: number;
  posMax?: number;

  /**
   * rad -> pos(0~1023) 변환 커스텀.
   * 기본은 URDF limit 기반 선형 매핑.
   */
  radToPos?: (viewerJoint: string, rad: number, viewer: URDFViewerElement) => number;

  debug?: boolean;

  onStatus?: (s: { connected: boolean; lastError?: string }) => void;
};

export type ViewerHardwareBridgeHandle = {
  /** 유저 클릭 이벤트에서 호출하세요 (Web Serial 제약) */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  /** viewer.setJointValue 원복 + 타이머 정리 + disconnect */
  close: () => void;

  /** (레거시) 토크 제어는 이 프로토콜에서는 미지원: no-op */
  sendTorque: (enabled: boolean) => void;

  /** viewer joint name -> rad 값을 큐에 넣어서 송신 */
  sendJoints: (joints: Record<string, number>) => void;

  isConnected: () => boolean;
};

type PendingVal = { rad: number; pos: number };
type TxState = { phase: 0 | 1; id: number; val: PendingVal };

export function setupViewerWsHardwareBridge(
  viewer: URDFViewerElement,
  opts: ViewerHardwareBridgeOptions
): ViewerHardwareBridgeHandle {
  const {
    jointNameMap = {},
    sendHz = 66,
    sendIntervalMs,
    deadbandRad = 0.002,
    optimisticViewerUpdate = true,
    allowUnmappedJoints = false,
    baudRate = 57600,
    autoConnect = false,
    requestPortFilters,
    posMin = 0,
    posMax = 1023,
    radToPos,
    debug = false,
    onStatus,
  } = opts;

  const originalSetJointValue = viewer.setJointValue;

  // --- Web Serial state (타입 의존 줄이려고 any로 둠)
  let port: any | null = null;
  let writer: any | null = null;
  let connected = false;

  const emitStatus = (patch: Partial<{ connected: boolean; lastError?: string }>) => {
    onStatus?.({ connected, ...patch });
  };

  // --- timing
  const minIntervalMs =
    Math.max(
      5,
      typeof sendIntervalMs === "number"
        ? Math.floor(sendIntervalMs)
        : Math.floor(1000 / Math.max(1, sendHz))
    );

  // --- mapping: viewer joint -> dxlId number
  const getDxlId = (viewerJoint: string): number | null => {
    if (!allowUnmappedJoints && !(viewerJoint in jointNameMap)) return null;

    const raw = jointNameMap[viewerJoint] ?? viewerJoint;
    const id = Number(raw);

    if (!Number.isFinite(id)) return null;
    if (id < 1 || id > 254) return null;

    return id;
  };

  // --- rad->pos mapping
  const radToPosFn = radToPos ?? defaultRadToPosFactory(posMin, posMax);

  // ✅ 최근 조작 우선 큐 (dxlId -> {rad,pos})
  const pending = new Map<number, PendingVal>();
  const lastSent = new Map<number, PendingVal>();

  // SELECT 최적화용 상태
  let currentTarget: number | null = null;
  let txState: TxState | null = null;

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;

  const safeWriteU16 = async (u16: number): Promise<boolean> => {
    if (!writer) return false;
    try {
      const pkt = makeRc100PacketU16(u16);
      await writer.write(pkt);
      return true;
    } catch (e) {
      if (debug) console.warn("[urdf bridge][serial] write failed:", e);
      connected = false;
      emitStatus({ connected: false, lastError: "Serial write failed / disconnected" });
      return false;
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    if (!connected || !writer) return;

    flushTimer = setTimeout(async () => {
      flushTimer = null;
      if (!connected || !writer) return;

      if (writing) {
        scheduleFlush();
        return;
      }

      writing = true;
      try {
        // --- 1) txState 진행 (SELECT -> POS)
        if (txState) {
          const { id } = txState;

          if (txState.phase === 0) {
            // SELECT
            const sel = makeSelectCode(id);
            const ok = await safeWriteU16(sel);

            if (!ok) {
              // 실패하면 값 복원
              pending.delete(id);
              pending.set(id, txState.val);
              txState = null;
              return;
            }

            currentTarget = id;
            txState.phase = 1;
            return;
          }

          // phase === 1 : POS
          // 보내기 직전 최신값으로 덮어쓰기
          const latest = pending.get(id);
          if (latest) {
            pending.delete(id);
            txState.val = latest;
          }

          const pos = clampInt(txState.val.pos, posMin, posMax);
          const ok = await safeWriteU16(pos);

          if (!ok) {
            pending.delete(id);
            pending.set(id, txState.val);
            txState = null;
            return;
          }

          lastSent.set(id, txState.val);
          txState = null;
          return;
        }

        // --- 2) pending에서 "가장 최근" 1개 꺼내기
        if (!pending.size) return;

        let lastId: number | null = null;
        let lastVal: PendingVal | null = null;
        for (const [id, v] of pending.entries()) {
          lastId = id;
          lastVal = v;
        }
        if (lastId == null || lastVal == null) return;

        pending.delete(lastId);

        if (currentTarget === lastId) {
          // ✅ 같은 모터면 POS만 연속 전송
          const pos = clampInt(lastVal.pos, posMin, posMax);
          const ok = await safeWriteU16(pos);

          if (!ok) {
            pending.delete(lastId);
            pending.set(lastId, lastVal);
            return;
          }

          lastSent.set(lastId, lastVal);
        } else {
          // ✅ 모터 바뀌면 SELECT 먼저, 다음 틱에 POS
          txState = { phase: 0, id: lastId, val: lastVal };
        }
      } finally {
        writing = false;

        // 더 보낼 게 있으면 계속
        if (connected && writer && (txState || pending.size)) scheduleFlush();
      }
    }, minIntervalMs);
  };

  const queueJoint = (viewerJoint: string, radValue: number) => {
    if (!Number.isFinite(radValue)) return;

    const dxlId = getDxlId(viewerJoint);
    if (dxlId == null) return;

    // deadband (rad 기준)
    const prev = pending.get(dxlId) ?? lastSent.get(dxlId);
    if (prev && Math.abs(prev.rad - radValue) < deadbandRad) return;

    const pos = clampInt(radToPosFn(viewerJoint, radValue, viewer), posMin, posMax);

    // pos가 같으면 보낼 필요 없음
    if (prev && prev.pos === pos) return;

    // ✅ move-to-end (최근 조작 우선)
    if (pending.has(dxlId)) pending.delete(dxlId);
    pending.set(dxlId, { rad: radValue, pos });

    scheduleFlush();
  };

  // === 핵심: setJointValue 래핑 ===
  viewer.setJointValue = (joint: string, value: number) => {
    const clamped = clampWithViewerLimits(viewer, joint, value);

    if (optimisticViewerUpdate) {
      originalSetJointValue.call(viewer, joint, clamped);
    }

    queueJoint(joint, clamped);
  };

  const connect = async () => {
    if (connected && writer && port) return;

    const navAny = navigator as any;
    if (!navAny?.serial) {
      emitStatus({ connected: false, lastError: "Web Serial API not supported (Chrome/Edge 필요)" });
      throw new Error("Web Serial API not supported");
    }

    try {
      // autoConnect: 이미 승인된 포트가 있으면 prompt 없이 연결 시도
      if (autoConnect) {
        const ports: any[] = await navAny.serial.getPorts();
        if (ports?.length) port = ports[0];
      }

      if (!port) {
        // 처음 연결은 유저 제스처에서만 가능
        port = await navAny.serial.requestPort(
          requestPortFilters?.length ? { filters: requestPortFilters } : undefined
        );
      }

      await port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });

      if (!port.writable) throw new Error("Serial port not writable");
      writer = port.writable.getWriter();

      connected = true;
      emitStatus({ connected: true, lastError: undefined });

      if (debug) console.log("[urdf bridge][serial] connected @", baudRate, "interval(ms)=", minIntervalMs);

      scheduleFlush();
    } catch (e: any) {
      connected = false;
      emitStatus({ connected: false, lastError: e?.message ?? "Serial connect failed" });
      throw e;
    }
  };

  const disconnect = async () => {
    connected = false;

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    txState = null;
    currentTarget = null;

    try {
      if (writer) {
        try {
          writer.releaseLock?.();
        } catch {}
      }
      writer = null;

      if (port) {
        try {
          await port.close?.();
        } catch {}
      }
      port = null;
    } finally {
      emitStatus({ connected: false });
    }
  };

  // setup 시 autoConnect 켜져 있으면 조용히 시도 (권한 승인된 포트가 있을 때만)
  if (autoConnect) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    connect().catch(() => {
      /* 무시: 첫 연결은 보통 requestPort 필요 */
    });
  }

  return {
    connect,
    disconnect,
    close: () => {
      viewer.setJointValue = originalSetJointValue;

      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      pending.clear();
      lastSent.clear();
      txState = null;
      currentTarget = null;

      // async지만 fire-and-forget
      void disconnect();
    },

    sendTorque: (_enabled: boolean) => {
      // RC100 u16 단순 전송만으로 토크 on/off는 표준화돼 있지 않아서 여기선 no-op
      if (debug) console.warn("[urdf bridge][serial] sendTorque: no-op (not supported in this bridge)");
    },

    sendJoints: (joints: Record<string, number>) => {
      for (const [j, v] of Object.entries(joints)) {
        queueJoint(j, clampWithViewerLimits(viewer, j, v));
      }
    },

    isConnected: () => connected && !!port && !!writer,
  };
}
