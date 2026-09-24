import { describe, expect, it, vi } from 'vitest';

import { FakeClock, RealClock } from '@/core/clock';

describe('RealClock', () => {
  it('now() returns the current epoch ms', () => {
    const clock = new RealClock();
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  it('delegates timers to the global timer functions', () => {
    vi.useFakeTimers();
    try {
      const clock = new RealClock();
      const timeoutFn = vi.fn();
      const id = clock.setTimeout(timeoutFn, 10);
      vi.advanceTimersByTime(10);
      expect(timeoutFn).toHaveBeenCalledTimes(1);
      clock.clearTimeout(id);

      const intervalFn = vi.fn();
      const intervalId = clock.setInterval(intervalFn, 10);
      vi.advanceTimersByTime(30);
      expect(intervalFn).toHaveBeenCalledTimes(3);
      clock.clearInterval(intervalId);
      vi.advanceTimersByTime(100);
      expect(intervalFn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FakeClock', () => {
  it('fires timers with the same due time in creation order', () => {
    const clock = new FakeClock(0);
    const order: string[] = [];
    clock.setTimeout(() => order.push('a'), 100);
    clock.setTimeout(() => order.push('b'), 100);
    clock.setTimeout(() => order.push('c'), 100);
    clock.advance(100);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it("now() inside a callback equals that timer's due time", () => {
    const clock = new FakeClock(1000);
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 50);
    clock.setTimeout(() => seen.push(clock.now()), 200);
    clock.advance(200);
    expect(seen).toEqual([1050, 1200]);
  });

  it('fires timers scheduled inside callbacks within the same advance window', () => {
    const clock = new FakeClock(0);
    const order: number[] = [];
    clock.setTimeout(() => {
      order.push(clock.now());
      clock.setTimeout(() => order.push(clock.now()), 10);
    }, 50);
    clock.advance(100);
    expect(order).toEqual([50, 60]);
  });

  it('does not fire a timer scheduled inside a callback if it falls outside the window', () => {
    const clock = new FakeClock(0);
    const order: number[] = [];
    clock.setTimeout(() => {
      order.push(clock.now());
      clock.setTimeout(() => order.push(clock.now()), 1000);
    }, 50);
    clock.advance(100);
    expect(order).toEqual([50]);
    expect(clock.pendingTimerCount()).toBe(1);
  });

  it('reschedules an interval with no drift over 1000 iterations', () => {
    const clock = new FakeClock(0);
    const fireTimes: number[] = [];
    clock.setInterval(() => fireTimes.push(clock.now()), 10);
    clock.advance(10_000);
    expect(fireTimes).toHaveLength(1000);
    for (let i = 0; i < 1000; i++) {
      expect(fireTimes[i]).toBe((i + 1) * 10);
    }
  });

  it('throws for a non-positive interval', () => {
    const clock = new FakeClock(0);
    expect(() => clock.setInterval(() => undefined, 0)).toThrow();
    expect(() => clock.setInterval(() => undefined, -5)).toThrow();
  });

  it('lets a callback clear itself, including an interval clearing itself', () => {
    const clock = new FakeClock(0);
    let timeoutCalls = 0;
    const timeoutId = clock.setTimeout(() => {
      timeoutCalls++;
      clock.clearTimeout(timeoutId);
    }, 10);

    let intervalCalls = 0;
    const intervalId = clock.setInterval(() => {
      intervalCalls++;
      if (intervalCalls === 3) clock.clearInterval(intervalId);
    }, 10);

    clock.advance(1000);
    expect(timeoutCalls).toBe(1);
    expect(intervalCalls).toBe(3);
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it('lets one callback clear a different pending timer', () => {
    const clock = new FakeClock(0);
    let bCalls = 0;
    const bId = clock.setTimeout(() => bCalls++, 20);
    clock.setTimeout(() => {
      clock.clearTimeout(bId);
    }, 10);
    clock.advance(30);
    expect(bCalls).toBe(0);
  });

  it('treats clearing an unknown or already-fired id as a no-op', () => {
    const clock = new FakeClock(0);
    expect(() => {
      clock.clearTimeout(999 as never);
    }).not.toThrow();
    const id = clock.setTimeout(() => undefined, 10);
    clock.advance(10);
    expect(() => {
      clock.clearTimeout(id);
    }).not.toThrow();
  });

  it('jump() then flush() fires overdue timers with now() at the jumped time', () => {
    const clock = new FakeClock(0);
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 100);
    clock.jump(5000);
    expect(seen).toEqual([]);
    expect(clock.now()).toBe(5000);
    clock.flush();
    expect(seen).toEqual([5000]);
    expect(clock.now()).toBe(5000);
  });

  it('jump() does not fire timers still in the future', () => {
    const clock = new FakeClock(0);
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 5000);
    clock.jump(100);
    clock.flush();
    expect(seen).toEqual([]);
    expect(clock.pendingTimerCount()).toBe(1);
  });

  it('reschedules an overdue interval relative to the jumped-to time, not its stale due time', () => {
    const clock = new FakeClock(0);
    const seen: number[] = [];
    clock.setInterval(() => seen.push(clock.now()), 100);
    clock.jump(1000);
    clock.flush();
    // Fires once (browsers coalesce missed ticks), not ten times.
    expect(seen).toEqual([1000]);
    clock.advance(100);
    expect(seen).toEqual([1000, 1100]);
  });

  it('advanceTo() with a past time throws', () => {
    const clock = new FakeClock(1000);
    expect(() => {
      clock.advanceTo(999);
    }).toThrow();
  });

  it('advanceTo() moves to an absolute time and fires due timers', () => {
    const clock = new FakeClock(1000);
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 500);
    clock.advanceTo(1500);
    expect(seen).toEqual([1500]);
    expect(clock.now()).toBe(1500);
  });
});
