// 樂器與調弦：以 MIDI 音高表示每一條弦（由低音弦到高音弦，烏克麗麗依實際彈奏順序）。
// 顯示弦號時依慣例：最後一個（最高音）是第 1 弦，所以弦號 = strings.length - index。

import { freqFromMidi, centsBetween } from './notes.js';

export const INSTRUMENTS = [
  { id: 'chromatic', label: '半音階（任意音）', strings: [] },
  { id: 'guitar-standard', label: '吉他 標準 EADGBE', strings: [40, 45, 50, 55, 59, 64] },
  { id: 'guitar-dropd', label: '吉他 Drop D', strings: [38, 45, 50, 55, 59, 64] },
  { id: 'guitar-dadgad', label: '吉他 DADGAD', strings: [38, 45, 50, 55, 57, 62] },
  { id: 'guitar-halfdown', label: '吉他 降半音', strings: [39, 44, 49, 54, 58, 63], flats: true },
  { id: 'ukulele', label: '烏克麗麗 GCEA', strings: [67, 60, 64, 69] },
  { id: 'violin', label: '小提琴 GDAE', strings: [55, 62, 69, 76] },
  { id: 'bass', label: '貝斯 EADG', strings: [28, 33, 38, 43] },
];

export function instrumentById(id) {
  return INSTRUMENTS.find((i) => i.id === id) || INSTRUMENTS[0];
}

export function stringFreqs(inst, a4 = 440) {
  return inst.strings.map((m) => freqFromMidi(m, a4));
}

/** 依樂器決定偵測的頻率範圍（半音階用寬範圍） */
export function detectRange(inst, a4 = 440) {
  if (!inst.strings.length) return { minFreq: 50, maxFreq: 2200 };
  const freqs = stringFreqs(inst, a4);
  return {
    minFreq: Math.min(...freqs) * 0.75,
    maxFreq: Math.max(...freqs) * 2.2,
  };
}

/**
 * 找最接近的弦（以音分距離比較）。
 * @returns {{index:number, midi:number, freq:number, cents:number}|null} cents = 偵測音相對該弦目標的偏差
 */
export function nearestString(freq, inst, a4 = 440) {
  if (!(freq > 0) || !inst.strings.length) return null;
  let best = null;
  inst.strings.forEach((midi, index) => {
    const target = freqFromMidi(midi, a4);
    const cents = centsBetween(freq, target);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { index, midi, freq: target, cents };
  });
  return best;
}
