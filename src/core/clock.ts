// Spec §0: every time-dependent module receives a Clock via its constructor
// and never calls Date.now()/performance.now()/setTimeout directly, so tests
// can drive time deterministically with FakeClock. See plan §1.3 and §4.1.

declare const TimerBrand: unique symbol;
export type TimerId = number & { readonly [TimerBrand]: true };

export interface Clock {
  /** Epoch milliseconds (Date.now semantics) — the only time source for logic. */
  now(): number;
  setTimeout(cb: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
  setInterval(cb: () => void, ms: number): TimerId;
  clearInterval(id: TimerId): void;
}

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(cb: () => void, ms: number): TimerId {
    return globalThis.setTimeout(cb, ms) as unknown as TimerId;
  }

  clearTimeout(id: TimerId): void {
    globalThis.clearTimeout(id);
  }

  setInterval(cb: () => void, ms: number): TimerId {
    return globalThis.setInterval(cb, ms) as unknown as TimerId;
  }

  clearInterval(id: TimerId): void {
    globalThis.clearInterval(id);
  }
}

interface TimerEntry {
  readonly id: TimerId;
  due: number;
  seq: number;
  readonly cb: () => void;
  /** null = one-shot; otherwise the interval period in ms. */
  interval: number | null;
}

/** 2026-01-15T22:00:00+07:00 — a night-time start, deliberately. */
const DEFAULT_START_EPOCH_MS = 1_768_489_200_000;

/**
 * Deterministic clock for tests.
 * - Timers fire in order of (dueTime, creationSeq). Before each callback, now()
 *   equals max(current now(), that timer's dueTime) — i.e. time only ever moves
 *   forward, and an already-overdue timer (e.g. after jump()) fires with now()
 *   left at the jumped-to time rather than rewinding to its stale due time.
 * - Timers created during advance()/flush() that become due within the current
 *   call fire within that same call.
 * - setInterval reschedules relative to the time it just fired at (dueTime + ms
 *   during normal advance() progression), so cadence never drifts. An interval
 *   with ms <= 0 throws.
 * - clear* on an unknown or already-fired id is a no-op.
 */
export class FakeClock implements Clock {
  private currentTime: number;
  private readonly timers = new Map<TimerId, TimerEntry>();
  private nextId = 1;
  private seqCounter = 0;

  constructor(startEpochMs: number = DEFAULT_START_EPOCH_MS) {
    this.currentTime = startEpochMs;
  }

  now(): number {
    return this.currentTime;
  }

  setTimeout(cb: () => void, ms: number): TimerId {
    return this.schedule(cb, ms, null);
  }

  clearTimeout(id: TimerId): void {
    this.timers.delete(id);
  }

  setInterval(cb: () => void, ms: number): TimerId {
    if (ms <= 0) throw new Error('FakeClock.setInterval requires ms > 0');
    return this.schedule(cb, ms, ms);
  }

  clearInterval(id: TimerId): void {
    this.timers.delete(id);
  }

  /** Advance time by ms, firing due timers in order. */
  advance(ms: number): void {
    if (ms < 0) throw new Error('advance() requires a non-negative delta');
    this.runUntil(this.currentTime + ms);
  }

  /** Advance to an absolute epoch ms (must be >= now()). */
  advanceTo(epochMs: number): void {
    if (epochMs < this.currentTime) {
      throw new Error('advanceTo() cannot move time backwards');
    }
    this.runUntil(epochMs);
  }

  /**
   * Move time forward WITHOUT firing timers (simulates frozen JS while
   * backgrounded). Overdue timers fire on the next advance()/flush(), with
   * now() at the jumped-to time (as real browsers do).
   */
  jump(ms: number): void {
    if (ms < 0) throw new Error('jump() requires a non-negative delta');
    this.currentTime += ms;
  }

  /** Fire all timers that are already overdue, without moving time. */
  flush(): void {
    this.runUntil(this.currentTime);
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }

  private schedule(cb: () => void, ms: number, interval: number | null): TimerId {
    const id = this.nextId++ as TimerId;
    this.timers.set(id, {
      id,
      due: this.currentTime + ms,
      seq: this.seqCounter++,
      cb,
      interval,
    });
    return id;
  }

  private nextDueEntry(limit: number): TimerEntry | null {
    let best: TimerEntry | null = null;
    for (const entry of this.timers.values()) {
      if (entry.due > limit) continue;
      if (
        best === null ||
        entry.due < best.due ||
        (entry.due === best.due && entry.seq < best.seq)
      ) {
        best = entry;
      }
    }
    return best;
  }

  private runUntil(limit: number): void {
    for (;;) {
      const entry = this.nextDueEntry(limit);
      if (!entry) break;
      this.currentTime = Math.max(this.currentTime, entry.due);
      if (entry.interval === null) {
        this.timers.delete(entry.id);
      } else {
        entry.due = this.currentTime + entry.interval;
        entry.seq = this.seqCounter++;
      }
      entry.cb();
    }
    if (this.currentTime < limit) this.currentTime = limit;
  }
}
