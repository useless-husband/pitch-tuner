import test from 'node:test';
import assert from 'node:assert/strict';
import { yin } from '../src/yin.js';
import { mpm } from '../src/mpm.js';
import { createDetector } from '../src/pitch.js';
import {
  sine, additive, weakFundamental, karplusStrong, addNoise, whiteNoise, noteFreq, centsError,
} from './helpers.js';

const N = 4096;
const ALGOS = { yin, mpm };
const OPTS = { minFreq: 60, maxFreq: 2200 };
// E2 (MIDI 40) 到 C7 (MIDI 96)；每 4 個半音取一個，再加上 C7 本身
const MIDIS = [40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96];
// 故意偏離半音 +13 音分，避免頻率剛好落在整數週期上
const detune = (midi) => noteFreq(midi) * 2 ** (13 / 1200);

const SIGNALS = {
  sine: (f, sr) => sine(f, sr, N),
  saw: (f, sr) => additive(f, sr, N, 'saw'),
  square: (f, sr) => additive(f, sr, N, 'square'),
  'weak-fundamental': (f, sr) => weakFundamental(f, sr, N),
  'karplus-strong': (f, sr) => karplusStrong(f, sr, N + 3000).subarray(3000),
  'saw+noise': (f, sr) => addNoise(additive(f, sr, N, 'saw'), 0.05, 11),
};

for (const [algoName, fn] of Object.entries(ALGOS)) {
  for (const [sigName, make] of Object.entries(SIGNALS)) {
    for (const midi of MIDIS) {
      const sr = midi % 8 === 0 ? 48000 : 44100;
      test(`${algoName}: ${sigName} MIDI ${midi} @${sr} 誤差 < 3 音分`, () => {
        const f = detune(midi);
        const r = fn(make(f, sr), sr, OPTS);
        assert.ok(r.freq > 0, '應該偵測到音高');
        const err = centsError(r.freq, f);
        assert.ok(Math.abs(err) < 3, `誤差 ${err.toFixed(2)} 音分`);
        assert.ok(r.confidence > 0.7, `信心度 ${r.confidence}`);
      });
    }
  }

  test(`${algoName}: 半音階 E2~C7 每個半音的八度錯誤率 = 0`, () => {
    let octaveErrors = 0, total = 0;
    for (let midi = 40; midi <= 96; midi++) {
      for (const kind of ['saw', 'weak-fundamental', 'karplus-strong']) {
        const sr = 44100;
        const f = noteFreq(midi);
        const r = fn(SIGNALS[kind](f, sr), sr, OPTS);
        total++;
        // 任何超過半個半音的偏差（含八度、倍頻錯誤、沒有輸出）都算錯
        if (!(r.freq > 0) || Math.abs(centsError(r.freq, f)) > 50) octaveErrors++;
      }
    }
    assert.equal(total, 57 * 3);
    assert.equal(octaveErrors / total, 0, `${octaveErrors}/${total} 次八度／倍頻錯誤`);
  });

  test(`${algoName}: 全部音高加雜訊 (SNR≈20dB) 仍在 5 音分內`, () => {
    for (let midi = 40; midi <= 96; midi += 2) {
      const sr = 44100, f = noteFreq(midi);
      const noisy = addNoise(sine(f, sr, N, 0.5), 0.05, midi);
      const r = fn(noisy, sr, OPTS);
      assert.ok(Math.abs(centsError(r.freq, f)) < 5, `MIDI ${midi}`);
    }
  });

  test(`${algoName}: 純白雜訊不輸出音高`, () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = fn(whiteNoise(N, 0.3, seed), 44100, OPTS);
      assert.equal(r.freq, 0, `seed ${seed}`);
    }
  });

  test(`${algoName}: 全零（靜音）不輸出音高`, () => {
    assert.equal(fn(new Float32Array(N), 44100, OPTS).freq, 0);
  });

  test(`${algoName}: 直流偏移不影響結果`, () => {
    const f = 196 * 2 ** (7 / 1200);
    const s = sine(f, 44100, N, 0.3);
    for (let i = 0; i < N; i++) s[i] += 0.4;
    assert.ok(Math.abs(centsError(fn(s, 44100, OPTS).freq, f)) < 3);
  });

  test(`${algoName}: 貝斯 E1 (41.2Hz) 用低頻範圍可偵測`, () => {
    const f = noteFreq(28);
    const r = fn(additive(f, 48000, N, 'saw'), 48000, { minFreq: 30, maxFreq: 400 });
    assert.ok(Math.abs(centsError(r.freq, f)) < 3, String(r.freq));
  });

  test(`${algoName}: 音量不同（振幅 0.02 / 0.9）結果一致`, () => {
    const f = 329.63;
    const a = fn(sine(f, 44100, N, 0.02), 44100, OPTS).freq;
    const b = fn(sine(f, 44100, N, 0.9), 44100, OPTS).freq;
    assert.ok(Math.abs(centsError(a, b)) < 0.5);
  });
}

test('YIN 與 MPM 在同一訊號上的結果差 < 3 音分', () => {
  for (const midi of [45, 57, 69, 81]) {
    const f = detune(midi);
    const s = additive(f, 44100, N, 'saw');
    assert.ok(Math.abs(centsError(yin(s, 44100, OPTS).freq, mpm(s, 44100, OPTS).freq)) < 3);
  }
});

test('createDetector: 音量低於門檻回傳 null，且不呼叫演算法結果', () => {
  const d = createDetector({ sampleRate: 44100 });
  const quiet = sine(440, 44100, N, 0.002);
  assert.equal(d.detect(quiet).freq, null);
  assert.ok(d.detect(quiet).rms < 0.008);
});

test('createDetector: 正常音量回傳頻率與信心度', () => {
  for (const algorithm of ['yin', 'mpm']) {
    const d = createDetector({ sampleRate: 44100, algorithm });
    const r = d.detect(sine(440, 44100, N, 0.4));
    assert.ok(Math.abs(centsError(r.freq, 440)) < 3);
    assert.ok(r.confidence > 0.9);
  }
});

test('createDetector: 白雜訊即使音量大也回傳 null', () => {
  for (const algorithm of ['yin', 'mpm']) {
    const d = createDetector({ sampleRate: 44100, algorithm });
    assert.equal(d.detect(whiteNoise(N, 0.5, 9)).freq, null);
  }
});

test('createDetector: configure 可切換演算法與範圍', () => {
  const d = createDetector({ sampleRate: 44100 });
  d.configure({ algorithm: 'mpm', minFreq: 200, maxFreq: 1000 });
  assert.equal(d.config.algorithm, 'mpm');
  // 100 Hz 在範圍之外：不應回報 100Hz 附近
  const r = d.detect(sine(100, 44100, N, 0.4));
  assert.ok(!r.freq || Math.abs(centsError(r.freq, 100)) > 50);
});
