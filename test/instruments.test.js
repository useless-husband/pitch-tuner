import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, instrumentById, nearestString, stringFreqs, detectRange } from '../src/instruments.js';
import { formatNote, freqFromMidi } from '../src/notes.js';

const names = (id, style = 'letter') => {
  const inst = instrumentById(id);
  return inst.strings.map((m) => formatNote(m, style, inst.flats));
};

test('吉他標準調弦 E2 A2 D3 G3 B3 E4', () => {
  assert.deepEqual(names('guitar-standard'), ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
});
test('Drop D：D2 A2 D3 G3 B3 E4', () => {
  assert.deepEqual(names('guitar-dropd'), ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']);
});
test('DADGAD', () => {
  assert.deepEqual(names('guitar-dadgad'), ['D2', 'A2', 'D3', 'G3', 'A3', 'D4']);
});
test('降半音調弦使用降記號', () => {
  assert.deepEqual(names('guitar-halfdown'), ['E♭2', 'A♭2', 'D♭3', 'G♭3', 'B♭3', 'E♭4']);
});
test('烏克麗麗 GCEA（高音 G）', () => {
  assert.deepEqual(names('ukulele'), ['G4', 'C4', 'E4', 'A4']);
});
test('小提琴 GDAE', () => {
  assert.deepEqual(names('violin'), ['G3', 'D4', 'A4', 'E5']);
});
test('貝斯 EADG', () => {
  assert.deepEqual(names('bass'), ['E1', 'A1', 'D2', 'G2']);
});
test('唱名顯示', () => {
  assert.deepEqual(names('violin', 'solfege'), ['Sol3', 'Re4', 'La4', 'Mi5']);
});
test('半音階模式沒有弦，nearestString 回傳 null', () => {
  assert.equal(nearestString(440, instrumentById('chromatic')), null);
});
test('未知 id 退回半音階', () => {
  assert.equal(instrumentById('nope').id, 'chromatic');
});
test('每種樂器的 id 不重複', () => {
  assert.equal(new Set(INSTRUMENTS.map((i) => i.id)).size, INSTRUMENTS.length);
});

for (const inst of INSTRUMENTS.filter((i) => i.strings.length)) {
  inst.strings.forEach((midi, idx) => {
    test(`${inst.id}：第 ${idx + 1} 弦準確頻率 -> 該弦、0 音分`, () => {
      const r = nearestString(freqFromMidi(midi), inst);
      assert.equal(r.index, idx);
      assert.ok(Math.abs(r.cents) < 1e-6);
    });
    test(`${inst.id}：第 ${idx + 1} 弦偏低 20 音分仍判斷為該弦`, () => {
      const r = nearestString(freqFromMidi(midi) * 2 ** (-20 / 1200), inst);
      assert.equal(r.index, idx);
      assert.ok(Math.abs(r.cents + 20) < 1e-6);
    });
  });
}

test('吉他：接近 A2 但偏高 30 音分', () => {
  const r = nearestString(110 * 2 ** (30 / 1200), instrumentById('guitar-standard'));
  assert.equal(r.index, 1);
  assert.ok(Math.abs(r.cents - 30) < 1e-6);
});

test('兩弦中間（音分距離最近者勝）', () => {
  const inst = instrumentById('guitar-standard'); // A2=110, D3=146.83：約差 5 個半音
  const f = 110 * 2 ** (270 / 1200); // 離 A2 270，離 D3 230
  assert.equal(nearestString(f, inst).index, 2);
});

test('基準音改變時弦頻率跟著變', () => {
  const inst = instrumentById('guitar-standard');
  const f = stringFreqs(inst, 432)[1];
  assert.ok(Math.abs(f - 108) < 1e-9);
  const r = nearestString(108, inst, 432);
  assert.equal(r.index, 1);
  assert.ok(Math.abs(r.cents) < 1e-9);
  // 同樣 108 Hz 在 440 基準下是偏低約 31.8 音分
  assert.ok(nearestString(108, inst, 440).cents < -30);
});

test('偵測範圍涵蓋所有弦', () => {
  for (const inst of INSTRUMENTS) {
    const { minFreq, maxFreq } = detectRange(inst);
    for (const f of stringFreqs(inst)) assert.ok(f > minFreq && f < maxFreq, `${inst.id} ${f}`);
  }
});

test('貝斯偵測下限低於 E1', () => {
  assert.ok(detectRange(instrumentById('bass')).minFreq < 41.2);
});

test('無效頻率回傳 null', () => {
  assert.equal(nearestString(0, instrumentById('bass')), null);
  assert.equal(nearestString(NaN, instrumentById('bass')), null);
});
