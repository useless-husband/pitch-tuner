// 測試用的合成訊號（全部決定性：雜訊使用固定種子）

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const noteFreq = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const centsError = (measured, expected) => 1200 * Math.log2(measured / expected);

export function sine(freq, sr, n, amp = 0.5, phase = 0.3) {
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sr;
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(w * i + phase);
  return out;
}

/** 加法合成（頻帶限制，不會混疊）：saw = 全部泛音 1/k；square = 奇數泛音 1/k */
export function additive(freq, sr, n, kind = 'saw', amp = 0.4) {
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sr;
  const maxK = Math.floor((sr * 0.45) / freq);
  for (let k = 1; k <= maxK; k++) {
    if (kind === 'square' && k % 2 === 0) continue;
    const g = amp * (kind === 'square' ? 4 / Math.PI : 2 / Math.PI) / k;
    for (let i = 0; i < n; i++) out[i] += g * Math.sin(w * k * i + 0.2 * k);
  }
  return out;
}

/** 基頻較弱、二三泛音較強的訊號（容易造成八度錯誤） */
export function weakFundamental(freq, sr, n) {
  const out = new Float32Array(n);
  const w = (2 * Math.PI * freq) / sr;
  const amps = [0.15, 0.5, 0.4, 0.2, 0.1];
  amps.forEach((a, idx) => {
    for (let i = 0; i < n; i++) out[i] += a * Math.sin(w * (idx + 1) * i + idx);
  });
  return out;
}

/**
 * Karplus-Strong 撥弦。回傳 total 個取樣點的訊號。
 * 迴圈延遲 = D + 0.5（平均濾波器貢獻 0.5），以線性內插取分數延遲。
 */
export function karplusStrong(freq, sr, total, seed = 7, decay = 0.997) {
  const D = sr / freq - 0.5;
  const y = new Float32Array(total);
  const rng = makeRng(seed);
  const init = Math.ceil(D) + 1;
  // 初始激發：在 20% 位置撥弦的三角形波形 + 少量雜訊（基頻能量穩定）
  const pluckAt = Math.floor(init * 0.2);
  for (let i = 0; i < init && i < total; i++) {
    const tri = i < pluckAt ? i / pluckAt : (init - i) / (init - pluckAt);
    y[i] = (tri - 0.5) * 1.6 + (rng() - 0.5) * 0.3;
  }
  const at = (pos) => {
    const i0 = Math.floor(pos), f = pos - i0;
    return y[i0] * (1 - f) + y[i0 + 1] * f;
  };
  for (let n = init; n < total; n++) {
    y[n] = decay * 0.5 * (at(n - D) + at(n - D - 1));
  }
  return y;
}

export function addNoise(sig, amp, seed = 42) {
  const rng = makeRng(seed);
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] + amp * (rng() * 2 - 1);
  return out;
}

export function whiteNoise(n, amp, seed = 3) {
  return addNoise(new Float32Array(n), amp, seed);
}
