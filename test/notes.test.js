import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noteFromFreq, noteName, formatNote, freqFromMidi, midiFromFreq, clampA4, tuningStatus,
  formatCents, centsBetween, A4_DEFAULT, IN_TUNE_CENTS,
} from '../src/notes.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('A4 = 440 Hz 轉成 A4、0 音分', () => {
  const n = noteFromFreq(440);
  assert.equal(n.midi, 69);
  assert.equal(n.octave, 4);
  assert.equal(noteName(n.pitchClass), 'A');
  close(n.cents, 0);
});

test('中央 C 約 261.63 Hz', () => {
  const n = noteFromFreq(261.6256);
  assert.equal(formatNote(n.midi), 'C4');
  assert.ok(Math.abs(n.cents) < 0.01);
});

const KNOWN = [
  [82.4069, 'E2'], [110, 'A2'], [146.8324, 'D3'], [195.9977, 'G3'], [246.9417, 'B3'],
  [329.6276, 'E4'], [523.2511, 'C5'], [2093.005, 'C7'], [27.5, 'A0'], [4186.009, 'C8'],
];
for (const [f, name] of KNOWN) {
  test(`${f} Hz = ${name}`, () => {
    assert.equal(formatNote(noteFromFreq(f).midi), name);
  });
}

test('音分偏差：高 10 音分', () => {
  close(noteFromFreq(440 * 2 ** (10 / 1200)).cents, 10, 1e-6);
});

test('音分偏差：低 25 音分', () => {
  close(noteFromFreq(440 * 2 ** (-25 / 1200)).cents, -25, 1e-6);
});

test('超過 +50 音分會歸給下一個半音', () => {
  const n = noteFromFreq(440 * 2 ** (60 / 1200));
  assert.equal(n.midi, 70);
  close(n.cents, -40, 1e-6);
});

test('音分永遠落在 -50 ~ 50', () => {
  for (let f = 50; f < 3000; f *= 1.0173) {
    const c = noteFromFreq(f).cents;
    assert.ok(c >= -50 && c <= 50, `${f}: ${c}`);
  }
});

test('基準音 A4=432：432 Hz 是 A4、0 音分', () => {
  const n = noteFromFreq(432, 432);
  assert.equal(formatNote(n.midi), 'A4');
  close(n.cents, 0);
});

test('基準音 A4=432：440 Hz 約高 31.8 音分', () => {
  const n = noteFromFreq(440, 432);
  assert.equal(formatNote(n.midi), 'A4');
  close(n.cents, 1200 * Math.log2(440 / 432), 1e-6);
  assert.ok(Math.abs(n.cents - 31.77) < 0.05);
});

test('基準音 A4=445 時 C4 頻率', () => {
  close(noteFromFreq(freqFromMidi(60, 445), 445).cents, 0, 1e-9);
  close(freqFromMidi(60, 445), 445 * 2 ** (-9 / 12));
});

for (const a4 of [430, 435, 440, 442, 445, 450]) {
  test(`A4=${a4}：freqFromMidi 與 noteFromFreq 互為反函數`, () => {
    for (let midi = 28; midi <= 100; midi++) {
      const n = noteFromFreq(freqFromMidi(midi, a4), a4);
      assert.equal(n.midi, midi);
      assert.ok(Math.abs(n.cents) < 1e-6);
    }
  });
}

test('midiFromFreq / freqFromMidi', () => {
  close(midiFromFreq(440), 69);
  close(freqFromMidi(69), 440);
  close(freqFromMidi(81), 880);
});

test('centsBetween：一個八度 = 1200 音分', () => {
  close(centsBetween(880, 440), 1200);
  close(centsBetween(220, 440), -1200);
});

test('無效頻率回傳 null', () => {
  for (const f of [0, -5, NaN, Infinity, undefined, null]) assert.equal(noteFromFreq(f), null);
});

test('字母音名 12 個', () => {
  const names = Array.from({ length: 12 }, (_, i) => noteName(i, 'letter'));
  assert.deepEqual(names, ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);
});

test('唱名 Do Re Mi', () => {
  const names = Array.from({ length: 12 }, (_, i) => noteName(i, 'solfege'));
  assert.deepEqual(names, ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si']);
});

test('降記號音名', () => {
  assert.equal(noteName(3, 'letter', true), 'E♭');
  assert.equal(noteName(8, 'solfege', true), 'La♭');
  assert.equal(noteName(0, 'letter', true), 'C');
});

test('formatNote：唱名含八度', () => {
  assert.equal(formatNote(69, 'solfege'), 'La4');
  assert.equal(formatNote(60, 'solfege'), 'Do4');
  assert.equal(formatNote(40, 'letter'), 'E2');
  assert.equal(formatNote(39, 'letter', true), 'E♭2');
});

test('未知風格退回字母', () => {
  assert.equal(noteName(9, 'whatever'), 'A');
});

test('pitchClass 對負數也正確', () => {
  assert.equal(noteName(-3, 'letter'), 'A');
});

test('clampA4 限制在 430–450', () => {
  assert.equal(clampA4(400), 430);
  assert.equal(clampA4(500), 450);
  assert.equal(clampA4('442'), 442);
  assert.equal(clampA4('abc'), A4_DEFAULT);
  assert.equal(clampA4(undefined), A4_DEFAULT);
});

test('tuningStatus：±5 以內為準', () => {
  assert.equal(IN_TUNE_CENTS, 5);
  assert.equal(tuningStatus(0), 'in-tune');
  assert.equal(tuningStatus(5), 'in-tune');
  assert.equal(tuningStatus(-5), 'in-tune');
  assert.equal(tuningStatus(5.01), 'high');
  assert.equal(tuningStatus(-5.01), 'low');
  assert.equal(tuningStatus(-40), 'low');
  assert.equal(tuningStatus(40), 'high');
});

test('formatCents', () => {
  assert.equal(formatCents(0), '0');
  assert.equal(formatCents(0.4), '0');
  assert.equal(formatCents(3.6), '+4');
  assert.equal(formatCents(-12.2), '−12');
});
