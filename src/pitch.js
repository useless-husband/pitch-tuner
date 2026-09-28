// 把 YIN / MPM 包成偵測器，加上音量門檻、信心度門檻、取樣框組裝與平滑。

import { yin } from './yin.js';
import { mpm } from './mpm.js';

export const ALGORITHMS = { yin, mpm };
export const FRAME_SIZE = 4096;
export const HOP_SIZE = 1024;

export function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return buf.length ? Math.sqrt(sum / buf.length) : 0;
}

export function createDetector(config = {}) {
  const cfg = {
    algorithm: 'yin',
    sampleRate: 44100,
    minFreq: 50,
    maxFreq: 2200,
    rmsThreshold: 0.008,
    minConfidence: 0.7,
    ...config,
  };
  return {
    config: cfg,
    configure(partial) {
      Object.assign(cfg, partial);
    },
    /** @returns {{freq:number|null, confidence:number, rms:number}} 沒有音高時 freq 為 null */
    detect(frame) {
      const level = rms(frame);
      if (level < cfg.rmsThreshold) return { freq: null, confidence: 0, rms: level };
      const fn = ALGORITHMS[cfg.algorithm] || yin;
      const r = fn(frame, cfg.sampleRate, { minFreq: cfg.minFreq, maxFreq: cfg.maxFreq });
      if (!(r.freq > 0) || r.confidence < cfg.minConfidence) {
        return { freq: null, confidence: r.confidence, rms: level };
      }
      return { freq: r.freq, confidence: r.confidence, rms: level };
    },
  };
}

/** 把 128 點一塊的音訊串流累積成固定大小、固定步進的取樣框（環形緩衝） */
export class FrameAssembler {
  constructor(frameSize = FRAME_SIZE, hop = HOP_SIZE, onFrame = () => {}) {
    this.frameSize = frameSize;
    this.hop = hop;
    this.onFrame = onFrame;
    this.ring = new Float32Array(frameSize);
    this.frame = new Float32Array(frameSize);
    this.write = 0;
    this.filled = 0;
    this.sinceLast = 0;
  }

  push(block) {
    const size = this.frameSize;
    for (let i = 0; i < block.length; i++) {
      this.ring[this.write] = block[i];
      this.write = (this.write + 1) % size;
      if (this.filled < size) this.filled++;
      if (++this.sinceLast >= this.hop && this.filled === size) {
        this.sinceLast = 0;
        // 由舊到新展開
        const tail = size - this.write;
        this.frame.set(this.ring.subarray(this.write), 0);
        this.frame.set(this.ring.subarray(0, this.write), tail);
        this.onFrame(this.frame);
      }
    }
  }
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 平滑：在對數頻率（音分）上取最近 N 筆的中位數，濾掉單點的八度跳動；
 * 連續沒有訊號超過 holdFrames 次才清空。
 */
export class PitchSmoother {
  constructor({ size = 5, holdFrames = 8 } = {}) {
    this.size = size;
    this.holdFrames = holdFrames;
    this.reset();
  }

  reset() {
    this.history = [];
    this.misses = 0;
    this.last = null;
  }

  /** @param {number|null} freq @returns {number|null} */
  push(freq) {
    if (freq && freq > 0) {
      this.misses = 0;
      this.history.push(1200 * Math.log2(freq));
      if (this.history.length > this.size) this.history.shift();
      this.last = 2 ** (median(this.history) / 1200);
      return this.last;
    }
    this.misses++;
    if (this.misses > this.holdFrames) {
      this.reset();
      return null;
    }
    return this.last;
  }
}
