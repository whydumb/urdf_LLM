import type { VmdKeyframe } from "@/utils/VmdLoader";

export type RefSample = {
  t: number;              // seconds
  phase: number;          // 0..1
  qRef: Float32Array;     // jointOrder length
  qdRef: Float32Array;    // jointOrder length
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export class ReferenceMotion {
  private frames: number[];
  private duration: number;
  private keyframes: VmdKeyframe[];

  constructor(
    private jointOrder: string[],
    keyframes: VmdKeyframe[],
    private fps = 30,
    private loop = true
  ) {
    // 프레임 순 정렬
    const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
    this.keyframes = sorted;
    this.frames = sorted.map(k => k.frame);
    
    // 마지막 프레임을 기준으로 전체 지속 시간 계산
    const lastFrame = sorted.length ? sorted[sorted.length - 1].frame : 0;
    this.duration = lastFrame / this.fps;
  }

  durationSec() {
    return Math.max(1e-6, this.duration);
  }

  sample(tSec: number): RefSample {
    const T = this.durationSec();
    let t = tSec;

    // Loop 처리
    if (this.loop) {
      t = ((t % T) + T) % T;
    } else {
      t = Math.max(0, Math.min(T, t));
    }

    const frame = t * this.fps;

    // 데이터가 없으면 0 리턴
    const n = this.keyframes.length;
    if (n === 0) {
      return {
        t,
        phase: 0,
        qRef: new Float32Array(this.jointOrder.length),
        qdRef: new Float32Array(this.jointOrder.length),
      };
    }

    // Binary Search로 현재 프레임 위치 찾기
    let lo = 0, hi = n - 1, idxNext = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid] >= frame) {
        idxNext = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const idxPrev = Math.max(0, idxNext - 1);
    const k0 = this.keyframes[idxPrev];
    const k1 = this.keyframes[idxNext];

    const f0 = k0.frame;
    const f1 = k1.frame;
    const denom = Math.max(1e-6, f1 - f0);
    const a = clamp01((frame - f0) / denom);

    const qRef = new Float32Array(this.jointOrder.length);
    const qdRef = new Float32Array(this.jointOrder.length);

    // 각 관절에 대해 보간(Interpolation) 수행
    for (let i = 0; i < this.jointOrder.length; i++) {
      const jn = this.jointOrder[i];
      const v0 = (k0.pose?.[jn] ?? 0);
      const v1 = (k1.pose?.[jn] ?? v0);
      
      // 위치 보간
      const q = v0 + (v1 - v0) * a;
      qRef[i] = q;

      // 속도 계산 (차분)
      const dt = (denom / this.fps);
      qdRef[i] = (v1 - v0) / Math.max(1e-6, dt);
    }

    return {
      t,
      phase: clamp01(t / T),
      qRef,
      qdRef,
    };
  }
}