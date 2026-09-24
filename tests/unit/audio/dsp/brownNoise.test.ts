import { describe, expect, it } from 'vitest';

import { renderBrownNoise } from '@/audio/dsp/brownNoise';
import { seededRng } from '@/core/rng';

const SAMPLE_RATE = 22_050;
const SECONDS = 2;
const TARGET_PEAK = Math.pow(10, -6 / 20); // -6 dBFS

describe('renderBrownNoise', () => {
  it('has the requested length', () => {
    const out = renderBrownNoise(SAMPLE_RATE, SECONDS, seededRng(1));
    expect(out.length).toBe(SAMPLE_RATE * SECONDS);
  });

  it('peaks at or below -6 dBFS', () => {
    for (const seed of [1, 2, 3]) {
      const out = renderBrownNoise(SAMPLE_RATE, SECONDS, seededRng(seed));
      let peak = 0;
      for (const s of out) peak = Math.max(peak, Math.abs(s));
      expect(peak).toBeLessThanOrEqual(TARGET_PEAK + 1e-9);
    }
  });

  it('is DC-blocked: |mean| < 0.01', () => {
    const out = renderBrownNoise(SAMPLE_RATE, SECONDS, seededRng(1));
    let sum = 0;
    for (const s of out) sum += s;
    const mean = sum / out.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
  });

  it('is seamlessly loopable: the wrap-around jump is not larger than the 99th percentile of adjacent-sample jumps', () => {
    const out = renderBrownNoise(SAMPLE_RATE, SECONDS, seededRng(1));
    const diffs: number[] = [];
    for (let i = 1; i < out.length; i++) {
      diffs.push(Math.abs(out[i]! - out[i - 1]!));
    }
    diffs.sort((a, b) => a - b);
    const p99 = diffs[Math.floor(diffs.length * 0.99)]!;
    const seamJump = Math.abs(out[out.length - 1]! - out[0]!);
    expect(seamJump).toBeLessThanOrEqual(p99);
  });

  it('is deterministic for a given seed', () => {
    const a = renderBrownNoise(SAMPLE_RATE, SECONDS, seededRng(42));
    const b = renderBrownNoise(SAMPLE_RATE, SECONDS, seededRng(42));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
