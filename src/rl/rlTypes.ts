// src/rl/rlTypes.ts
export type Obs = Float32Array;
export type Action = Float32Array;

export type EnvStepResult = {
  obs: Obs;
  reward: number;
  done: boolean;
  info?: Record<string, any>;
};

export type EnvConfig = {
  jointOrder: string[];
  dt: number;
  substeps: number;
  actionScale: number;      // residual scale (rad)
  kp: number;               // PD gain if using PD fallback
  kd: number;
};