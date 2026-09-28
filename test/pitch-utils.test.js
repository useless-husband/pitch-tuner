import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameAssembler, PitchSmoother, rms, createDetector } from '../src/pitch.js';
import { TraceBuffer } from '../src/trace.js';
import { describeMicError, isMicContextAllowed, unsupported } from '../src/mic-errors.js';
import { sine, centsError } from './helpers.js';

test('rms：全零為 0，振幅 A 的正弦約 A/√2', () => {
  assert.equal(rms(new Float32Array(100)), 0);
  assert.ok(Math.abs(rms(sine(440, 48000, 48000, 0.5)) - 0.5 / Math.SQRT2) < 1e-3);
  assert.equal(rms([]), 0);
});

test('FrameAssembler：滿框之後每 hop 個取樣點產生一個取樣框', () => {
  const frames = [];
  const a = new FrameAssembler(8, 4, (f) => frames.push(Array.from(f)));
  const src = Array.from({ length: 24 }, (_, i) => i);
  for (let i = 0; i < src.length; i += 3) a.push(src.slice(i, i + 3));
  assert.deepEqual(frames[0], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(frames[1], [4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(frames.length, 5); // 8,12,16,20,24
  assert.deepEqual(frames[4], [16, 17, 18, 19, 20, 21, 22, 23]);
});

test('FrameAssembler：以 128 點區塊餵入，框內順序正確（由舊到新）', () => {
  const sr = 48000, f = 440;
  const sig = sine(f, sr, 20000, 0.5);
  const det = createDetector({ sampleRate: sr });
  const results = [];
  const a = new FrameAssembler(4096, 1024, (frame) => results.push(det.detect(frame).freq));
  for (let i = 0; i + 128 <= sig.length; i += 128) a.push(sig.subarray(i, i + 128));
  assert.ok(results.length >= 10);
  results.forEach((r) => assert.ok(Math.abs(centsError(r, f)) < 3));
});

test('FrameAssembler：資料不足一框時不輸出', () => {
  let n = 0;
  const a = new FrameAssembler(16, 4, () => n++);
  a.push(new Float32Array(15));
  assert.equal(n, 0);
});

test('PitchSmoother：單點八度跳動被中位數濾掉', () => {
  const s = new PitchSmoother({ size: 5 });
  const out = [440, 440, 440, 880, 440].map((f) => s.push(f));
  assert.ok(Math.abs(centsError(out[3], 440)) < 1e-6);
  assert.ok(Math.abs(centsError(out[4], 440)) < 1e-6);
});

test('PitchSmoother：換音後最多 3 筆就跟上', () => {
  const s = new PitchSmoother({ size: 5 });
  [220, 220, 220, 220, 220].forEach((f) => s.push(f));
  const outs = [330, 330, 330].map((f) => s.push(f));
  assert.ok(Math.abs(centsError(outs[2], 330)) < 1e-6);
});

test('PitchSmoother：短暫無聲時保持上一個值，超過 holdFrames 才清空', () => {
  const s = new PitchSmoother({ size: 3, holdFrames: 2 });
  s.push(440);
  assert.ok(s.push(null) > 0);
  assert.ok(s.push(null) > 0);
  assert.equal(s.push(null), null);
  assert.equal(s.push(null), null);
});

test('PitchSmoother：清空後不殘留舊資料', () => {
  const s = new PitchSmoother({ size: 3, holdFrames: 0 });
  s.push(100);
  s.push(null);
  assert.ok(Math.abs(centsError(s.push(500), 500)) < 1e-6);
});

test('PitchSmoother：對固定種子的抖動有降噪效果', () => {
  let seed = 5;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  const s = new PitchSmoother({ size: 7 });
  let rawSq = 0, smSq = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    const cents = rnd() * 20; // ±10 音分
    const f = 440 * 2 ** (cents / 1200);
    const out = s.push(f);
    if (i > 10) { rawSq += cents ** 2; smSq += centsError(out, 440) ** 2; n++; }
  }
  assert.ok(Math.sqrt(smSq / n) < Math.sqrt(rawSq / n) * 0.7);
});

test('TraceBuffer：只保留最近 10 秒', () => {
  const t = new TraceBuffer(10);
  for (let i = 0; i <= 30; i++) t.add(i, 60);
  assert.equal(t.points[0].t, 20);
  assert.equal(t.points.length, 11);
});

test('TraceBuffer：範圍至少 2 個半音並置中', () => {
  const t = new TraceBuffer();
  t.add(0, 60.1); t.add(1, 60.2);
  const r = t.range();
  assert.ok(Math.abs(r.hi - r.lo - 2) < 1e-9);
  assert.ok(Math.abs((r.hi + r.lo) / 2 - 60.15) < 1e-9);
});

test('TraceBuffer：資料跨度大時範圍隨之放大；null 不計入', () => {
  const t = new TraceBuffer();
  t.add(0, 50); t.add(1, null); t.add(2, 57);
  const r = t.range();
  assert.ok(Math.abs(r.hi - r.lo - 8) < 1e-9);
});

test('TraceBuffer：沒有資料時 range 為 null，clear 可清空', () => {
  const t = new TraceBuffer();
  assert.equal(t.range(), null);
  t.add(0, 60); t.clear();
  assert.equal(t.points.length, 0);
});

test('isMicContextAllowed：https 或 localhost 才可', () => {
  assert.equal(isMicContextAllowed({ hostname: 'example.com' }, true), true);
  assert.equal(isMicContextAllowed({ hostname: 'localhost' }, false), true);
  assert.equal(isMicContextAllowed({ hostname: '127.0.0.1' }, false), true);
  assert.equal(isMicContextAllowed({ hostname: '192.168.1.5' }, false), false);
});

test('describeMicError：權限被拒絕，附 iPhone Safari 步驟', () => {
  const r = describeMicError({ name: 'NotAllowedError' });
  assert.equal(r.kind, 'denied');
  assert.ok(r.steps.some((s) => s.includes('iPhone Safari')));
});

test('describeMicError：各種錯誤類型', () => {
  assert.equal(describeMicError({ name: 'NotFoundError' }).kind, 'notfound');
  assert.equal(describeMicError({ name: 'NotReadableError' }).kind, 'busy');
  assert.equal(describeMicError({ name: 'Weird', message: 'boom' }).kind, 'other');
  assert.equal(describeMicError(new TypeError('navigator.mediaDevices is undefined')).kind, 'unsupported');
  assert.equal(describeMicError({ name: 'NotAllowedError' }, { secure: false }).kind, 'insecure');
  assert.equal(unsupported().kind, 'unsupported');
  assert.equal(describeMicError(null).kind, 'other');
});
