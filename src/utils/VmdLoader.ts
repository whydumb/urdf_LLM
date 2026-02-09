import { Quaternion, Euler } from "three";

// ============================================================
// VMD 본 → MuJoCo 조인트 매핑
//
// MMD 본 로컬 좌표계 (Y-up, 오른손):
//   X축 회전 = pitch (앞뒤 굽힘)
//   Y축 회전 = yaw   (세로축 비틀기)
//   Z축 회전 = roll  (옆으로)
//
// ★ 복합 회전 본 → euler 모드
// ★ 단순 힌지(무릎/팔꿈치) → twist 모드
// ============================================================
interface BoneMapping {
  joint: string;
  mmdAxis: "x" | "y" | "z";
  extractMode?: "twist" | "euler";
  sign: number;
  offset: number;
}

const VMD_TO_MJ: Record<string, BoneMapping[]> = {
  // ---- head / neck ----
  "首": [
    { joint: "head_pan", mmdAxis: "y", extractMode: "euler", sign: 1, offset: 0 },
  ],
  "頭": [
    { joint: "head_tilt", mmdAxis: "x", extractMode: "euler", sign: 1, offset: 0 },
  ],

  // ---- 왼팔 ----
  "左肩": [
    { joint: "l_sho_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "左腕": [
    { joint: "l_sho_roll", mmdAxis: "z", extractMode: "euler", sign: 1, offset: 0 },
  ],
  "左ひじ": [
    { joint: "l_el", mmdAxis: "x", sign: -1, offset: 0 },
  ],

  // ---- 오른팔 ----
  "右肩": [
    { joint: "r_sho_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "右腕": [
    { joint: "r_sho_roll", mmdAxis: "z", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "右ひじ": [
    { joint: "r_el", mmdAxis: "x", sign: -1, offset: 0 },
  ],

  // ---- 왼다리 ----
  "左足": [
    { joint: "l_hip_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
    { joint: "l_hip_roll", mmdAxis: "z", extractMode: "euler", sign: -1, offset: 0 },
    { joint: "l_hip_yaw", mmdAxis: "y", extractMode: "euler", sign: 1, offset: 0 },
  ],
  "左ひざ": [
    { joint: "l_knee", mmdAxis: "x", sign: 1, offset: 0 },
  ],
  "左足首": [
    { joint: "l_ank_pitch", mmdAxis: "x", extractMode: "euler", sign: 1, offset: 0 },
    { joint: "l_ank_roll", mmdAxis: "z", extractMode: "euler", sign: 1, offset: 0 },
  ],

  // ---- 오른다리 ----
  "右足": [
    { joint: "r_hip_pitch", mmdAxis: "x", extractMode: "euler", sign: -1, offset: 0 },
    { joint: "r_hip_roll", mmdAxis: "z", extractMode: "euler", sign: 1, offset: 0 },
    { joint: "r_hip_yaw", mmdAxis: "y", extractMode: "euler", sign: -1, offset: 0 },
  ],
  "右ひざ": [
    { joint: "r_knee", mmdAxis: "x", sign: 1, offset: 0 },
  ],
  "右足首": [
    { joint: "r_ank_pitch", mmdAxis: "x", extractMode: "euler", sign: 1, offset: 0 },
    { joint: "r_ank_roll", mmdAxis: "z", extractMode: "euler", sign: -1, offset: 0 },
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
  pose: { [jointName: string]: number };
};

export type VmdLoaderOptions = {
  boneMap?: Record<string, string>;
  boneMapMulti?: Record<string, BoneMapping[]>;
};

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

  // --- 각도 추출 ---
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
    const euler = new Euler().setFromQuaternion(q, "YXZ");
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
    if (mapping.extractMode === "euler") {
      return this.eulerAngleAboutAxis(qx, qy, qz, qw, mapping.mmdAxis);
    }
    return this.twistAngleAboutAxis(qx, qy, qz, qw, mapping.mmdAxis);
  }

  // --- 메인 ---
  static load(
    buffer: ArrayBuffer,
    robotJointNames: string[],
    opts?: VmdLoaderOptions,
  ): VmdKeyframe[] {
    const data = new DataView(buffer);
    const decoder = new TextDecoder("shift-jis");
    let offset = 0;

    const magic = decoder
      .decode(new Uint8Array(buffer, 0, 30))
      .replace(/\0/g, "")
      .trim();
    if (!magic.startsWith("Vocaloid Motion Data")) {
      throw new Error("Invalid VMD file");
    }
    offset += 30 + 20;

    const motionCount = data.getUint32(offset, true);
    offset += 4;

    const mappingLog = new Map<string, string[]>();
    const unmapped = new Set<string>();
    const zeroAngleCounter: Record<string, { total: number; nearZero: number }> = {};
    const frameMap: Record<number, Record<string, number>> = {};

    // 디버그: 주요 본 원시 쿼터니언
    const rawDebugBones = new Set(["右ひじ", "左ひじ", "右肩", "左肩", "右足", "左足", "首", "頭"]);
    const rawDebugSeen = new Map<string, number>();

    for (let i = 0; i < motionCount; i++) {
      const boneName = decoder
        .decode(new Uint8Array(buffer, offset, 15))
        .replace(/\0/g, "")
        .trim();
      offset += 15;

      const frameNum = data.getUint32(offset, true);
      offset += 4;
      offset += 12; // position skip

      const qx = data.getFloat32(offset, true); offset += 4;
      const qy = data.getFloat32(offset, true); offset += 4;
      const qz = data.getFloat32(offset, true); offset += 4;
      const qw = data.getFloat32(offset, true); offset += 4;
      offset += 64; // interpolation skip

      // 원시 디버그 (본당 최대 3)
      if (rawDebugBones.has(boneName)) {
        const cnt = rawDebugSeen.get(boneName) ?? 0;
        if (cnt < 3) {
          rawDebugSeen.set(boneName, cnt + 1);
          const q = new Quaternion(qx, qy, qz, qw).normalize();
          const euler = new Euler().setFromQuaternion(q, "YXZ");
          const toDeg = 180 / Math.PI;
          console.log(
            `[VMD RAW] ${boneName} f${frameNum}: ` +
            `q(${qx.toFixed(4)}, ${qy.toFixed(4)}, ${qz.toFixed(4)}, ${qw.toFixed(4)}) → ` +
            `euler(x=${(euler.x * toDeg).toFixed(1)}°, y=${(euler.y * toDeg).toFixed(1)}°, z=${(euler.z * toDeg).toFixed(1)}°)`
          );
        }
      }

      // ============================================================
      // ★ 매핑 우선순위 수정:
      //    boneMapMulti > built-in(VMD_TO_MJ) > boneMap(최후 fallback)
      //
      //    이전: boneMap이 built-in을 덮어씌워서 "어깨→힙" 헛매핑
      //    수정: built-in이 있으면 boneMap을 무시
      // ============================================================
      let mappings: BoneMapping[] | null = null;

      // 1순위: 유저 boneMapMulti (명시적 다축 매핑)
      if (opts?.boneMapMulti?.[boneName]) {
        mappings = opts.boneMapMulti[boneName];
      }

      // 2순위: built-in VMD_TO_MJ (검증된 매핑)
      if (!mappings) {
        const builtIn = VMD_TO_MJ[boneName];
        if (builtIn) {
          const valid = builtIn.filter(m => this.jointExists(m.joint, robotJointNames));
          if (valid.length > 0) {
            mappings = valid;
          } else {
            console.warn(
              `[VMD] ⚠️ Bone "${boneName}" mapped to [${builtIn.map(m => m.joint).join(", ")}] ` +
              `but NONE found in robot joints!`
            );
          }
        }
      }

      // 3순위 (최후 fallback): 유저 boneMap (단일 조인트, built-in에 없는 본만)
      if (!mappings && opts?.boneMap?.[boneName]) {
        const targetJoint = opts.boneMap[boneName];
        if (this.jointExists(targetJoint, robotJointNames)) {
          // built-in에서 축/모드 정보를 빌려올 수 있으면 빌려옴
          const builtInForBone = VMD_TO_MJ[boneName];
          const builtInMatch = builtInForBone?.find(m => m.joint === targetJoint);
          if (builtInMatch) {
            mappings = [{ ...builtInMatch }];
          } else {
            mappings = [{ joint: targetJoint, mmdAxis: "x", extractMode: "euler", sign: 1, offset: 0 }];
          }
        }
      }

      if (!mappings || mappings.length === 0) {
        unmapped.add(boneName);
        continue;
      }

      if (!mappingLog.has(boneName)) {
        mappingLog.set(
          boneName,
          mappings.map(m => `${m.joint}(${m.extractMode ?? "twist"}:${m.mmdAxis})`),
        );
      }

      const pose = (frameMap[frameNum] ??= {});

      for (const mapping of mappings) {
        const resolvedName = this.resolveJointName(mapping.joint, robotJointNames);
        if (!resolvedName) continue;

        const rawAngle = this.extractAngle(qx, qy, qz, qw, mapping);
        const finalAngle = mapping.sign * rawAngle + mapping.offset;

        const key = `${boneName}→${resolvedName}(${mapping.extractMode ?? "twist"}:${mapping.mmdAxis})`;
        if (!zeroAngleCounter[key]) {
          zeroAngleCounter[key] = { total: 0, nearZero: 0 };
        }
        zeroAngleCounter[key].total++;
        if (Math.abs(finalAngle) < 0.01) {
          zeroAngleCounter[key].nearZero++;
        }

        if (pose[resolvedName] !== undefined) continue;
        pose[resolvedName] = finalAngle;
      }
    }

    // === 진단 로그 ===
    console.log("[VMD] === Mapping Result ===");
    mappingLog.forEach((joints, bone) => {
      console.log(`  ${bone} → [${joints.join(", ")}]`);
    });
    if (unmapped.size > 0) {
      console.log("[VMD] Unmapped VMD bones:", [...unmapped].join(", "));
    }
    console.log("[VMD] Robot joints:", robotJointNames.join(", "));

    console.log("[VMD] === Zero-angle diagnostic ===");
    const zeroEntries = Object.entries(zeroAngleCounter);
    zeroEntries.sort((a, b) => (b[1].nearZero / b[1].total) - (a[1].nearZero / a[1].total));
    for (const [key, counts] of zeroEntries) {
      const pct = ((counts.nearZero / counts.total) * 100).toFixed(0);
      const isMostlyZero = counts.nearZero / counts.total > 0.9;
      console.log(
        `  ${key}: ${counts.nearZero}/${counts.total} near-zero (${pct}%)` +
        (isMostlyZero ? " ⚠️ MOSTLY ZERO" : " ✅")
      );
    }

    // === densify + rebase ===
    const sortedFrames = Object.keys(frameMap).map(Number).sort((a, b) => a - b);
    const baseFrame = sortedFrames.length ? sortedFrames[0] : 0;
    const lastPose: Record<string, number> = {};
    const out: VmdKeyframe[] = [];

    for (const f of sortedFrames) {
      Object.assign(lastPose, frameMap[f]);
      out.push({
        frame: f - baseFrame,
        pose: { ...lastPose },
      });
    }

    console.log(
      `[VMD] Loaded: ${out.length} keyframes, ` +
      `frame range 0–${out.length ? out[out.length - 1].frame : 0}`,
    );

    if (out.length > 0) {
      console.log("[VMD] First 3 keyframes:");
      for (const kf of out.slice(0, 3)) {
        const entries = Object.entries(kf.pose)
          .map(([k, v]) => `${k}=${v.toFixed(3)}`)
          .join("  ");
        console.log(`  frame ${kf.frame}: ${entries}`);
      }

      const debugJoints = [
        "l_knee", "r_knee",
        "l_hip_pitch", "r_hip_pitch",
        "l_hip_roll", "r_hip_roll",
        "l_hip_yaw", "r_hip_yaw",
        "l_sho_pitch", "r_sho_pitch",
        "l_sho_roll", "r_sho_roll",
        "l_el", "r_el",
        "head_pan", "head_tilt",
        "l_ank_pitch", "r_ank_pitch",
        "l_ank_roll", "r_ank_roll",
      ];
      console.log("[VMD] === Joint angle ranges ===");
      for (const dj of debugJoints) {
        const resolved = this.resolveJointName(dj, robotJointNames);
        if (!resolved) continue;
        let min = Infinity, max = -Infinity;
        for (const kf of out) {
          const v = kf.pose[resolved];
          if (v !== undefined) {
            min = Math.min(min, v);
            max = Math.max(max, v);
          }
        }
        if (min !== Infinity) {
          const toDeg = 180 / Math.PI;
          const range = max - min;
          const warn = range < 0.05 ? " ⚠️ TINY RANGE" : "";
          console.log(
            `  📊 ${resolved}: ${min.toFixed(3)}~${max.toFixed(3)} rad ` +
            `(${(min * toDeg).toFixed(1)}°~${(max * toDeg).toFixed(1)}°) ` +
            `Δ=${(range * toDeg).toFixed(1)}°${warn}`
          );
        }
      }
    }

    return out;
  }
}
