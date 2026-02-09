type Side = "l" | "r" | "c";
type Segment =
  | "root"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "shoulder"
  | "elbow"
  | "wrist"
  | "hip"
  | "knee"
  | "ankle";

type Dof = "pitch" | "roll" | "yaw" | "x" | "y" | "z" | "flex" | "twist" | "abd";

type JointFeatures = {
  name: string;
  norm: string;
  side: Side;
  seg: Segment | null;
  dof: Dof | null;
};

type BoneProfile = {
  side: Side;
  seg: Segment;
  // 선호 DOF (모델마다 다르니 우선순위로 둠)
  dofPref?: Dof[];
  // 이름 토큰 힌트(가산점)
  tokens?: string[];
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/joint/g, "")
    .trim();

const detectSide = (name: string): Side => {
  const s = name.toLowerCase();
  if (/(^|[^a-z])l($|[^a-z])/.test(s) || s.includes("left") || s.includes("lf") || s.includes("_l"))
    return "l";
  if (/(^|[^a-z])r($|[^a-z])/.test(s) || s.includes("right") || s.includes("rf") || s.includes("_r"))
    return "r";
  return "c";
};

const detectSeg = (name: string): Segment | null => {
  const s = name.toLowerCase();
  if (s.includes("abdomen") || s.includes("spine") || s.includes("waist")) return "spine";
  if (s.includes("chest") || s.includes("thorax") || s.includes("torso")) return "chest";
  if (s.includes("neck")) return "neck";
  if (s.includes("head")) return "head";

  if (s.includes("shoulder") || s.includes("clav") || s.includes("scap")) return "shoulder";
  if (s.includes("elbow")) return "elbow";
  if (s.includes("wrist") || s.includes("hand")) return "wrist";

  if (s.includes("hip")) return "hip";
  if (s.includes("knee")) return "knee";
  if (s.includes("ankle") || s.includes("foot")) return "ankle";

  if (s.includes("root") || s.includes("pelvis") || s.includes("base")) return "root";
  return null;
};

const detectDof = (name: string): Dof | null => {
  const s = name.toLowerCase();

  // pitch/roll/yaw
  if (s.includes("pitch")) return "pitch";
  if (s.includes("roll")) return "roll";
  if (s.includes("yaw")) return "yaw";

  // mujoco humanoid 흔한 축 표기: hip_x / hip_y / hip_z, abdomen_x ...
  if (/(^|_)x($|_)/.test(s) || s.endsWith("x")) return "x";
  if (/(^|_)y($|_)/.test(s) || s.endsWith("y")) return "y";
  if (/(^|_)z($|_)/.test(s) || s.endsWith("z")) return "z";

  // 기타 표현
  if (s.includes("flex") || s.includes("bend")) return "flex";
  if (s.includes("twist") || s.includes("rot")) return "twist";
  if (s.includes("abd") || s.includes("abduct")) return "abd";

  return null;
};

const VMD_BONE_PROFILE: Record<string, BoneProfile> = {
  // 몸통
  "センター": { side: "c", seg: "root", tokens: ["root", "pelvis", "base"] },
  "下半身": { side: "c", seg: "spine", tokens: ["pelvis", "waist", "abdomen"] },
  "上半身": { side: "c", seg: "spine", tokens: ["spine", "abdomen"] },
  "上半身2": { side: "c", seg: "chest", tokens: ["chest", "thorax", "torso"] },
  "首": { side: "c", seg: "neck", tokens: ["neck"] },
  "頭": { side: "c", seg: "head", tokens: ["head"] },

  // 왼팔
  "左肩": {
    side: "l",
    seg: "shoulder",
    dofPref: ["pitch", "y", "x", "roll", "z", "yaw"],
    tokens: ["shoulder", "clav"],
  },
  "左腕": {
    side: "l",
    seg: "shoulder",
    dofPref: ["roll", "x", "z", "yaw", "pitch", "y"],
    tokens: ["upperarm", "arm", "shoulder"],
  },
  "左ひじ": { side: "l", seg: "elbow", dofPref: ["flex", "x", "pitch", "y"], tokens: ["elbow"] },
  "左手首": { side: "l", seg: "wrist", dofPref: ["roll", "yaw", "z", "x"], tokens: ["wrist", "hand"] },

  // 오른팔
  "右肩": {
    side: "r",
    seg: "shoulder",
    dofPref: ["pitch", "y", "x", "roll", "z", "yaw"],
    tokens: ["shoulder", "clav"],
  },
  "右腕": {
    side: "r",
    seg: "shoulder",
    dofPref: ["roll", "x", "z", "yaw", "pitch", "y"],
    tokens: ["upperarm", "arm", "shoulder"],
  },
  "右ひじ": { side: "r", seg: "elbow", dofPref: ["flex", "x", "pitch", "y"], tokens: ["elbow"] },
  "右手首": { side: "r", seg: "wrist", dofPref: ["roll", "yaw", "z", "x"], tokens: ["wrist", "hand"] },

  // 다리
  "左足": { side: "l", seg: "hip", dofPref: ["pitch", "y", "x", "roll", "z"], tokens: ["hip"] },
  "左ひざ": { side: "l", seg: "knee", dofPref: ["flex", "x", "pitch", "y"], tokens: ["knee"] },
  "左足首": { side: "l", seg: "ankle", dofPref: ["pitch", "x", "y", "roll", "z"], tokens: ["ankle", "foot"] },

  "右足": { side: "r", seg: "hip", dofPref: ["pitch", "y", "x", "roll", "z"], tokens: ["hip"] },
  "右ひざ": { side: "r", seg: "knee", dofPref: ["flex", "x", "pitch", "y"], tokens: ["knee"] },
  "右足首": { side: "r", seg: "ankle", dofPref: ["pitch", "x", "y", "roll", "z"], tokens: ["ankle", "foot"] },
};

function buildFeatures(jointName: string): JointFeatures {
  return {
    name: jointName,
    norm: normalize(jointName),
    side: detectSide(jointName),
    seg: detectSeg(jointName),
    dof: detectDof(jointName),
  };
}

function score(profile: BoneProfile, jf: JointFeatures): number {
  let s = 0;

  // side
  if (profile.side === jf.side) s += 8;
  else if (profile.side !== "c" && jf.side !== "c") s -= 3; // 좌우 반대면 감점

  // segment
  if (jf.seg === profile.seg) s += 10;
  else if (jf.seg == null) s -= 2;

  // dof preference
  if (profile.dofPref?.length) {
    const idx = jf.dof ? profile.dofPref.indexOf(jf.dof) : -1;
    if (idx >= 0) s += Math.max(0, 6 - idx); // 앞에 있을수록 가산점
  }

  // token hint
  if (profile.tokens?.length) {
    const lower = jf.name.toLowerCase();
    for (const t of profile.tokens) {
      if (lower.includes(t)) s += 2;
    }
  }

  // 약한 문자열 포함 가산(마지막 보정)
  const pkey = normalize(profile.seg + profile.side); // e.g., "shoulderl"
  if (jf.norm.includes(pkey)) s += 1;

  return s;
}

export type AutoMapResult = {
  map: Record<string, string>; // vmdBoneName -> mujocoJointName
  unsure: Array<{ bone: string; picked: string; score: number; top3: Array<{ joint: string; score: number }> }>;
};

export function autoMapVmdBonesToMujocoJoints(robotJointNames: string[]): AutoMapResult {
  const feats = robotJointNames.map(buildFeatures);

  const result: AutoMapResult = { map: {}, unsure: [] };

  for (const [bone, profile] of Object.entries(VMD_BONE_PROFILE)) {
    const scored = feats
      .map((jf) => ({ joint: jf.name, s: score(profile, jf) }))
      .sort((a, b) => b.s - a.s);

    const best = scored[0];
    if (!best) continue;

    // 임계값(모델마다 조정 가능)
    if (best.s >= 12) {
      result.map[bone] = best.joint;

      // 2등과 점수차가 작으면 "불확실"로 표시
      const second = scored[1];
      if (second && best.s - second.s <= 2) {
        result.unsure.push({
          bone,
          picked: best.joint,
          score: best.s,
          top3: scored.slice(0, 3).map((x) => ({ joint: x.joint, score: x.s })),
        });
      }
    } else {
      // 너무 애매하면 매핑 안 함(원하면 best를 넣고 unsure로 보내도 됨)
      // result.map[bone] = best.joint;
      result.unsure.push({
        bone,
        picked: best.joint,
        score: best.s,
        top3: scored.slice(0, 3).map((x) => ({ joint: x.joint, score: x.s })),
      });
    }
  }

  return result;
}