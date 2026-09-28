// WebAudio 合成：參考音與節拍器點擊聲。所有聲音都有淡入淡出，避免爆音。

/** 包絡線關鍵點：[時間, 增益]，淡入 -> 短衰減 -> 持續 -> 淡出 */
export function envelopePoints(duration, peak = 0.3, attack = 0.03, release = 0.25) {
  const rel = Math.min(release, duration * 0.5);
  return [
    [0, 0],
    [attack, peak],
    [Math.max(attack, duration - rel), peak * 0.7],
    [duration, 0],
  ];
}

const AudioCtor = () => (typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null);

let shared = null;
/** 在使用者手勢中呼叫，取得（或建立）播放用的 AudioContext */
export function getPlaybackContext() {
  const AC = AudioCtor();
  if (!AC) return null;
  if (!shared) shared = new AC();
  if (shared.state === 'suspended') shared.resume();
  return shared;
}

let current = null;

export function stopReference() {
  if (!current) return;
  const { gain, oscs, ctx } = current;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + 0.05);
  oscs.forEach((o) => o.stop(t + 0.06));
  current = null;
}

/** 播放參考音（基頻 + 兩個泛音，像撥弦的音色），回傳持續秒數 */
export function playReference(freq, duration = 2) {
  const ctx = getPlaybackContext();
  if (!ctx) return 0;
  stopReference();
  const t0 = ctx.currentTime + 0.02;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const points = envelopePoints(duration);
  gain.gain.setValueAtTime(0, t0);
  for (const [t, g] of points.slice(1)) gain.gain.linearRampToValueAtTime(g, t0 + t);
  const oscs = [[1, 1], [2, 0.3], [3, 0.12]].map(([mult, level]) => {
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * mult;
    og.gain.value = level;
    o.connect(og).connect(gain);
    o.start(t0);
    o.stop(t0 + duration + 0.05);
    return o;
  });
  current = { gain, oscs, ctx };
  oscs[0].onended = () => { if (current && current.oscs === oscs) current = null; };
  return duration;
}

/** 在音訊時間 time 排定一聲節拍點擊 */
export function scheduleClick(ctx, time, accent) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = accent ? 1568 : 1046;
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(accent ? 0.7 : 0.45, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  g.gain.linearRampToValueAtTime(0, time + 0.07);
  o.connect(g).connect(ctx.destination);
  o.start(time);
  o.stop(time + 0.08);
}
