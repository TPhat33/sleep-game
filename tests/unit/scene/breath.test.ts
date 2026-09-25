import { describe, expect, it } from 'vitest';

import { breathBrightness, isExhaleWindow } from '@/scene/model/breath';

const PERIOD = 10_000;
const TOLERANCE = 600;

describe('breathBrightness', () => {
  it('is 0 at the start of a cycle, peaks at the midpoint, and rises through the first half (inhale)', () => {
    expect(breathBrightness(0, PERIOD)).toBeCloseTo(0, 6);
    expect(breathBrightness(PERIOD * 0.5, PERIOD)).toBeCloseTo(1, 6);
    const early = breathBrightness(PERIOD * 0.1, PERIOD);
    const later = breathBrightness(PERIOD * 0.2, PERIOD);
    expect(later).toBeGreaterThan(early);
  });

  it('falls through the second half (exhale) back to 0', () => {
    const early = breathBrightness(PERIOD * 0.6, PERIOD);
    const later = breathBrightness(PERIOD * 0.9, PERIOD);
    expect(later).toBeLessThan(early);
    expect(breathBrightness(PERIOD - 1e-6, PERIOD)).toBeCloseTo(0, 3);
  });

  it('wraps correctly for elapsed times beyond one period', () => {
    expect(breathBrightness(PERIOD * 2.5, PERIOD)).toBeCloseTo(1, 6);
  });

  it('handles negative elapsed time (e.g. a tap slightly before the anchor) via wraparound', () => {
    const b = breathBrightness(-100, PERIOD);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});

describe('isExhaleWindow', () => {
  it('is false in the middle of inhale', () => {
    expect(isExhaleWindow(PERIOD * 0.25, PERIOD, TOLERANCE)).toBe(false);
  });

  it('is true in the middle of exhale', () => {
    expect(isExhaleWindow(PERIOD * 0.75, PERIOD, TOLERANCE)).toBe(true);
  });

  it('is true right at the exhale half-boundary', () => {
    expect(isExhaleWindow(PERIOD / 2, PERIOD, TOLERANCE)).toBe(true);
  });

  it('extends tolerance before the half-boundary', () => {
    expect(isExhaleWindow(PERIOD / 2 - TOLERANCE / 2, PERIOD, TOLERANCE)).toBe(true);
    expect(isExhaleWindow(PERIOD / 2 - TOLERANCE - 100, PERIOD, TOLERANCE)).toBe(false);
  });

  it('wraps the trailing tolerance edge past the period boundary', () => {
    expect(isExhaleWindow(PERIOD + TOLERANCE / 2, PERIOD, TOLERANCE)).toBe(true);
    expect(isExhaleWindow(PERIOD + TOLERANCE + 100, PERIOD, TOLERANCE)).toBe(false);
  });
});
