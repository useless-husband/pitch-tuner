// 最近 N 秒的音高軌跡（以 MIDI 小數表示，null 代表無聲）

export class TraceBuffer {
  constructor(windowSec = 10) {
    this.windowSec = windowSec;
    this.points = [];
  }

  add(t, midi) {
    this.points.push({ t, m: midi == null ? null : midi });
    this.prune(t);
  }

  prune(now) {
    const cutoff = now - this.windowSec;
    let i = 0;
    while (i < this.points.length && this.points[i].t < cutoff) i++;
    if (i) this.points.splice(0, i);
  }

  clear() {
    this.points = [];
  }

  /** 目前視窗內有值的點所需的顯示範圍（至少 minSpan 個半音），沒有資料回傳 null */
  range(minSpan = 2) {
    const vals = this.points.filter((p) => p.m != null).map((p) => p.m);
    if (!vals.length) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const mid = (lo + hi) / 2;
    const span = Math.max(minSpan, hi - lo + 1);
    return { lo: mid - span / 2, hi: mid + span / 2 };
  }
}
