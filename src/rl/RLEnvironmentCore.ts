// src/rl/RLEnvironmentCore.ts
import type { EnvConfig, EnvStepResult, Obs, Action } from "@/rl/rlTypes";
import { ReferenceMotion } from "@/utils/ReferenceMotion";
import { computeDone, computeImitationReward, makeObsLayout } from "@/rl/reward";

export class RLEnvironmentCore {
  private obsLayout = makeObsLayout(0);
  private t = 0;
  private episodeReward = 0;
  private stepCount = 0;

  constructor(
    private rpc: { request: <T>(type: string, payload?: any) => Promise<T> },
    private cfg: EnvConfig,
    private refMotion: ReferenceMotion
  ) {
    this.obsLayout = makeObsLayout(cfg.jointOrder.length);
  }

  getConfig() { return this.cfg; }
  getStepCount() { return this.stepCount; }
  getEpisodeReward() { return this.episodeReward; }
  getTime() { return this.t; }

  async init() {
    await this.rpc.request("ENV_CONFIG", {
      jointOrder: this.cfg.jointOrder,
      dt: this.cfg.dt,
      substeps: this.cfg.substeps,
      actionScale: this.cfg.actionScale,
      kp: this.cfg.kp,
      kd: this.cfg.kd,
      obsLayout: "ROOT+Q+QD+PHASE",
    });
  }

  async reset(randomizePhase = true): Promise<Obs> {
    this.stepCount = 0;
    this.episodeReward = 0;

    const T = this.refMotion.durationSec();
    this.t = randomizePhase ? Math.random() * T : 0;

    const ref = this.refMotion.sample(this.t);

    // reset 시 reference pose로 관절 초기화(권장)
    const payload = {
      t0: this.t,
      qRef: ref.qRef,          // Float32Array
      qdRef: ref.qdRef,        // Float32Array
      phase: ref.phase,
    };

    const res = await this.rpc.request<{ obs: Float32Array; simTime: number }>("ENV_RESET", payload);
    this.t = res.simTime ?? this.t;
    return res.obs;
  }

  // residual target action: q_target = q_ref + actionScale * a
  private buildTargetFromAction(action: Action) {
    const ref = this.refMotion.sample(this.t);
    const n = this.cfg.jointOrder.length;

    const qTarget = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(-1, Math.min(1, action[i] ?? 0));
      qTarget[i] = ref.qRef[i] + this.cfg.actionScale * a;
    }
    return { qTarget, ref };
  }

  async step(action: Action): Promise<EnvStepResult> {
    const { qTarget, ref } = this.buildTargetFromAction(action);

    const res = await this.rpc.request<{ obs: Float32Array; simTime: number }>("ENV_STEP", {
      qTarget,
      // phase는 iframe이 obs에 넣도록, 여기서는 t만 진전시키면 됨
    });

    const obs = res.obs;
    this.t = res.simTime ?? (this.t + this.cfg.dt * this.cfg.substeps);

    const reward = computeImitationReward(obs, this.obsLayout, ref);
    const done = computeDone(obs, this.obsLayout);

    this.stepCount += 1;
    this.episodeReward += reward;

    return { obs, reward, done, info: { t: this.t } };
  }
}