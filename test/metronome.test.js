import test from 'node:test';
import assert from 'node:assert/strict';
import { Metronome, clampBpm, BPM_MIN, BPM_MAX } from '../src/metronome.js';

/** 假時鐘 + 假計時器：完全決定性 */
function rig(opts = {}) {
  const clock = { t: 10 };
  const beats = [];
  const timers = [];
  const timer = {
    set: (fn, sec) => { timers.push({ fn, sec }); return timers.length; },
    clear: (id) => { timers[id - 1] = null; },
  };
  const m = new Metronome({
    now: () => clock.t, onBeat: (b) => beats.push(b), timer, ...opts,
  });
  return { clock, beats, timers, m };
}

test('clampBpm 限制在 30–240 並四捨五入', () => {
  assert.equal(BPM_MIN, 30);
  assert.equal(BPM_MAX, 240);
  assert.equal(clampBpm(10), 30);
  assert.equal(clampBpm(999), 240);
  assert.equal(clampBpm(120.6), 121);
  assert.equal(clampBpm('abc'), 120);
});

test('啟動後第一拍在 now + startDelay，且立即排定', () => {
  const { m, beats } = rig({ startDelay: 0.05 });
  m.start();
  assert.equal(beats.length, 1);
  assert.ok(Math.abs(beats[0].time - 10.05) < 1e-12);
  assert.equal(beats[0].index, 0);
});

test('120 BPM：拍距 0.5 秒', () => {
  const { m, clock, beats } = rig({ bpm: 120 });
  m.start();
  for (let i = 0; i < 40; i++) { clock.t += 0.1; m.tick(); }
  const times = beats.map((b) => b.time);
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - 0.5) < 1e-9);
  assert.ok(beats.length >= 8);
});

test('拍時間不會因喚醒間隔抖動而漂移（絕對誤差為浮點級）', () => {
  const { m, clock, beats } = rig({ bpm: 97 });
  m.start();
  const jitter = [0.011, 0.043, 0.02, 0.09, 0.005, 0.06, 0.03];
  for (let i = 0; i < 2000; i++) { clock.t += jitter[i % jitter.length]; m.tick(); }
  const first = beats[0].time;
  beats.forEach((b, i) => assert.ok(Math.abs(b.time - (first + (i * 60) / 97)) < 1e-6, `beat ${i}`));
});

test('4/4 拍：重音在每小節第一拍', () => {
  const { m, clock, beats } = rig({ bpm: 240, beatsPerBar: 4 });
  m.start();
  for (let i = 0; i < 50; i++) { clock.t += 0.1; m.tick(); }
  beats.forEach((b) => {
    assert.equal(b.index, beats.indexOf(b) % 4);
    assert.equal(b.accent, b.index === 0);
  });
});

test('3/4 拍：拍序 0 1 2 0 1 2', () => {
  const { m, clock, beats } = rig({ bpm: 240, beatsPerBar: 3 });
  m.start();
  for (let i = 0; i < 30; i++) { clock.t += 0.1; m.tick(); }
  assert.deepEqual(beats.slice(0, 7).map((b) => b.index), [0, 1, 2, 0, 1, 2, 0]);
});

test('關閉重音時沒有重音拍', () => {
  const { m, clock, beats } = rig({ accent: false });
  m.start();
  for (let i = 0; i < 30; i++) { clock.t += 0.1; m.tick(); }
  assert.ok(beats.every((b) => !b.accent));
});

test('lookahead：只提前排程 lookahead 秒內的拍子', () => {
  const { m, beats } = rig({ bpm: 240, lookahead: 0.5, startDelay: 0 }); // 拍距 0.25
  m.start();
  assert.equal(beats.length, 2); // t=10 與 10.25 < 10.5
});

test('tick 一次不會重複排定同一拍', () => {
  const { m } = rig();
  m.start();
  assert.equal(m.tick().length, 0);
  assert.equal(m.tick().length, 0);
});

test('主執行緒卡頓 1 秒後，補排的拍時間仍準確', () => {
  const { m, clock, beats } = rig({ bpm: 120 });
  m.start();
  clock.t += 1.0;
  m.tick();
  const times = beats.map((b) => b.time);
  assert.deepEqual(times.map((t) => +(t - times[0]).toFixed(6)), [0, 0.5, 1]);
});

test('setBpm 只影響之後的拍距，且不會排到過去', () => {
  const { m, clock, beats } = rig({ bpm: 60, startDelay: 0 });
  m.start();          // 拍 0 @10
  clock.t = 10.9; m.tick(); // 拍 1 @11 已排定 (lookahead 0.15)
  m.setBpm(120);
  clock.t = 11.4; m.tick();
  const t = beats.map((b) => b.time);
  assert.ok(Math.abs(t[1] - 11) < 1e-9);
  assert.ok(Math.abs(t[2] - 11.5) < 1e-9);
  assert.ok(t.every((x, i) => i === 0 || x > t[i - 1]));
});

test('setBpm 極端值被限制', () => {
  const { m } = rig();
  m.setBpm(5);
  assert.equal(m.bpm, 30);
  m.setBpm(1000);
  assert.equal(m.bpm, 240);
});

test('beatDuration = 60 / bpm', () => {
  const { m } = rig({ bpm: 75 });
  assert.equal(m.beatDuration, 0.8);
});

test('中途改拍號：拍序不會超出範圍', () => {
  const { m, clock, beats } = rig({ bpm: 240, beatsPerBar: 4 });
  m.start();
  clock.t += 0.6; m.tick();
  m.setBeatsPerBar(2);
  clock.t += 2; m.tick();
  assert.ok(beats.every((b) => b.index < 4));
  assert.ok(beats.slice(-4).every((b) => b.index < 2));
});

test('stop 之後 tick 不再排程，並取消計時器', () => {
  const { m, clock, beats, timers } = rig();
  m.start();
  const n = beats.length;
  m.stop();
  clock.t += 5;
  assert.equal(m.tick().length, 0);
  assert.equal(beats.length, n);
  assert.equal(m.running, false);
  assert.ok(timers.every((t) => t === null || t));
  assert.equal(timers[timers.length - 1], null);
});

test('計時器只負責喚醒：每次喚醒重新排下一次（間隔 25ms）', () => {
  const { m, timers, clock } = rig();
  m.start();
  assert.equal(timers.length, 1);
  assert.ok(Math.abs(timers[0].sec - 0.025) < 1e-12);
  clock.t += 0.5;
  timers[0].fn();
  assert.equal(timers.length, 2);
});

test('停止後重新啟動，拍序從 0 開始', () => {
  const { m, clock, beats } = rig({ bpm: 240 });
  m.start();
  clock.t += 0.6; m.tick();
  m.stop();
  beats.length = 0;
  clock.t += 3;
  m.start();
  assert.equal(beats[0].index, 0);
  assert.ok(beats[0].accent);
});

test('拍號限制在 1–12', () => {
  const { m } = rig();
  m.setBeatsPerBar(0);
  assert.equal(m.beatsPerBar, 1);
  m.setBeatsPerBar(99);
  assert.equal(m.beatsPerBar, 12);
});

for (const bpm of [30, 60, 90, 120, 180, 240]) {
  test(`${bpm} BPM：10 秒內拍數正確`, () => {
    const { m, clock, beats } = rig({ bpm, startDelay: 0 });
    m.start();
    for (let i = 0; i < 400; i++) { clock.t += 0.025; m.tick(); }
    const inWindow = beats.filter((b) => b.time < 20 - 1e-9).length;
    assert.equal(inWindow, Math.ceil((bpm * 10) / 60));
  });
}
