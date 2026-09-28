// YIN 基頻偵測 (de Cheveigné & Kawahara, 2002)
// 步驟：1 差分函數 -> 2 累積平均正規化 -> 3 絕對門檻 -> 4 拋物線內插

export const MAX_MULTIPLE = 8;
export const NO_PITCH = Object.freeze({ freq: 0, confidence: 0 });

/** 步驟 1：差分函數 d(tau) = sum_j (x[j] - x[j+tau])^2 */
export function differenceFunction(buf, W, tauMax) {
  const d = new Float64Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const delta = buf[j] - buf[j + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  return d;
}

/** 步驟 2：累積平均正規化差分 d'(tau) = d(tau) * tau / sum_{k<=tau} d(k) */
export function cumulativeMeanNormalize(d) {
  const out = new Float64Array(d.length);
  out[0] = 1;
  let running = 0;
  for (let tau = 1; tau < d.length; tau++) {
    running += d[tau];
    out[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  return out;
}

/** 步驟 4：三點拋物線內插，回傳修正量（-0.5 ~ 0.5） */
export function parabolicShift(a, b, c) {
  const denom = a - 2 * b + c;
  if (denom === 0) return 0;
  const shift = (a - c) / (2 * denom);
  return Math.max(-1, Math.min(1, shift));
}

/**
 * @param {Float32Array|number[]} buf 至少 2 * (sampleRate / minFreq) 個取樣點較佳
 * @returns {{freq:number, confidence:number}} freq 為 0 代表沒有偵測到音高
 */
export function yin(buf, sampleRate, opts = {}) {
  const { threshold = 0.15, fallbackThreshold = 0.3, minFreq = 60, maxFreq = 2200 } = opts;
  const W = buf.length >> 1;
  const tauMax = Math.min(W - 2, Math.ceil(sampleRate / minFreq));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  if (tauMax <= tauMin + 2) return NO_PITCH;

  const d = differenceFunction(buf, W, tauMax);
  const cmnd = cumulativeMeanNormalize(d);

  // 步驟 3：第一個低於門檻的谷底（再往下走到局部最小）
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // 沒有低於門檻的谷底：取全域最小，但仍須夠低
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
    if (cmnd[best] > fallbackThreshold) return NO_PITCH;
    tau = best;
  }

  let refined = tau;
  if (tau > 1 && tau < tauMax + 1) {
    refined = tau + parabolicShift(cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]);
  }
  // 高音的週期只有幾十個取樣點，內插誤差佔比大：改量測 k 個週期再除以 k
  const k = Math.min(MAX_MULTIPLE, Math.floor(tauMax / tau));
  if (k > 1) {
    const centre = Math.round(refined * k);
    const half = Math.ceil(k / 2) + 1;
    let best = -1;
    for (let t = Math.max(2, centre - half); t <= Math.min(tauMax, centre + half); t++) {
      if (best < 0 || d[t] < d[best]) best = t;
    }
    if (best > 1 && best < tauMax) {
      const multi = (best + parabolicShift(d[best - 1], d[best], d[best + 1])) / k;
      if (Math.abs(multi - refined) < 1) refined = multi;
    }
  }
  return { freq: sampleRate / refined, confidence: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}
