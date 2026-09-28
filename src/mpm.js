// MPM：McLeod Pitch Method (McLeod & Wyvill, 2005)
// 用正規化平方差函數 (NSDF) 找峰值，再挑「第一個夠高的峰」以避免八度錯誤。

import { NO_PITCH, MAX_MULTIPLE, parabolicShift } from './yin.js';

/** NSDF(tau) = 2 * r(tau) / m(tau)，值域 [-1, 1] */
export function nsdf(buf, tauMax) {
  const N = buf.length;
  const out = new Float64Array(tauMax + 2);
  let m = 0;
  for (let i = 0; i < N; i++) m += buf[i] * buf[i];
  m *= 2;
  for (let tau = 0; tau <= tauMax + 1; tau++) {
    if (tau > 0) m -= buf[tau - 1] * buf[tau - 1] + buf[N - tau] * buf[N - tau];
    let r = 0;
    for (let j = 0; j < N - tau; j++) r += buf[j] * buf[j + tau];
    out[tau] = m > 0 ? (2 * r) / m : 0;
  }
  return out;
}

/** 在每一段「正值區間」裡找最高點 */
export function keyMaxima(n, tauMax) {
  const peaks = [];
  let tau = 1;
  while (tau < tauMax && n[tau] > 0) tau++; // 跳過 tau=0 附近的第一個大波瓣
  while (tau < tauMax) {
    while (tau < tauMax && n[tau] <= 0) tau++;
    let best = -1;
    while (tau <= tauMax && n[tau] > 0) {
      if (best < 0 || n[tau] > n[best]) best = tau;
      tau++;
    }
    if (best > 1 && best < tauMax && n[best] >= n[best - 1] && n[best] >= n[best + 1]) {
      peaks.push(best);
    }
  }
  return peaks;
}

/** 去除直流偏移（NSDF 對 DC 很敏感：DC 會讓所有 lag 的相關值都接近 1） */
export function removeDC(buf) {
  let mean = 0;
  for (let i = 0; i < buf.length; i++) mean += buf[i];
  mean /= buf.length || 1;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] - mean;
  return out;
}

export function mpm(input, sampleRate, opts = {}) {
  const { cutoff = 0.93, minClarity = 0.7, minFreq = 60, maxFreq = 2200 } = opts;
  const buf = removeDC(input);
  const N = buf.length;
  const tauMax = Math.min((N >> 1) - 2, Math.ceil(sampleRate / minFreq));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  if (tauMax <= tauMin + 2) return NO_PITCH;

  const n = nsdf(buf, tauMax);
  const peaks = keyMaxima(n, tauMax).filter((t) => t >= tauMin);
  if (peaks.length === 0) return NO_PITCH;

  let highest = 0;
  for (const t of peaks) highest = Math.max(highest, n[t]);
  if (highest < minClarity) return NO_PITCH;
  const chosen = peaks.find((t) => n[t] >= cutoff * highest);

  const shift = parabolicShift(-n[chosen - 1], -n[chosen], -n[chosen + 1]);
  let tau = chosen + shift;
  // 量測 k 個週期再除以 k，降低高音的內插誤差
  const k = Math.min(MAX_MULTIPLE, Math.floor(tauMax / chosen));
  if (k > 1) {
    const centre = Math.round(tau * k);
    const half = Math.ceil(k / 2) + 1;
    let best = -1;
    for (let t = Math.max(2, centre - half); t <= Math.min(tauMax, centre + half); t++) {
      if (best < 0 || n[t] > n[best]) best = t;
    }
    if (best > 1 && best < tauMax) {
      const multi = (best + parabolicShift(-n[best - 1], -n[best], -n[best + 1])) / k;
      if (Math.abs(multi - tau) < 1) tau = multi;
    }
  }
  // 內插後的峰值高度作為信心度
  const a = n[chosen - 1], b = n[chosen], c = n[chosen + 1];
  const peakValue = b - 0.25 * (a - c) * shift;
  return { freq: sampleRate / tau, confidence: Math.max(0, Math.min(1, peakValue)) };
}
