// src/rl/reward.ts
import type { RefSample } from "@/utils/ReferenceMotion";

export type ObsLayout = {
  rootPos: { start: number; len: 3 };
  rootQuat: { start: number; len: 4 };
  rootLinVel: { start: number; len: 3 };
  rootAngVel: { start: number; len: 3 };
  q: { start: number; len: number };     // joints
  qd: { start: number; len: number };    // joints
  phase: { start: number; len: 1 };
};

export function makeObsLayout(nJoints: number): ObsLayout {
  // [rootPos3, rootQuat4, rootLinVel3, rootAngVel3, q(n), qd(n), phase1]
  let s = 0;
  const rootPos = { start: s, len: 3 }; s += 3;
  const rootQuat = { start: s, len: 4 }; s += 4;
  const rootLinVel = { start: s, len: 3 }; s += 3;
  const rootAngVel = { start: s, len: 3 }; s += 3;
  const q = { start: s, len: nJoints }; s += nJoints;
  const qd = { start: s, len: nJoints }; s += nJoints;
  const phase = { start: s, len: 1 }; s += 1;
  return { rootPos, rootQuat, rootLinVel, rootAngVel, q, qd, phase };
}

function expReward(k: number, mse: number) {
  return Math.exp(-k * mse);
}

export function computeImitationReward(
  obs: Float32Array,
  layout: ObsLayout,
  ref: RefSample,
  weights = { pose: 0.65, vel: 0.25, alive: 0.10 },
  k = { pose: 2.0, vel: 0.1 }
) {
  const n = layout.q.len;

  let poseMSE = 0;
  for (let i = 0; i < n; i++) {
    const dq = obs[layout.q.start + i] - ref.qRef[i];
    poseMSE += dq * dq;
  }
  poseMSE /= Math.max(1, n);

  let velMSE = 0;
  for (let i = 0; i < n; i++) {
    const dqd = obs[layout.qd.start + i] - ref.qdRef[i];
    velMSE += dqd * dqd;
  }
  velMSE /= Math.max(1, n);

  const rPose = expReward(k.pose, poseMSE);
  const rVel = expReward(k.vel, velMSE);
  const alive = 1.0;

  return weights.pose * rPose + weights.vel * rVel + weights.alive * alive;
}

export function computeDone(obs: Float32Array, layout: ObsLayout, opts = { minRootHeight: 0.75 }) {
  const rootY = obs[layout.rootPos.start + 2]; // MuJoCo free joint: z-up이면 z가 높이(모델에 따라 다를 수 있음)
  return rootY < opts.minRootHeight;
}