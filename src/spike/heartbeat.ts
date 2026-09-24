// Writes Date.now() to localStorage every 5s while the page is running.
// If a device freezes JS while backgrounded, the gap between beats shows it
// (spec §5.C.4) — that's the whole point of this module, so it deliberately
// uses raw timers/Date.now instead of Clock (allowed in src/spike/**).

const STORAGE_KEY = 'spike.hb';
const MAX_BEATS = 1000;
const INTERVAL_MS = 5000;

function load(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

function save(beats: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(beats));
  } catch {
    // ignore
  }
}

export class Heartbeat {
  private beats: number[] = load();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer !== null) return;
    this.beat();
    this.timer = setInterval(() => {
      this.beat();
    }, INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private beat(): void {
    this.beats.push(Date.now());
    if (this.beats.length > MAX_BEATS) {
      this.beats.splice(0, this.beats.length - MAX_BEATS);
    }
    save(this.beats);
  }

  /** Largest gap (ms) between consecutive beats at or after `sinceMs`. Beats keep running while foregrounded too. */
  maxGapSince(sinceMs: number): number {
    const relevant = this.beats.filter((b) => b >= sinceMs);
    let maxGap = 0;
    for (let i = 1; i < relevant.length; i++) {
      const current = relevant[i];
      const previous = relevant[i - 1];
      if (current === undefined || previous === undefined) continue;
      maxGap = Math.max(maxGap, current - previous);
    }
    return maxGap;
  }
}
