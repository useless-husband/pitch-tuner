// 節拍器排程：用「音訊時鐘 + lookahead」排程，計時器只負責定期喚醒，
// 每一拍的實際時間由音訊時間算出，不會因為計時器抖動而漂移。

export const BPM_MIN = 30;
export const BPM_MAX = 240;

export function clampBpm(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 120;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, n));
}

export class Metronome {
  /**
   * @param {object} o
   * @param {() => number} o.now 目前音訊時間（秒）
   * @param {(beat:{index:number, time:number, accent:boolean}) => void} o.onBeat 排定一拍（time 為音訊時間）
   * @param {number} [o.lookahead] 提前排程的秒數
   * @param {number} [o.interval] 喚醒排程器的間隔（秒）
   * @param {{set:Function, clear:Function}} [o.timer] 可注入的計時器（測試用）
   */
  constructor({ now, onBeat, bpm = 120, beatsPerBar = 4, accent = true,
    lookahead = 0.15, interval = 0.025, startDelay = 0.05, timer } = {}) {
    this.now = now;
    this.onBeat = onBeat || (() => {});
    this.bpm = clampBpm(bpm);
    this.beatsPerBar = Math.min(12, Math.max(1, Math.round(beatsPerBar)));
    this.accent = accent;
    this.lookahead = lookahead;
    this.interval = interval;
    this.startDelay = startDelay;
    this.timer = timer || {
      set: (fn, sec) => setTimeout(fn, sec * 1000),
      clear: (id) => clearTimeout(id),
    };
    this.running = false;
    this.nextTime = 0;
    this.lastTime = 0;
    this.beatIndex = 0;
    this.handle = null;
  }

  get beatDuration() {
    return 60 / this.bpm;
  }

  setBpm(v) {
    this.bpm = clampBpm(v);
    if (this.running) {
      // 下一拍從上一拍起算新的間隔，但不能落在過去
      this.nextTime = Math.max(this.lastTime + this.beatDuration, this.now());
    }
  }

  setBeatsPerBar(n) {
    this.beatsPerBar = Math.min(12, Math.max(1, Math.round(n)));
    if (this.beatIndex >= this.beatsPerBar) this.beatIndex = 0;
  }

  setAccent(on) {
    this.accent = !!on;
  }

  /** 排定所有落在 [now, now + lookahead) 內的拍子，回傳這次排定的拍子 */
  tick() {
    const scheduled = [];
    if (!this.running) return scheduled;
    const horizon = this.now() + this.lookahead;
    while (this.nextTime < horizon) {
      const beat = {
        index: this.beatIndex,
        time: this.nextTime,
        accent: this.accent && this.beatIndex === 0,
      };
      scheduled.push(beat);
      this.onBeat(beat);
      this.lastTime = this.nextTime;
      this.nextTime += this.beatDuration;
      this.beatIndex = (this.beatIndex + 1) % this.beatsPerBar;
    }
    return scheduled;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.beatIndex = 0;
    this.nextTime = this.now() + this.startDelay;
    this.lastTime = this.nextTime - this.beatDuration;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.handle = this.timer.set(loop, this.interval);
    };
    loop();
  }

  stop() {
    this.running = false;
    if (this.handle != null) this.timer.clear(this.handle);
    this.handle = null;
  }
}
