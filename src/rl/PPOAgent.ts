// src/rl/PPOAgent.ts

// act 결과에 action(배열)뿐만 아니라 확률(logp), 가치(value)가 포함됨
type ActRes = { action: Float32Array; logp: number; value: number };
// 학습 결과 통계
type UpdateStats = { piLoss: number; vLoss: number; ent: number; kl: number };

export class PPOAgent {
  private worker: Worker;
  private ready = false;

  constructor() {
    // Web Worker 생성 (경로는 프로젝트 설정에 따라 다를 수 있음)
    this.worker = new Worker(new URL("./ppoWorker.ts", import.meta.url), { type: "module" });
  }

  /**
   * 에이전트 초기화 (네트워크 생성)
   */
  async init(obsDim: number, actDim: number) {
    if (this.ready) return;

    await new Promise<void>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "INIT_OK") {
          this.worker.removeEventListener("message", onMsg);
          this.ready = true;
          resolve();
        } else if (d?.type === "ERR") {
          this.worker.removeEventListener("message", onMsg);
          reject(new Error(d.error));
        }
      };
      this.worker.addEventListener("message", onMsg);
      // 워커에게 초기화 명령 전송 (hidden size, learning rate 등)
      this.worker.postMessage({ type: "INIT", obsDim, actDim, hidden: 128, lr: 3e-4 });
    });
  }

  /**
   * 행동 결정 (Inference)
   * @param obs 관측 데이터
   * @param deterministic (추가됨) true면 랜덤 샘플링 없이 평균값(가장 확률 높은 행동) 반환 -> 테스트 모드용
   */
  act(obs: Float32Array, deterministic = false): Promise<ActRes> {
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "ACT_RES") {
          this.worker.removeEventListener("message", onMsg);
          resolve({ action: new Float32Array(d.action), logp: d.logp, value: d.value });
        } else if (d?.type === "ERR") {
          this.worker.removeEventListener("message", onMsg);
          reject(new Error(d.error));
        }
      };
      this.worker.addEventListener("message", onMsg);

      // obs 배열 복사 후 전송 (Transferable Object 사용)
      const copy = new Float32Array(obs);
      this.worker.postMessage(
        { type: "ACT", obs: copy.buffer, deterministic }, // deterministic 플래그 추가 전송
        [copy.buffer]
      );
    });
  }

  /**
   * 가치 함수 평가 (Critic)
   */
  value(obs: Float32Array): Promise<number> {
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "VAL_RES") {
          this.worker.removeEventListener("message", onMsg);
          resolve(d.value);
        } else if (d?.type === "ERR") {
          this.worker.removeEventListener("message", onMsg);
          reject(new Error(d.error));
        }
      };
      this.worker.addEventListener("message", onMsg);

      const copy = new Float32Array(obs);
      this.worker.postMessage({ type: "VAL", obs: copy.buffer }, [copy.buffer]);
    });
  }

  /**
   * PPO 업데이트 (Training)
   */
  update(batch: {
    obsDim: number;
    actDim: number;
    steps: number;
    obs: Float32Array;
    act: Float32Array;
    rew: Float32Array;
    done: Uint8Array;
    logp: Float32Array;
    val: Float32Array;
    lastVal: number;
  }): Promise<UpdateStats> {
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "UPDATE_RES") {
          this.worker.removeEventListener("message", onMsg);
          resolve({ piLoss: d.piLoss, vLoss: d.vLoss, ent: d.ent, kl: d.kl });
        } else if (d?.type === "ERR") {
          this.worker.removeEventListener("message", onMsg);
          reject(new Error(d.error));
        }
      };
      this.worker.addEventListener("message", onMsg);

      // 대량의 데이터를 워커로 전송 (Transferable Object로 성능 최적화)
      this.worker.postMessage(
        {
          type: "UPDATE",
          obsDim: batch.obsDim,
          actDim: batch.actDim,
          steps: batch.steps,
          obs: batch.obs.buffer,
          act: batch.act.buffer,
          rew: batch.rew.buffer,
          done: batch.done.buffer,
          logp: batch.logp.buffer,
          val: batch.val.buffer,
          lastVal: batch.lastVal,
          // 하이퍼파라미터
          gamma: 0.99,
          lam: 0.95,
          clip: 0.2,
          trainIters: 6,
          minibatch: 128,
          vfCoef: 0.5,
          entCoef: 0.0,
        },
        [
          batch.obs.buffer,
          batch.act.buffer,
          batch.rew.buffer,
          batch.done.buffer,
          batch.logp.buffer,
          batch.val.buffer,
        ]
      );
    });
  }

  /**
   * ★ [추가됨] 모델 가중치 내보내기 (Save)
   * 워커에게 가중치를 요청하고 JSON 문자열로 받습니다.
   */
  toJSON(): Promise<string> {
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "SAVE_RES") {
          this.worker.removeEventListener("message", onMsg);
          resolve(d.json);
        } else if (d?.type === "ERR") {
          this.worker.removeEventListener("message", onMsg);
          reject(new Error(d.error));
        }
      };
      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage({ type: "SAVE" });
    });
  }

  /**
   * ★ [추가됨] 모델 가중치 불러오기 (Load)
   * JSON 문자열을 워커에게 보내 신경망을 복구합니다.
   */
  fromJSON(jsonString: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "LOAD_RES") {
          this.worker.removeEventListener("message", onMsg);
          resolve();
        } else if (d?.type === "ERR") {
          this.worker.removeEventListener("message", onMsg);
          reject(new Error(d.error));
        }
      };
      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage({ type: "LOAD", json: jsonString });
    });
  }

  /**
   * ★ Worker의 잔여 메시지를 비우고 상태를 정리합니다.
   * 학습 중단 후 테스트 전에 호출하세요.
   */
  flush(): Promise<void> {
    return new Promise((resolve) => {
      // PING/PONG으로 Worker 메시지 큐를 비움
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === "PONG") {
          this.worker.removeEventListener("message", onMsg);
          resolve();
        }
        // 다른 메시지(이전 루프의 ACT_RES, UPDATE_RES 등)는 무시하고 버림
      };
      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage({ type: "PING" });
    });
  }

  dispose() {
    this.worker.terminate();
  }
}