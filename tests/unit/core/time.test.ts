import { describe, expect, it } from 'vitest';

import { clamp, easeInOut, easeOut, lerp, localDateKey, localHour, minutes } from '@/core/time';

describe('localHour', () => {
  it('reads the local hour under TZ=Asia/Bangkok', () => {
    // 2026-01-15T22:00:00+07:00
    expect(localHour(1_768_489_200_000)).toBe(22);
    // 2026-01-16T05:00:00+07:00
    expect(localHour(1_768_489_200_000 + 7 * 60 * 60_000)).toBe(5);
    // 2026-01-16T00:00:00+07:00 (midnight)
    expect(localHour(1_768_489_200_000 + 2 * 60 * 60_000)).toBe(0);
  });
});

describe('localDateKey', () => {
  it('formats as YYYY-MM-DD in local time', () => {
    expect(localDateKey(1_768_489_200_000)).toBe('2026-01-15');
  });
});

describe('minutes', () => {
  it('converts ms to minutes', () => {
    expect(minutes(60_000)).toBe(1);
    expect(minutes(90_000)).toBe(1.5);
  });
});

describe('clamp', () => {
  it('clamps into [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('easeInOut', () => {
  it('starts at 0, ends at 1, and is monotonic', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBeCloseTo(1, 10);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('easeOut', () => {
  it('starts at 0, ends at 1, and is monotonic', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBeCloseTo(1, 10);
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = easeOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
