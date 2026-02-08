/// <reference lib="webworker" />

import * as tf from "@tensorflow/tfjs";

// 메시지 타입 정의
type InitMsg = { type: "INIT"; obsDim: number; actDim: number; hidden?: number; lr?: number };
type ActMsg  = { type: "ACT"; obs: ArrayBuffer; deterministic?: boolean };
type ValMsg  = { type: "VAL"; obs: ArrayBuffer };
type SaveMsg = { type: "SAVE" };
type LoadMsg = { type: "LOAD"; json: string };
type PingMsg = { type: "PING" }; // ★ PING 타입 추가
type UpdateMsg = {
  type: "UPDATE";
  obsDim: number;
  actDim: number;
  steps: number;
  obs: ArrayBuffer;
  act: ArrayBuffer;
  rew: ArrayBuffer;
  done: ArrayBuffer;
  logp: ArrayBuffer;
  val: ArrayBuffer;
  lastVal: number;
  gamma?: number;
  lam?: number;
  clip?: number;
  trainIters?: number;
  minibatch?: number;
  vfCoef?: number;
  entCoef?: number;
};

// ★ Msg 타입에 PingMsg 추가
type Msg = InitMsg | ActMsg | ValMsg | UpdateMsg | SaveMsg | LoadMsg | PingMsg;

// 전역 변수
let obsDim = 0;
let actDim = 0;

let policy: tf.LayersModel | null = null;
let valueFn: tf.LayersModel | null = null;
let logStd: tf.Variable | null = null;
let opt: tf.Optimizer | null = null;

const LOG_2PI = Math.log(2 * Math.PI);

// 모델 생성 함수
function buildMLP(inputDim: number, outputDim: number, hidden = 128, outAct: "tanh" | "none" = "none") {
  const inp = tf.input({ shape: [inputDim] });
  let x = tf.layers.dense({ units: hidden, activation: "relu" }).apply(inp) as tf.SymbolicTensor;
  x = tf.layers.dense({ units: hidden, activation: "relu" }).apply(x) as tf.SymbolicTensor;
  const out = tf.layers.dense({ units: outputDim, activation: outAct === "tanh" ? "tanh" : undefined }).apply(x) as tf.SymbolicTensor;
  return tf.model({ inputs: inp, outputs: out });
}

// 가우시안 로그 확률 계산
function gaussianLogProb(a: tf.Tensor2D, mean: tf.Tensor2D, logStd1D: tf.Tensor1D) {
  const logStdB = logStd1D.reshape([1, -1]);
  const stdB = tf.exp(logStdB);
  const z = a.sub(mean).div(stdB);
  const logpEach = z.square().add(logStdB.mul(2)).add(LOG_2PI).mul(-0.5);
  return tf.sum(logpEach, 1);
}

// 엔트로피 계산
function entropyDiagGaussian(logStd1D: tf.Tensor1D) {
  const c = 0.5 * Math.log(2 * Math.PI * Math.E);
  return tf.sum(logStd1D.add(c));
}

// 인덱스 셔플
function shuffleIndices(n: number) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

// TF 초기화
async function ensureReady() {
  await tf.setBackend("cpu");
  await tf.ready();
}

// 메인 이벤트 리스너
(self as any).onmessage = async (ev: MessageEvent<Msg>) => {
  const msg = ev.data;

  try {
    // 0. ★ PING 핸들러 추가
    if (msg.type === "PING") {
      (self as any).postMessage({ type: "PONG" });
      return;
    }

    // 1. INIT
    if (msg.type === "INIT") {
      await ensureReady();

      obsDim = msg.obsDim;
      actDim = msg.actDim;
      const hidden = msg.hidden ?? 128;
      const lr = msg.lr ?? 3e-4;

      policy = buildMLP(obsDim, actDim, hidden, "tanh");
      valueFn = buildMLP(obsDim, 1, hidden, "none");
      logStd = tf.variable(tf.fill([actDim], Math.log(0.3)));
      opt = tf.train.adam(lr);

      (self as any).postMessage({ type: "INIT_OK" });
      return;
    }

    // 2. ACT
    if (msg.type === "ACT") {
      if (!policy || !valueFn || !logStd) throw new Error("Worker not initialized");

      const obsArr = new Float32Array(msg.obs);
      const out = tf.tidy(() => {
        const obsT = tf.tensor2d(obsArr, [1, obsDim]);
        const mean = policy!.predict(obsT) as tf.Tensor2D; // [-1,1]
        const v = valueFn!.predict(obsT) as tf.Tensor2D;   // scalar

        let a: tf.Tensor;
        
        // 결정적 행동 (Test 모드용)
        if (msg.deterministic) {
          a = mean; 
        } else {
          // 확률적 행동 (Training 모드용)
          const std = tf.exp(logStd!);
          const eps = tf.randomNormal([1, actDim]);
          const aRaw = mean.add(eps.mul(std.reshape([1, -1])));
          a = tf.clipByValue(aRaw, -1, 1);
        }

        const logp = gaussianLogProb(a as tf.Tensor2D, mean, logStd!);

        return {
          action: (a.dataSync() as Float32Array),
          logp: (logp.dataSync() as Float32Array)[0],
          value: (v.dataSync() as Float32Array)[0],
        };
      });

      (self as any).postMessage(
        { type: "ACT_RES", action: out.action.buffer, logp: out.logp, value: out.value },
        [out.action.buffer]
      );
      return;
    }

    // 3. VAL
    if (msg.type === "VAL") {
      if (!valueFn) throw new Error("Worker not initialized");
      const obsArr = new Float32Array(msg.obs);
      const value = tf.tidy(() => {
        const obsT = tf.tensor2d(obsArr, [1, obsDim]);
        const v = valueFn!.predict(obsT) as tf.Tensor2D;
        return (v.dataSync() as Float32Array)[0];
      });
      (self as any).postMessage({ type: "VAL_RES", value });
      return;
    }

    // 4. UPDATE
    if (msg.type === "UPDATE") {
      if (!policy || !valueFn || !logStd || !opt) throw new Error("Worker not initialized");

      const steps = msg.steps;
      const gamma = msg.gamma ?? 0.99;
      const lam = msg.lam ?? 0.95;
      const clip = msg.clip ?? 0.2;
      const trainIters = msg.trainIters ?? 6;
      const minibatch = msg.minibatch ?? 128;
      const vfCoef = msg.vfCoef ?? 0.5;
      const entCoef = msg.entCoef ?? 0.0;

      const obs = new Float32Array(msg.obs);
      const act = new Float32Array(msg.act);
      const rew = new Float32Array(msg.rew);
      const done = new Uint8Array(msg.done);
      const logpOld = new Float32Array(msg.logp);
      const valOld = new Float32Array(msg.val);
      const lastVal = msg.lastVal;

      // GAE 계산
      const adv = new Float32Array(steps);
      const ret = new Float32Array(steps);
      let gae = 0;
      let nextV = lastVal;

      for (let t = steps - 1; t >= 0; t--) {
        const notDone = done[t] ? 0 : 1;
        const delta = rew[t] + gamma * nextV * notDone - valOld[t];
        gae = delta + gamma * lam * notDone * gae;
        adv[t] = gae;
        nextV = valOld[t];
      }
      for (let t = 0; t < steps; t++) ret[t] = adv[t] + valOld[t];

      // Advantage 정규화
      let meanA = 0;
      for (let i = 0; i < steps; i++) meanA += adv[i];
      meanA /= steps;
      let varA = 0;
      for (let i = 0; i < steps; i++) {
        const d = adv[i] - meanA;
        varA += d * d;
      }
      varA /= steps;
      const stdA = Math.sqrt(varA + 1e-8);
      for (let i = 0; i < steps; i++) adv[i] = (adv[i] - meanA) / stdA;

      // 학습 루프
      let lastPiLoss = 0, lastVLoss = 0, lastEnt = 0, lastKL = 0;

      for (let iter = 0; iter < trainIters; iter++) {
        const idx = shuffleIndices(steps);
        for (let start = 0; start < steps; start += minibatch) {
          const end = Math.min(steps, start + minibatch);
          const bsz = end - start;

          const obB = new Float32Array(bsz * obsDim);
          const acB = new Float32Array(bsz * actDim);
          const advB = new Float32Array(bsz);
          const retB = new Float32Array(bsz);
          const logpB = new Float32Array(bsz);

          for (let bi = 0; bi < bsz; bi++) {
            const t = idx[start + bi];
            obB.set(obs.subarray(t * obsDim, (t + 1) * obsDim), bi * obsDim);
            acB.set(act.subarray(t * actDim, (t + 1) * actDim), bi * actDim);
            advB[bi] = adv[t];
            retB[bi] = ret[t];
            logpB[bi] = logpOld[t];
          }

          const stats = tf.tidy(() => {
            const obsT = tf.tensor2d(obB, [bsz, obsDim]);
            const actT = tf.tensor2d(acB, [bsz, actDim]);
            const advT = tf.tensor1d(advB);
            const retT = tf.tensor1d(retB);
            const logpOldT = tf.tensor1d(logpB);

            // Gradient Step
            const { value, grads } = tf.variableGrads(() => {
              const mean = policy!.predict(obsT) as tf.Tensor2D;
              const vPred = (valueFn!.predict(obsT) as tf.Tensor2D).reshape([bsz]);
              
              const logp = gaussianLogProb(actT, mean, logStd!);
              const ratio = tf.exp(logp.sub(logpOldT));
              
              const unclipped = ratio.mul(advT);
              const clipped = tf.clipByValue(ratio, 1 - clip, 1 + clip).mul(advT);
              const piLoss = tf.neg(tf.mean(tf.minimum(unclipped, clipped)));
              
              const vLoss = tf.mean(tf.square(vPred.sub(retT)));
              const ent = entropyDiagGaussian(logStd!);
              
              return piLoss.add(vLoss.mul(vfCoef)).sub(ent.mul(entCoef));
            });

            opt!.applyGradients(grads);
            Object.values(grads).forEach(g => g.dispose());
            value.dispose();

            // Stats (no grad)
            const mean = policy!.predict(obsT) as tf.Tensor2D;
            const vPred = (valueFn!.predict(obsT) as tf.Tensor2D).reshape([bsz]);
            const logp = gaussianLogProb(actT, mean, logStd!);
            const ratio = tf.exp(logp.sub(logpOldT));
            const approxKl = tf.mean(logpOldT.sub(logp));
            const piLossMon = tf.neg(tf.mean(tf.minimum(ratio.mul(advT), tf.clipByValue(ratio, 1 - clip, 1 + clip).mul(advT))));
            const vLossMon = tf.mean(tf.square(vPred.sub(retT)));
            const entMon = entropyDiagGaussian(logStd!);

            return {
              piLoss: piLossMon.dataSync()[0],
              vLoss: vLossMon.dataSync()[0],
              ent: entMon.dataSync()[0],
              kl: approxKl.dataSync()[0],
            };
          });

          lastPiLoss = stats.piLoss;
          lastVLoss = stats.vLoss;
          lastEnt = stats.ent;
          lastKL = stats.kl;
        }
      }

      (self as any).postMessage({
        type: "UPDATE_RES",
        piLoss: lastPiLoss, vLoss: lastVLoss, ent: lastEnt, kl: lastKL,
      });
      return;
    }

    // 5. SAVE
    if (msg.type === "SAVE") {
      if (!policy || !valueFn || !logStd) throw new Error("Worker not initialized");
      
      const pWeights = policy.getWeights().map(w => Array.from(w.dataSync()));
      const vWeights = valueFn.getWeights().map(w => Array.from(w.dataSync()));
      const lStd = Array.from(logStd.dataSync());

      const json = JSON.stringify({ p: pWeights, v: vWeights, l: lStd });
      
      (self as any).postMessage({ type: "SAVE_RES", json });
      return;
    }

    // 6. LOAD
    if (msg.type === "LOAD") {
      if (!policy || !valueFn || !logStd) throw new Error("Worker not initialized. Call INIT first.");
      
      const data = JSON.parse(msg.json);

      const restoreWeights = (model: tf.LayersModel, weightsData: number[][]) => {
        const originalWeights = model.getWeights();
        if (originalWeights.length !== weightsData.length) {
          throw new Error("Weights count mismatch");
        }
        const newTensors = originalWeights.map((w, i) => {
          return tf.tensor(weightsData[i], w.shape);
        });
        model.setWeights(newTensors);
        newTensors.forEach(t => t.dispose());
      };

      tf.tidy(() => {
        restoreWeights(policy!, data.p);
        restoreWeights(valueFn!, data.v);
        logStd!.assign(tf.tensor(data.l, logStd!.shape));
      });

      (self as any).postMessage({ type: "LOAD_RES" });
      return;
    }

  } catch (e: any) {
    (self as any).postMessage({ type: "ERR", error: e?.message ?? String(e) });
  }
};