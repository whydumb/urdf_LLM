import { Quaternion, Euler } from "three";

// ============================================================
// VMD 본 → MuJoCo 조인트 매핑
// ============================================================
interface BoneMapping {
  joint: string;
  mmdAxis: "x" | "y" | "z";
  extractMode?: "twist" | "euler";
  sign: number;
  offset: number;
}

// ============================================================
// 조인트별 후처리
// ============================================================
interface JointPostProcess {
  mode: "abs" | "neg_abs" | "pos_abs" | "clamp";
  min?: number;
  max?: number;
}

const JOINT_POST_PROCESS: Record<string, JointPostProcess> = {
  "l_knee": { mode: "abs" },
  "r_knee": { mode: "abs" },
  "l_el":   { mode: "neg_abs" },
  "r_el":   { mode: "pos_abs" },
};

function applyPostProcess(value: number, resolvedName: string): number {
  const normName = resolvedName.toLowerCase().replace(/[^a-z0-9_]/g, "");
  for (const [pattern, rule] of Object.entries(JOINT_POST_PROCESS)) {
    const normPattern = pattern.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (normName === normPattern || normName.includes(normPattern)) {
      switch (rule.mode) {
        case "abs":     return Math.abs(value);
        case "neg_abs": return -Math.abs(value);
        case "pos_abs": return Math.abs(value);
        case "clamp":   return Math.max(rule.min ?? -Infinity, Math.min(rule.max ?? Infinity, value));
      }
    }
  }
  return value;
}

const EULER_ORDER = "XYZ" as const;
const DEG = Math.PI / 180;

// ============================================================
// 매핑 테이블
// ============================================================
const VMD_TO_MJ: Record<string, BoneMapping[]> = {
  // ---- head / neck ----
  "首": [
    { joint: "head_pan", mmdAxis: "y", extractMode: "euler", sign: 1, offset: 0 },
  ],
  "頭": [
    { joint: "head_tilt", mmdAxis: "x", extractMode: "euler", sign: 1, offset: 0 },
  ],

  // ---- 왼팔 ----
  // ★ sho_pitch sign: -1 (캘리브레이션 BEST = -1,-1)
  "左肩": [
    { joint: "l_sho_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "左腕": [
    { joint: "l_sho_roll",  mmdAxis: "z", extractMode: "euler", sign:  1, offset:  30 * DEG },
    { joint: "l_sho_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "左ひじ": [
    { joint: "l_el", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "左腕捩": [
    { joint: "l_el", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "左手捩": [
    { joint: "l_el", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],

  // ---- 오른팔 ----
  // ★ sho_pitch sign: -1
  "右肩": [
    { joint: "r_sho_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "右腕": [
    { joint: "r_sho_roll",  mmdAxis: "z", extractMode: "euler", sign:  1, offset: -30 * DEG },
    { joint: "r_sho_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "右ひじ": [
    { joint: "r_el", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "右腕捩": [
    { joint: "r_el", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "右手捩": [
    { joint: "r_el", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],

  // ---- 왼다리 ----
  "左足": [
    { joint: "l_hip_pitch", mmdAxis: "x", extractMode: "twist", sign: -1.0,  offset: 0 },
    { joint: "l_hip_roll",  mmdAxis: "z", extractMode: "euler", sign: -0.25, offset: 0 },
    { joint: "l_hip_yaw",   mmdAxis: "y", extractMode: "euler", sign:  0.20, offset: 0 },
  ],
  "左ひざ": [
    { joint: "l_knee", mmdAxis: "x", extractMode: "twist", sign: 1, offset: 0 },
  ],
  "左足首": [
    { joint: "l_ank_pitch", mmdAxis: "x", extractMode: "twist", sign:  1.0,  offset: 0 },
    { joint: "l_ank_roll",  mmdAxis: "z", extractMode: "euler", sign:  0.30, offset: 0 },
  ],

  // ---- 오른다리 ----
  "右足": [
    { joint: "r_hip_pitch", mmdAxis: "x", extractMode: "twist", sign: -1.0,  offset: 0 },
    { joint: "r_hip_roll",  mmdAxis: "z", extractMode: "euler", sign:  0.25, offset: 0 },
    { joint: "r_hip_yaw",   mmdAxis: "y", extractMode: "euler", sign: -0.20, offset: 0 },
  ],
  "右ひざ": [
    { joint: "r_knee", mmdAxis: "x", extractMode: "twist", sign: 1, offset: 0 },
  ],
  "右足首": [
    { joint: "r_ank_pitch", mmdAxis: "x", extractMode: "twist", sign:  1.0,  offset: 0 },
    { joint: "r_ank_roll",  mmdAxis: "z", extractMode: "euler", sign: -0.30, offset: 0 },
  ],
};

// ============================================================
// 조인트 이름 별칭
// ============================================================
const JOINT_ALIASES: Record<string, string[]> = {
  "lshopitch":  ["leftshoulderpitch", "lshoulderpitch", "lshopitch", "lshoulderp"],
  "rshopitch":  ["rightshoulderpitch", "rshoulderpitch", "rshopitch", "rshoulderp"],
  "lshoroll":   ["leftshoulderroll", "lshoulderroll", "lshoroll", "lshoulderr"],
  "rshoroll":   ["rightshoulderroll", "rshoulderroll", "rshoroll", "rshoulderr"],
  "lel":        ["leftelbow", "lelbowpitch", "lel", "lelbowp"],
  "rel":        ["rightelbow", "relbowpitch", "rel", "relbowp"],
  "lhippitch":  ["lefthippitch", "lhippitch", "lhipp"],
  "rhippitch":  ["righthippitch", "rhippitch", "rhipp"],
  "lhiproll":   ["lefthiproll", "lhiproll", "lhipr"],
  "rhiproll":   ["righthiproll", "rhiproll", "rhipr"],
  "lhipyaw":    ["lefthipyaw", "lhipyaw", "lhipy"],
  "rhipyaw":    ["righthipyaw", "rhipyaw", "rhipy"],
  "lknee":      ["leftknee", "lkneepitch", "lknee", "lkneep"],
  "rknee":      ["rightknee", "rkneepitch", "rknee", "rkneep"],
  "lankpitch":  ["leftanklepitch", "lankpitch", "lanklep", "lankp"],
  "rankpitch":  ["rightanklepitch", "rankpitch", "ranklep", "rankp"],
  "lankroll":   ["leftankleroll", "lankroll", "lankler", "lankr"],
  "rankroll":   ["rightankleroll", "rankroll", "rankler", "rankr"],
  "headpan":    ["headpan", "headyaw", "neckyaw", "neckpan"],
  "headtilt":   ["headtilt", "headpitch", "neckpitch", "necktilt"],
};

// ============================================================
// public types
// ============================================================
export type VmdKeyframe = {
  frame: number;
  timeSec: number;
  pose: { [jointName: string]: number };
};

export type VmdLoaderOptions = {
  boneMap?: Record<string, string>;
  boneMapMulti?: Record<string, BoneMapping[]>;
  vmdFps?: number;
  resampleFps?: number;
  subtractRestPose?: boolean;
};

// ============================================================
// ★ timeSec 기반 샘플러 (Drive/RefMotion용 유틸리티)
//
// 소비자가 직접 쓸 수 있도록 static으로 제공.
// binary search + wrapPi lerp.
// ============================================================
export class VmdSampler {
  private keyframes: VmdKeyframe[];
  private jointNames: string[];

  constructor(keyframes: VmdKeyframe[]) {
    this.keyframes = keyframes;
    const allJoints = new Set<string>();
    for (const kf of keyframes) {
      for (const j of Object.keys(kf.pose)) allJoints.add(j);
    }
    this.jointNames = [...allJoints];
  }

  /** 총 재생 시간(초) */
  get duration(): number {
    if (this.keyframes.length === 0) return 0;
    return this.keyframes[this.keyframes.length - 1].timeSec;
  }

  /** timeSec로 보간된 pose를 반환 */
  sample(t: number): Record<string, number> {
    const kfs = this.keyframes;
    if (kfs.length === 0) return {};
    if (kfs.length === 1 || t <= kfs[0].timeSec) return { ...kfs[0].pose };
    if (t >= kfs[kfs.length - 1].timeSec) return { ...kfs[kfs.length - 1].pose };

    // binary search
    let lo = 0, hi = kfs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (kfs[mid].timeSec <= t) lo = mid; else hi = mid;
    }

    const t0 = kfs[lo].timeSec;
    const t1 = kfs[hi].timeSec;
    const alpha = (t1 - t0) > 1e-9 ? (t - t0) / (t1 - t0) : 0;
    const p0 = kfs[lo].pose;
    const p1 = kfs[hi].pose;

    const pose: Record<string, number> = {};
    for (const j of this.jointNames) {
      const v0 = p0[j] ?? 0;
      const v1 = p1[j] ?? 0;
      // wrapPi lerp
      let diff = v1 - v0;
      const twoPi = 2 * Math.PI;
      diff = ((diff + Math.PI) % twoPi);
      if (diff < 0) diff += twoPi;
      diff -= Math.PI;
      pose[j] = v0 + diff * alpha;
    }
    return pose;
  }
}

// ============================================================
// loader
// ============================================================
export class VmdLoader {

  private static normalizeName(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  private static resolveJointName(jointName: string, robotJoints: string[]): string | null {
    if (robotJoints.includes(jointName)) return jointName;
    const lower = jointName.toLowerCase();
    const ciHit = robotJoints.find(r => r.toLowerCase() === lower);
    if (ciHit) return ciHit;
    const normTarget = this.normalizeName(jointName);
    const normHit = robotJoints.find(r => this.normalizeName(r) === normTarget);
    if (normHit) return normHit;
    for (const aliases of Object.values(JOINT_ALIASES)) {
      if (aliases.includes(normTarget)) {
        for (const rj of robotJoints) {
          if (aliases.includes(this.normalizeName(rj))) return rj;
        }
      }
    }
    const partHit = robotJoints.find(r => {
      const normR = this.normalizeName(r);
      return normR.includes(normTarget) || normTarget.includes(normR);
    });
    if (partHit) return partHit;
    return null;
  }

  private static jointExists(jointName: string, robotJoints: string[]): boolean {
    return this.resolveJointName(jointName, robotJoints) !== null;
  }

  private static wrapPi(a: number): number {
    const twoPi = 2 * Math.PI;
    a = ((a + Math.PI) % twoPi);
    if (a < 0) a += twoPi;
    return a - Math.PI;
  }

  private static twistAngleAboutAxis(
    qx: number, qy: number, qz: number, qw: number,
    axis: "x" | "y" | "z",
  ): number {
    const ax = axis === "x" ? 1 : 0;
    const ay = axis === "y" ? 1 : 0;
    const az = axis === "z" ? 1 : 0;
    const dot = qx * ax + qy * ay + qz * az;
    const len = Math.hypot(dot, qw);
    if (len < 1e-8) return 0;
    return this.wrapPi(2 * Math.atan2(dot / len, qw / len));
  }

  private static eulerAngleAboutAxis(
    qx: number, qy: number, qz: number, qw: number,
    axis: "x" | "y" | "z",
  ): number {
    const q = new Quaternion(qx, qy, qz, qw).normalize();
    const euler = new Euler().setFromQuaternion(q, EULER_ORDER);
    switch (axis) {
      case "x": return euler.x;
      case "y": return euler.y;
      case "z": return euler.z;
    }
  }

  private static extractAngle(
    qx: number, qy: number, qz: number, qw: number,
    mapping: BoneMapping,
  ): number {
    const mode = mapping.extractMode ?? "euler";
    if (mode === "euler") {
      return this.eulerAngleAboutAxis(qx, qy, qz, qw, mapping.mmdAxis);
    }
    return this.twistAngleAboutAxis(qx, qy, qz, qw, mapping.mmdAxis);
  }

  private static extractAngleRaw(
    qx: number, qy: number, qz: number, qw: number,
    axis: "x" | "y" | "z",
    mode: "euler" | "twist",
  ): number {
    if (mode === "euler") return this.eulerAngleAboutAxis(qx, qy, qz, qw, axis);
    return this.twistAngleAboutAxis(qx, qy, qz, qw, axis);
  }

  private static lerpAngle(a: number, b: number, t: number): number {
    return a + this.wrapPi(b - a) * t;
  }

  // ============================================================
  // 리샘플링
  //
  // ★ 핵심 변경: frame을 timeSec * vmdFps로 매기므로
  //   소비자가 "frame / 30"으로 duration을 계산해도
  //   timeSec와 일치함. 2배 버그 방지.
  // ============================================================
  static resample(
    keyframes: VmdKeyframe[],
    targetFps: number,
    vmdFps: number,
  ): VmdKeyframe[] {
    if (keyframes.length < 2) return keyframes;

    const totalTimeSec = keyframes[keyframes.length - 1].timeSec;
    const totalOutputFrames = Math.max(1, Math.ceil(totalTimeSec * targetFps) + 1);

    const allJoints = new Set<string>();
    for (const kf of keyframes) {
      for (const j of Object.keys(kf.pose)) allJoints.add(j);
    }
    const jointNames = [...allJoints];
    const result: VmdKeyframe[] = [];

    for (let i = 0; i < totalOutputFrames; i++) {
      const t = i / targetFps;
      if (t >= totalTimeSec) {
        result.push({
          frame: Math.round(t * vmdFps),  // ★ vmdFps 기준 프레임
          timeSec: t,
          pose: { ...keyframes[keyframes.length - 1].pose },
        });
        continue;
      }
      if (t <= keyframes[0].timeSec) {
        result.push({
          frame: Math.round(t * vmdFps),
          timeSec: t,
          pose: { ...keyframes[0].pose },
        });
        continue;
      }

      let lo = 0, hi = keyframes.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (keyframes[mid].timeSec <= t) lo = mid; else hi = mid;
      }

      const t0 = keyframes[lo].timeSec;
      const t1 = keyframes[hi].timeSec;
      const alpha = (t1 - t0) > 1e-9 ? (t - t0) / (t1 - t0) : 0;
      const p0 = keyframes[lo].pose;
      const p1 = keyframes[hi].pose;

      const pose: Record<string, number> = {};
      for (const j of jointNames) {
        pose[j] = this.lerpAngle(p0[j] ?? 0, p1[j] ?? 0, alpha);
      }
      result.push({
        frame: Math.round(t * vmdFps),  // ★ vmdFps 기준
        timeSec: t,
        pose,
      });
    }
    return result;
  }

  // ============================================================
  // 상관계수
  // ============================================================
  private static pearsonCorrelation(xs: number[], ys: number[]): number {
    const n = xs.length;
    if (n < 3) return 0;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    const mx = sx / n, my = sy / n;
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    const d = Math.sqrt(vx * vy);
    return d < 1e-12 ? 0 : cov / d;
  }

  // ============================================================
  // 축/모드 자동 스캐너
  // ============================================================
  static scanBestHipPitchMapping(
    buffer: ArrayBuffer,
    robotJointNames: string[],
    vmdFps: number = 30,
  ): void {
    const data = new DataView(buffer);
    const decoder = new TextDecoder("shift-jis");
    let offset = 0;

    const magic = decoder.decode(new Uint8Array(buffer, 0, 30)).replace(/\0/g, "").trim();
    if (!magic.startsWith("Vocaloid Motion Data")) return;
    offset += 30 + 20;

    const motionCount = data.getUint32(offset, true);
    offset += 4;

    const boneQuats: Record<string, Map<number, [number, number, number, number]>> = {
      "左足": new Map(), "右足": new Map(), "左ひざ": new Map(), "右ひざ": new Map(),
    };

    for (let i = 0; i < motionCount; i++) {
      const boneName = decoder.decode(new Uint8Array(buffer, offset, 15)).replace(/\0/g, "").trim();
      offset += 15;
      const frameNum = data.getUint32(offset, true);
      offset += 4; offset += 12;
      const qx = data.getFloat32(offset, true); offset += 4;
      const qy = data.getFloat32(offset, true); offset += 4;
      const qz = data.getFloat32(offset, true); offset += 4;
      const qw = data.getFloat32(offset, true); offset += 4;
      offset += 64;
      if (boneQuats[boneName]) boneQuats[boneName].set(frameNum, [qx, qy, qz, qw]);
    }

    const commonFrames = [...boneQuats["左足"].keys()]
      .filter(f => boneQuats["右足"].has(f) && boneQuats["左ひざ"].has(f) && boneQuats["右ひざ"].has(f))
      .sort((a, b) => a - b);

    if (commonFrames.length < 5) {
      console.log("[VMD Scan] Not enough frames.");
      return;
    }

    const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
    const modes: Array<"euler" | "twist"> = ["euler", "twist"];
    const toDeg = 180 / Math.PI;

    console.log(`[VMD] === Hip Pitch Scanner (${commonFrames.length} frames) ===`);

    type C = { axis: string; mode: string; antiSym: number; kneeCorr: number; score: number; rngL: number; rngR: number };
    const cs: C[] = [];

    for (const axis of axes) {
      for (const mode of modes) {
        const lV: number[] = [], rV: number[] = [], lK: number[] = [], rK: number[] = [];
        for (const f of commonFrames) {
          lV.push(this.extractAngleRaw(...boneQuats["左足"].get(f)!, axis, mode));
          rV.push(this.extractAngleRaw(...boneQuats["右足"].get(f)!, axis, mode));
          lK.push(this.extractAngleRaw(...boneQuats["左ひざ"].get(f)!, "x", mode));
          rK.push(this.extractAngleRaw(...boneQuats["右ひざ"].get(f)!, "x", mode));
        }
        const antiSym = -this.pearsonCorrelation(lV, rV);
        const kneeCorr = (Math.abs(this.pearsonCorrelation(lV, lK)) + Math.abs(this.pearsonCorrelation(rV, rK))) / 2;
        const rngL = Math.max(...lV) - Math.min(...lV);
        const rngR = Math.max(...rV) - Math.min(...rV);
        cs.push({ axis, mode, antiSym, kneeCorr, score: antiSym * 0.5 + kneeCorr * 0.5, rngL, rngR });
      }
    }
    cs.sort((a, b) => b.score - a.score);
    for (const c of cs) {
      console.log(
        `  ${c.mode}:${c.axis} → anti=${c.antiSym.toFixed(3)} knee=${c.kneeCorr.toFixed(3)} ` +
        `score=${c.score.toFixed(3)} range(L=${(c.rngL * toDeg).toFixed(1)}° R=${(c.rngR * toDeg).toFixed(1)}°)` +
        `${c === cs[0] ? " ★" : ""}`
      );
    }
  }

  // ============================================================
  // sign 캘리브레이션
  // ============================================================
  static calibrateArmLegPhase(keyframes: VmdKeyframe[], robotJointNames: string[]): void {
    const LSP = this.resolveJointName("l_sho_pitch", robotJointNames);
    const LHP = this.resolveJointName("l_hip_pitch", robotJointNames);
    const RSP = this.resolveJointName("r_sho_pitch", robotJointNames);
    const RHP = this.resolveJointName("r_hip_pitch", robotJointNames);
    if (!LSP || !LHP || !RSP || !RHP) return;

    const lS = keyframes.map(kf => kf.pose[LSP] ?? 0);
    const lH = keyframes.map(kf => kf.pose[LHP] ?? 0);
    const rS = keyframes.map(kf => kf.pose[RSP] ?? 0);
    const rH = keyframes.map(kf => kf.pose[RHP] ?? 0);

    const signs = [1, -1];
    const results: Array<{ ls: number; rs: number; avg: number; detail: string }> = [];
    for (const ls of signs) {
      for (const rs of signs) {
        const cL = this.pearsonCorrelation(lS.map(v => v * ls), lH);
        const cR = this.pearsonCorrelation(rS.map(v => v * rs), rH);
        results.push({
          ls, rs, avg: (cL + cR) / 2,
          detail: `L×${ls > 0 ? "+1" : "-1"}, R×${rs > 0 ? "+1" : "-1"} → corr(L)=${cL.toFixed(3)}, corr(R)=${cR.toFixed(3)}, avg=${((cL + cR) / 2).toFixed(3)}`,
        });
      }
    }
    results.sort((a, b) => a.avg - b.avg);
    console.log("[VMD] === Arm-Leg Sign Calibration ===");
    for (const r of results) {
      console.log(`  ${r.detail}${r === results[0] ? " ★ BEST" : ""}`);
    }
  }

  // ============================================================
  // rest pose offset 제거
  // ============================================================
  private static subtractRestPose(keyframes: VmdKeyframe[]): void {
    if (keyframes.length === 0) return;
    const rest = keyframes[0].pose;
    const offsets: Record<string, number> = {};
    for (const [j, v] of Object.entries(rest)) offsets[j] = v;
    const toDeg = 180 / Math.PI;
    console.log("[VMD] === Rest offsets subtracted ===");
    for (const [j, v] of Object.entries(offsets)) {
      if (Math.abs(v) > 0.01) console.log(`  ${j}: ${(v * toDeg).toFixed(1)}°`);
    }
    for (const kf of keyframes) {
      for (const j of Object.keys(kf.pose)) kf.pose[j] -= (offsets[j] ?? 0);
    }
  }

  // ============================================================
  // main load
  // ============================================================
  static load(
    buffer: ArrayBuffer,
    robotJointNames: string[],
    opts?: VmdLoaderOptions,
  ): VmdKeyframe[] {
    const vmdFps = opts?.vmdFps ?? 30;
    const resampleFps = opts?.resampleFps ?? 60;
    const doSubtractRest = opts?.subtractRestPose ?? false;

    const data = new DataView(buffer);
    const decoder = new TextDecoder("shift-jis");
    let offset = 0;

    const magic = decoder.decode(new Uint8Array(buffer, 0, 30)).replace(/\0/g, "").trim();
    if (!magic.startsWith("Vocaloid Motion Data")) throw new Error("Invalid VMD file");
    offset += 30 + 20;

    const motionCount = data.getUint32(offset, true);
    offset += 4;

    const mappingLog = new Map<string, string[]>();
    const unmapped = new Set<string>();
    const zeroAngleCounter: Record<string, { total: number; nearZero: number }> = {};
    const frameMap: Record<number, Record<string, number>> = {};

    const rawDebugBones = new Set([
      "右ひじ", "左ひじ", "右肩", "左肩", "右腕", "左腕",
      "右足", "左足", "首", "頭", "右腕捩", "左腕捩", "右ひざ", "左ひざ",
    ]);
    const rawDebugSeen = new Map<string, number>();

    for (let i = 0; i < motionCount; i++) {
      const boneName = decoder.decode(new Uint8Array(buffer, offset, 15)).replace(/\0/g, "").trim();
      offset += 15;
      const frameNum = data.getUint32(offset, true);
      offset += 4; offset += 12;

      const qx = data.getFloat32(offset, true); offset += 4;
      const qy = data.getFloat32(offset, true); offset += 4;
      const qz = data.getFloat32(offset, true); offset += 4;
      const qw = data.getFloat32(offset, true); offset += 4;
      offset += 64;

      if (rawDebugBones.has(boneName)) {
        const cnt = rawDebugSeen.get(boneName) ?? 0;
        if (cnt < 3) {
          rawDebugSeen.set(boneName, cnt + 1);
          const q = new Quaternion(qx, qy, qz, qw).normalize();
          const euler = new Euler().setFromQuaternion(q, EULER_ORDER);
          const toDeg = 180 / Math.PI;
          console.log(
            `[VMD RAW] ${boneName} f${frameNum}: ` +
            `euler/${EULER_ORDER}(x=${(euler.x * toDeg).toFixed(1)}°, y=${(euler.y * toDeg).toFixed(1)}°, z=${(euler.z * toDeg).toFixed(1)}°)`
          );
        }
      }

      let mappings: BoneMapping[] | null = null;
      if (opts?.boneMapMulti?.[boneName]) mappings = opts.boneMapMulti[boneName];
      if (!mappings) {
        const builtIn = VMD_TO_MJ[boneName];
        if (builtIn) {
          const valid = builtIn.filter(m => this.jointExists(m.joint, robotJointNames));
          if (valid.length > 0) mappings = valid;
        }
      }
      if (!mappings && opts?.boneMap?.[boneName]) {
        const target = opts.boneMap[boneName];
        if (this.jointExists(target, robotJointNames))
          mappings = [{ joint: target, mmdAxis: "x", extractMode: "euler", sign: 1, offset: 0 }];
      }
      if (!mappings || mappings.length === 0) { unmapped.add(boneName); continue; }

      if (!mappingLog.has(boneName)) {
        mappingLog.set(boneName, mappings.map(m =>
          `${m.joint}(${m.extractMode ?? "euler"}:${m.mmdAxis},s=${m.sign})`
        ));
      }

      const pose = (frameMap[frameNum] ??= {});
      for (const mapping of mappings) {
        const resolved = this.resolveJointName(mapping.joint, robotJointNames);
        if (!resolved) continue;
        const raw = this.extractAngle(qx, qy, qz, qw, mapping);
        let final = mapping.sign * raw + mapping.offset;
        final = applyPostProcess(final, resolved);

        const key = `${boneName}→${resolved}(${mapping.extractMode ?? "euler"}:${mapping.mmdAxis})`;
        if (!zeroAngleCounter[key]) zeroAngleCounter[key] = { total: 0, nearZero: 0 };
        zeroAngleCounter[key].total++;
        if (Math.abs(final) < 0.01) zeroAngleCounter[key].nearZero++;

        pose[resolved] = (pose[resolved] ?? 0) + final;
      }
    }

    // ============================================================
    // 로그
    // ============================================================
    console.log("[VMD] === Mapping ===");
    console.log(`[VMD] Euler: ${EULER_ORDER}, vmdFps: ${vmdFps}, resampleFps: ${resampleFps}`);
    mappingLog.forEach((js, bone) => console.log(`  ${bone} → [${js.join(", ")}]`));
    if (unmapped.size > 0) console.log("[VMD] Unmapped:", [...unmapped].join(", "));

    console.log("[VMD] === Zero-angle ===");
    const ze = Object.entries(zeroAngleCounter);
    ze.sort((a, b) => (b[1].nearZero / b[1].total) - (a[1].nearZero / a[1].total));
    for (const [k, c] of ze) {
      const pct = ((c.nearZero / c.total) * 100).toFixed(0);
      console.log(`  ${k}: ${c.nearZero}/${c.total} (${pct}%)${c.nearZero / c.total > 0.9 ? " ⚠️" : " ✅"}`);
    }

    // densify
    const sortedFrames = Object.keys(frameMap).map(Number).sort((a, b) => a - b);
    const baseFrame = sortedFrames.length ? sortedFrames[0] : 0;
    const lastPose: Record<string, number> = {};
    const rawOut: VmdKeyframe[] = [];

    for (const f of sortedFrames) {
      Object.assign(lastPose, frameMap[f]);
      const rebased = f - baseFrame;
      rawOut.push({ frame: rebased, timeSec: rebased / vmdFps, pose: { ...lastPose } });
    }

    const dur = rawOut.length > 0 ? rawOut[rawOut.length - 1].timeSec : 0;
    console.log(`[VMD] Raw: ${rawOut.length} kf, duration=${dur.toFixed(3)}s, lastFrame=${rawOut.length ? rawOut[rawOut.length - 1].frame : 0}`);

    if (doSubtractRest && rawOut.length > 0) this.subtractRestPose(rawOut);

    // ============================================================
    // ★ 리샘플링 — frame을 vmdFps 기준으로 재매핑
    // ============================================================
    let out: VmdKeyframe[];
    if (resampleFps > 0 && rawOut.length >= 2) {
      out = this.resample(rawOut, resampleFps, vmdFps);
      // ★ duration 일관성 검증
      const resampledDur = out.length > 0 ? out[out.length - 1].timeSec : 0;
      const lastResampledFrame = out.length > 0 ? out[out.length - 1].frame : 0;
      const frameDur = lastResampledFrame / vmdFps;
      console.log(
        `[VMD] Resampled: ${rawOut.length} → ${out.length} @ ${resampleFps}Hz`
      );
      console.log(
        `[VMD]   timeSec duration: ${resampledDur.toFixed(3)}s`
      );
      console.log(
        `[VMD]   frame/${vmdFps} duration: ${frameDur.toFixed(3)}s`
      );
      if (Math.abs(resampledDur - frameDur) > 0.05) {
        console.warn(
          `[VMD] ⚠️ Duration mismatch! timeSec=${resampledDur.toFixed(3)} vs frame/${vmdFps}=${frameDur.toFixed(3)}. ` +
          `Consumer MUST use timeSec, not frame/${vmdFps}.`
        );
      } else {
        console.log(`[VMD]   ✅ Duration consistent.`);
      }
    } else {
      out = rawOut;
    }

    // diagnostics
    if (out.length > 0) {
      const toDeg = 180 / Math.PI;

      console.log("[VMD] First 3:");
      for (const kf of out.slice(0, 3)) {
        const e = Object.entries(kf.pose).map(([k, v]) => `${k}=${v.toFixed(3)}`).join("  ");
        console.log(`  f${kf.frame} t=${kf.timeSec.toFixed(3)}s: ${e}`);
      }

      // symmetry
      const ci = Math.min(5, out.length - 1);
      const fp = out[ci].pose;
      const pairs = [
        ["l_sho_pitch", "r_sho_pitch"], ["l_sho_roll", "r_sho_roll"],
        ["l_el", "r_el"], ["l_hip_pitch", "r_hip_pitch"],
        ["l_hip_roll", "r_hip_roll"], ["l_knee", "r_knee"],
        ["l_ank_pitch", "r_ank_pitch"],
      ];
      console.log("[VMD] === Symmetry ===");
      for (const [l, r] of pairs) {
        const lR = this.resolveJointName(l, robotJointNames);
        const rR = this.resolveJointName(r, robotJointNames);
        if (lR && rR) {
          const lv = fp[lR] ?? 0, rv = fp[rR] ?? 0;
          const s = Math.abs(lv + rv) < 0.1 ? "✅" : Math.abs(lv - rv) < 0.1 ? "⚠️ same" : `❓ ${((lv + rv) * toDeg).toFixed(1)}°`;
          console.log(`  ${lR}=${(lv * toDeg).toFixed(1)}° ${rR}=${(rv * toDeg).toFixed(1)}° ${s}`);
        }
      }

      // arm-leg
      const LSP = this.resolveJointName("l_sho_pitch", robotJointNames);
      const LHP = this.resolveJointName("l_hip_pitch", robotJointNames);
      const RSP = this.resolveJointName("r_sho_pitch", robotJointNames);
      const RHP = this.resolveJointName("r_hip_pitch", robotJointNames);
      const v = (n: string | null, p: Record<string, number>) => n ? (p[n] ?? 0) : 0;
      if (LSP && LHP && RSP && RHP) {
        const cL = this.pearsonCorrelation(out.map(k => v(LSP, k.pose)), out.map(k => v(LHP, k.pose)));
        const cR = this.pearsonCorrelation(out.map(k => v(RSP, k.pose)), out.map(k => v(RHP, k.pose)));
        console.log(`[VMD] Arm-Leg corr: L=${cL.toFixed(3)}${cL < -0.5 ? "✅" : "⚠️"} R=${cR.toFixed(3)}${cR < -0.5 ? "✅" : "⚠️"}`);
      }

      // knee
      const LK = this.resolveJointName("l_knee", robotJointNames);
      const RK = this.resolveJointName("r_knee", robotJointNames);
      if (LK || RK) {
        let neg = 0, pos = 0;
        for (const kf of out) {
          if (LK && (kf.pose[LK] ?? 0) < -0.01) neg++;
          if (LK && (kf.pose[LK] ?? 0) > 0.01) pos++;
          if (RK && (kf.pose[RK] ?? 0) < -0.01) neg++;
          if (RK && (kf.pose[RK] ?? 0) > 0.01) pos++;
        }
        console.log(`[VMD] Knee: ${pos}+, ${neg}- ${neg === 0 ? "✅" : "⚠️"}`);
      }

      // ranges
      const dj = [
        "l_knee", "r_knee", "l_hip_pitch", "r_hip_pitch", "l_hip_roll", "r_hip_roll",
        "l_hip_yaw", "r_hip_yaw", "l_sho_pitch", "r_sho_pitch", "l_sho_roll", "r_sho_roll",
        "l_el", "r_el", "head_pan", "head_tilt", "l_ank_pitch", "r_ank_pitch",
        "l_ank_roll", "r_ank_roll",
      ];
      console.log("[VMD] === Ranges ===");
      for (const d of dj) {
        const res = this.resolveJointName(d, robotJointNames);
        if (!res) continue;
        let mn = Infinity, mx = -Infinity;
        for (const kf of out) {
          const val = kf.pose[res]; if (val !== undefined) { mn = Math.min(mn, val); mx = Math.max(mx, val); }
        }
        if (mn !== Infinity) {
          const rng = mx - mn;
          console.log(`  ${res}: ${(mn * toDeg).toFixed(1)}°~${(mx * toDeg).toFixed(1)}° Δ=${(rng * toDeg).toFixed(1)}°${rng < 0.05 ? " ⚠️" : ""}`);
        }
      }

      this.calibrateArmLegPhase(out, robotJointNames);
      console.log("[VMD] Running hip pitch scanner...");
      this.scanBestHipPitchMapping(buffer, robotJointNames, vmdFps);
    }

    return out;
  }
}
