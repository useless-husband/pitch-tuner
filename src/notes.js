// 頻率 <-> 音名 / 音分 轉換

export const A4_MIN = 430;
export const A4_MAX = 450;
export const A4_DEFAULT = 440;
export const IN_TUNE_CENTS = 5;

const NAMES = {
  letter: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  letterFlat: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'],
  solfege: ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'],
  solfegeFlat: ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'],
};

export function clampA4(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return A4_DEFAULT;
  return Math.min(A4_MAX, Math.max(A4_MIN, n));
}

export function midiFromFreq(freq, a4 = A4_DEFAULT) {
  return 69 + 12 * Math.log2(freq / a4);
}

export function freqFromMidi(midi, a4 = A4_DEFAULT) {
  return a4 * 2 ** ((midi - 69) / 12);
}

export function centsBetween(freq, target) {
  return 1200 * Math.log2(freq / target);
}

/** 最接近的半音；cents 介於 -50 ~ +50 */
export function noteFromFreq(freq, a4 = A4_DEFAULT) {
  if (!(freq > 0) || !Number.isFinite(freq)) return null;
  const exact = midiFromFreq(freq, a4);
  const midi = Math.round(exact);
  return {
    midi,
    pitchClass: ((midi % 12) + 12) % 12,
    octave: Math.floor(midi / 12) - 1,
    cents: (exact - midi) * 100,
    targetFreq: freqFromMidi(midi, a4),
  };
}

/** style: 'letter' (C D E) 或 'solfege' (Do Re Mi) */
export function noteName(pitchClass, style = 'letter', flats = false) {
  const key = (style === 'solfege' ? 'solfege' : 'letter') + (flats ? 'Flat' : '');
  return NAMES[key][((pitchClass % 12) + 12) % 12];
}

export function formatNote(midi, style = 'letter', flats = false) {
  return noteName(midi, style, flats) + (Math.floor(midi / 12) - 1);
}

/** 'in-tune' | 'low' | 'high' */
export function tuningStatus(cents) {
  if (Math.abs(cents) <= IN_TUNE_CENTS) return 'in-tune';
  return cents < 0 ? 'low' : 'high';
}

export function formatCents(cents) {
  const r = Math.round(cents);
  if (r === 0) return '0';
  return (r > 0 ? '+' : '−') + Math.abs(r);
}
