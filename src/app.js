// 介面：把偵測結果顯示成音名、音分指針與軌跡，並處理設定、參考音與節拍器。
import { MicSession, micSupported, listInputs } from './audio-input.js';
import { PitchSmoother } from './pitch.js';
import {
  noteFromFreq, noteName, formatNote, midiFromFreq, freqFromMidi, clampA4, tuningStatus,
  formatCents, A4_DEFAULT,
} from './notes.js';
import { INSTRUMENTS, instrumentById, nearestString, detectRange } from './instruments.js';
import { TraceBuffer } from './trace.js';
import { describeMicError, isMicContextAllowed, unsupported } from './mic-errors.js';
import { Metronome, clampBpm } from './metronome.js';
import { playReference, stopReference, getPlaybackContext, scheduleClick } from './synth.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'pitch-tuner:v1';

const state = {
  a4: A4_DEFAULT, style: 'letter', instrument: 'chromatic', algorithm: 'yin',
  bpm: 100, beats: 4, accent: true, deviceId: '',
};
try {
  Object.assign(state, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
} catch { /* 沒有儲存空間也能用 */ }
state.a4 = clampA4(state.a4);
state.bpm = clampBpm(state.bpm);
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* 忽略 */ }
}

const urlMode = new URLSearchParams(location.search).get('mode');
const smoother = new PitchSmoother({ size: 5, holdFrames: 8 });
const trace = new TraceBuffer(10);
let session = null;
let running = false;
let muteUntil = 0;
let activeString = -1;
let targetMidi = null;
let lastInTune = false;

/* ---------- 初始化控制項 ---------- */
INSTRUMENTS.forEach((inst) => {
  const o = document.createElement('option');
  o.value = inst.id; o.textContent = inst.label;
  $('instrument').append(o);
});
$('instrument').value = state.instrument;
$('algorithm').value = state.algorithm;
$('style').value = state.style;
$('a4').value = state.a4;
$('bpm').value = state.bpm;
$('bpm-range').value = state.bpm;
$('beats').value = String(state.beats);
$('accent').checked = state.accent;

const inst = () => instrumentById(state.instrument);

/* ---------- 音分指針刻度 ---------- */
const X = (cents) => 120 + cents * 2;
(function buildTicks() {
  const NS = 'http://www.w3.org/2000/svg';
  const g = $('ticks');
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('class', major ? 'tick major' : 'tick');
    line.setAttribute('x1', X(c)); line.setAttribute('x2', X(c));
    line.setAttribute('y1', major ? 44 : 50); line.setAttribute('y2', 58);
    g.append(line);
    if (major) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', X(c)); t.setAttribute('y', 76);
      t.textContent = c === 0 ? '0' : (c > 0 ? '+' : '−') + Math.abs(c);
      g.append(t);
    }
  }
})();

function setNeedle(cents) {
  const c = Math.max(-55, Math.min(55, cents));
  $('needle').style.transform = `translateX(${X(c)}px)`;
}

/* ---------- 讀數更新 ---------- */
function showIdle(text = '請對著麥克風發出聲音') {
  $('tuner').dataset.state = 'idle';
  $('note-name').textContent = '–';
  $('note-octave').textContent = '';
  $('freq-value').textContent = '–';
  $('cents-value').textContent = '–';
  $('status').textContent = running ? text : '按「開始調音」後就能看到讀數';
  setNeedle(0);
  activeString = -1;
  targetMidi = null;
  markStrings();
  $('target').hidden = true;
  lastInTune = false;
}

function showPitch(freq) {
  const i = inst();
  const flats = !!i.flats;
  let label, cents, octave, target;
  if (i.strings.length) {
    const s = nearestString(freq, i, state.a4);
    label = noteName(s.midi, state.style, flats);
    octave = Math.floor(s.midi / 12) - 1;
    cents = s.cents;
    target = s.freq;
    activeString = s.index;
    targetMidi = s.midi;
  } else {
    const n = noteFromFreq(freq, state.a4);
    label = noteName(n.pitchClass, state.style, flats);
    octave = n.octave;
    cents = n.cents;
    target = n.targetFreq;
    activeString = -1;
    targetMidi = n.midi;
  }
  const status = tuningStatus(cents);
  $('tuner').dataset.state = status;
  $('note-name').textContent = label;
  $('note-octave').textContent = octave;
  $('freq-value').textContent = freq.toFixed(1);
  $('cents-value').textContent = formatCents(cents);
  $('status').textContent = status === 'in-tune' ? '準' : status === 'low' ? '偏低，請調高一點' : '偏高，請調低一點';
  setNeedle(cents);
  const tname = formatNote(targetMidi, state.style, flats);
  $('target').hidden = false;
  $('target').textContent = i.strings.length
    ? `最接近第 ${activeString + 1} 弦　目標 ${tname}　${target.toFixed(1)} Hz`
    : `最接近 ${tname}　${target.toFixed(1)} Hz`;
  markStrings();
  const inTune = status === 'in-tune';
  if (inTune && !lastInTune) $('announce').textContent = `${tname} 準了`;
  lastInTune = inTune;
}

function onResult(r) {
  const now = performance.now();
  if (now < muteUntil) return; // 播放參考音時不要偵測到自己的聲音
  const f = smoother.push(r.freq);
  if (f) {
    showPitch(f);
    trace.add(now / 1000, midiFromFreq(f, state.a4));
  } else {
    showIdle();
    trace.add(now / 1000, null);
  }
}

/* ---------- 弦按鈕 ---------- */
function buildStrings() {
  const i = inst();
  $('strings-panel').hidden = !i.strings.length;
  const box = $('strings');
  box.textContent = '';
  i.strings.forEach((midi, idx) => {
    const name = formatNote(midi, state.style, !!i.flats);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'string-btn';
    b.dataset.index = idx;
    b.setAttribute('aria-label', `播放第 ${idx + 1} 弦 ${name} 的參考音`);
    b.innerHTML = `<b></b><small></small>`;
    b.querySelector('b').textContent = name;
    b.querySelector('small').textContent = `${freqFromMidi(midi, state.a4).toFixed(1)} Hz`;
    b.addEventListener('click', () => {
      const f = freqFromMidi(midi, state.a4);
      const dur = playReference(f, 2);
      muteUntil = performance.now() + dur * 1000 + 250;
      smoother.reset();
      showIdle(`播放參考音 ${name}`);
      $('status').textContent = `播放參考音 ${name}（${f.toFixed(1)} Hz）`;
    });
    box.append(b);
  });
  markStrings();
}
function markStrings() {
  document.querySelectorAll('.string-btn').forEach((b) => {
    if (Number(b.dataset.index) === activeString) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
}

/* ---------- 麥克風 ---------- */
function applyDetectorConfig() {
  const range = detectRange(inst(), state.a4);
  if (session) session.configure({ algorithm: state.algorithm, ...range });
}

function showError(info) {
  $('mic-error-title').textContent = info.title;
  const ul = $('mic-error-steps');
  ul.textContent = '';
  info.steps.forEach((s) => { const li = document.createElement('li'); li.textContent = s; ul.append(li); });
  $('mic-error').hidden = false;
}

async function refreshDevices() {
  const list = await listInputs().catch(() => []);
  const sel = $('device');
  sel.textContent = '';
  list.forEach((d) => {
    const o = document.createElement('option');
    o.value = d.id; o.textContent = d.label; sel.append(o);
  });
  if (state.deviceId && list.some((d) => d.id === state.deviceId)) sel.value = state.deviceId;
  $('device-field').hidden = list.length < 2;
}

async function startMic(deviceId) {
  $('mic-error').hidden = true;
  if (!micSupported()) { showError(unsupported()); return; }
  $('mic-toggle').disabled = true;
  try {
    session = session || new MicSession(onResult, { mode: urlMode });
    applyDetectorConfig();
    const mode = await session.start(deviceId || undefined);
    running = true;
    $('mic-toggle').textContent = '停止';
    $('mic-intro').hidden = true;
    $('mode').textContent = { worklet: 'AudioWorklet', script: 'ScriptProcessor（備援）', analyser: 'AnalyserNode 輪詢（備援）' }[mode];
    smoother.reset();
    showIdle();
    await refreshDevices();
  } catch (err) {
    running = false;
    showError(describeMicError(err, { secure: isMicContextAllowed(location, window.isSecureContext) }));
  } finally {
    $('mic-toggle').disabled = false;
  }
}

async function stopMic() {
  running = false;
  if (session) await session.stop();
  $('mic-toggle').textContent = '開始調音';
  $('mode').textContent = '尚未啟動';
  smoother.reset();
  showIdle();
}

$('mic-toggle').addEventListener('click', () => (running ? stopMic() : startMic(state.deviceId)));
$('device').addEventListener('change', () => {
  state.deviceId = $('device').value;
  save();
  if (running) startMic(state.deviceId);
});

/* ---------- 設定 ---------- */
$('instrument').addEventListener('change', () => {
  state.instrument = $('instrument').value; save();
  buildStrings(); applyDetectorConfig(); smoother.reset(); trace.clear(); showIdle();
});
$('algorithm').addEventListener('change', () => { state.algorithm = $('algorithm').value; save(); applyDetectorConfig(); });
$('style').addEventListener('change', () => { state.style = $('style').value; save(); buildStrings(); });

function setA4(v) {
  state.a4 = clampA4(v);
  $('a4').value = state.a4;
  save(); buildStrings(); applyDetectorConfig(); trace.clear();
}
$('a4').addEventListener('change', () => setA4($('a4').value));
$('a4-down').addEventListener('click', () => setA4(state.a4 - 1));
$('a4-up').addEventListener('click', () => setA4(state.a4 + 1));

/* ---------- 節拍器 ---------- */
const beatQueue = [];
let metCtx = null;
const metronome = new Metronome({
  now: () => (metCtx ? metCtx.currentTime : 0),
  bpm: state.bpm, beatsPerBar: state.beats, accent: state.accent,
  onBeat: (beat) => {
    scheduleClick(metCtx, beat.time, beat.accent);
    beatQueue.push(beat);
  },
});

function buildDots() {
  const box = $('dots');
  box.textContent = '';
  for (let i = 0; i < state.beats; i++) {
    const d = document.createElement('span');
    d.className = 'dot' + (i === 0 ? ' first' : '');
    box.append(d);
  }
}
function setBpm(v) {
  state.bpm = clampBpm(v);
  $('bpm').value = state.bpm; $('bpm-range').value = state.bpm;
  metronome.setBpm(state.bpm); save();
}
$('bpm').addEventListener('change', () => setBpm($('bpm').value));
$('bpm-range').addEventListener('input', () => setBpm($('bpm-range').value));
$('bpm-down').addEventListener('click', () => setBpm(state.bpm - 1));
$('bpm-up').addEventListener('click', () => setBpm(state.bpm + 1));
$('beats').addEventListener('change', () => {
  state.beats = Number($('beats').value); metronome.setBeatsPerBar(state.beats); buildDots(); save();
});
$('accent').addEventListener('change', () => {
  state.accent = $('accent').checked; metronome.setAccent(state.accent); save();
});
$('met-toggle').addEventListener('click', () => {
  if (metronome.running) {
    metronome.stop();
    beatQueue.length = 0;
    document.querySelectorAll('.dot').forEach((d) => d.classList.remove('on'));
    $('met-toggle').textContent = '開始節拍器';
  } else {
    metCtx = getPlaybackContext();
    if (!metCtx) return;
    metronome.start();
    $('met-toggle').textContent = '停止節拍器';
  }
});

/* ---------- 音高軌跡與動畫迴圈 ---------- */
const canvas = $('trace');
let colors = null;
const readColors = () => {
  const cs = getComputedStyle(document.documentElement);
  colors = ['--ink', '--muted', '--line', '--accent', '--ok', '--card'].reduce((o, k) => {
    o[k] = cs.getPropertyValue(k).trim(); return o;
  }, {});
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

function drawTrace() {
  if (!colors) readColors();
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = `12px ${getComputedStyle(document.body).fontFamily}`;
  const now = performance.now() / 1000;
  trace.prune(now);
  const range = trace.range(2);
  if (!range) {
    g.fillStyle = colors['--muted'];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(running ? '等待聲音…' : '開始調音後，這裡會畫出音高的變化', w / 2, h / 2);
    return;
  }
  let { lo, hi } = range;
  if (targetMidi != null) { lo = Math.min(lo, targetMidi - 0.3); hi = Math.max(hi, targetMidi + 0.3); }
  const left = 44, top = 8, bottom = h - 8;
  const y = (m) => bottom - ((m - lo) / (hi - lo)) * (bottom - top);
  const x = (t) => left + ((t - (now - 10)) / 10) * (w - left - 4);
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
    const isTarget = m === targetMidi;
    g.strokeStyle = isTarget ? colors['--ok'] : colors['--line'];
    g.lineWidth = isTarget ? 2 : 1;
    g.beginPath(); g.moveTo(left, y(m)); g.lineTo(w - 4, y(m)); g.stroke();
    g.fillStyle = isTarget ? colors['--ok'] : colors['--muted'];
    g.fillText(formatNote(m, state.style, !!inst().flats), left - 6, y(m));
  }
  g.strokeStyle = colors['--accent']; g.lineWidth = 2.5; g.lineJoin = 'round';
  let prev = null;
  g.beginPath();
  for (const p of trace.points) {
    if (p.m == null) { prev = null; continue; }
    if (prev && p.t - prev.t < 0.3) g.lineTo(x(p.t), y(p.m));
    else g.moveTo(x(p.t), y(p.m));
    prev = p;
  }
  g.stroke();
}

function frame() {
  if (metronome.running && metCtx) {
    const now = metCtx.currentTime;
    while (beatQueue.length && beatQueue[0].time <= now) {
      const b = beatQueue.shift();
      const dots = document.querySelectorAll('.dot');
      dots.forEach((d, i) => d.classList.toggle('on', i === b.index));
    }
  }
  drawTrace();
  requestAnimationFrame(frame);
}

/* ---------- 啟動 ---------- */
buildStrings();
buildDots();
showIdle();
if (!isMicContextAllowed(location, window.isSecureContext)) {
  showError(describeMicError(null, { secure: false }));
  $('mic-toggle').disabled = true;
}
requestAnimationFrame(frame);

// 給自動化測試讀取的狀態（不含任何個資）
window.__tuner = { state, get running() { return running; }, get mode() { return session && session.mode; } };
