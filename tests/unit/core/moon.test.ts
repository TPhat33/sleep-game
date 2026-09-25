import { describe, expect, it } from 'vitest';

import { moonAge, moonPhase, REFERENCE_NEW_MOON_MS } from '@/core/moon';

const SYNODIC_MONTH_DAYS = 29.530588;
const DAY_MS = 24 * 60 * 60_000;

/** Distance from `age` to 0 on the 0..1 wraparound circle (handles fp noise near the seam). */
function circularDistanceFromZero(age: number): number {
  return Math.min(age, 1 - age);
}

describe('moonAge', () => {
  it('is ~0 exactly at the reference new moon', () => {
    expect(moonAge(REFERENCE_NEW_MOON_MS, SYNODIC_MONTH_DAYS)).toBeCloseTo(0, 6);
  });

  it('is ~0.5 exactly half a synodic month after the reference (a full moon)', () => {
    const halfCycleMs = (SYNODIC_MONTH_DAYS / 2) * DAY_MS;
    expect(moonAge(REFERENCE_NEW_MOON_MS + halfCycleMs, SYNODIC_MONTH_DAYS)).toBeCloseTo(0.5, 6);
  });

  it('wraps back to ~0 after a full synodic month', () => {
    const fullCycleMs = SYNODIC_MONTH_DAYS * DAY_MS;
    const age = moonAge(REFERENCE_NEW_MOON_MS + fullCycleMs, SYNODIC_MONTH_DAYS);
    expect(circularDistanceFromZero(age)).toBeCloseTo(0, 6);
  });

  it('is ~0 exactly one synodic month before the reference too (wraps the other way)', () => {
    const fullCycleMs = SYNODIC_MONTH_DAYS * DAY_MS;
    const age = moonAge(REFERENCE_NEW_MOON_MS - fullCycleMs, SYNODIC_MONTH_DAYS);
    expect(circularDistanceFromZero(age)).toBeCloseTo(0, 6);
  });

  it('increases roughly linearly through the first quarter of the cycle', () => {
    const quarterMs = (SYNODIC_MONTH_DAYS / 4) * DAY_MS;
    const age = moonAge(REFERENCE_NEW_MOON_MS + quarterMs, SYNODIC_MONTH_DAYS);
    expect(age).toBeCloseTo(0.25, 6);
  });
});

describe('moonPhase', () => {
  it('is fully dark (illumination ~0) at the new moon', () => {
    const phase = moonPhase(REFERENCE_NEW_MOON_MS, SYNODIC_MONTH_DAYS);
    expect(phase.name).toBe('new');
    expect(phase.illumination).toBeCloseTo(0, 3);
  });

  it('is fully lit (illumination ~1) at the full moon', () => {
    const halfCycleMs = (SYNODIC_MONTH_DAYS / 2) * DAY_MS;
    const phase = moonPhase(REFERENCE_NEW_MOON_MS + halfCycleMs, SYNODIC_MONTH_DAYS);
    expect(phase.name).toBe('full');
    expect(phase.illumination).toBeCloseTo(1, 3);
  });

  it('names the first quarter at 1/4 through the cycle', () => {
    const quarterMs = (SYNODIC_MONTH_DAYS / 4) * DAY_MS;
    const phase = moonPhase(REFERENCE_NEW_MOON_MS + quarterMs, SYNODIC_MONTH_DAYS);
    expect(phase.name).toBe('firstQuarter');
    expect(phase.illumination).toBeCloseTo(0.5, 2);
  });

  it('names the last quarter at 3/4 through the cycle', () => {
    const threeQuarterMs = ((3 * SYNODIC_MONTH_DAYS) / 4) * DAY_MS;
    const phase = moonPhase(REFERENCE_NEW_MOON_MS + threeQuarterMs, SYNODIC_MONTH_DAYS);
    expect(phase.name).toBe('lastQuarter');
    expect(phase.illumination).toBeCloseTo(0.5, 2);
  });

  it('cycles through all 8 named phases across one synodic month', () => {
    const seen = new Set<string>();
    const steps = 32;
    for (let i = 0; i < steps; i++) {
      const t = REFERENCE_NEW_MOON_MS + (i / steps) * SYNODIC_MONTH_DAYS * DAY_MS;
      seen.add(moonPhase(t, SYNODIC_MONTH_DAYS).name);
    }
    expect(seen.size).toBe(8);
  });
});
