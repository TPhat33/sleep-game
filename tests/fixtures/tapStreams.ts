// Synthetic tap streams for testing DrowsinessEstimator/SessionDirector —
// plan Appendix A. Each fixture is a pure function of a seed, built on
// seededRng plus Box-Muller gaussians, so tests are fully reproducible.
import { seededRng } from '@/core/rng';
import type { TapEvent } from '@/core/types';

import { gaussian } from '../helpers/gaussian';

const MIN_ITI_MS = 250;
const MIN_RT_MS = 150;
const MINUTE_MS = 60_000;

function clampIti(v: number): number {
  return Math.max(MIN_ITI_MS, v);
}

function clampRt(v: number): number {
  return Math.max(MIN_RT_MS, v);
}

/** 25 min. ITI ~ N(2000, 300). RT ~ N(850, 150). Deterministic miss every 12th tap. */
export function alertSteady(seed: number): TapEvent[] {
  const rng = seededRng(seed);
  const durationMs = 25 * MINUTE_MS;
  const taps: TapEvent[] = [];
  let t = 0;
  let tapNumber = 0;
  while (t <= durationMs) {
    tapNumber++;
    const isMiss = tapNumber % 12 === 0;
    if (isMiss) {
      taps.push({ t, hit: false });
    } else {
      taps.push({ t, hit: true, reactionMs: clampRt(gaussian(rng, 850, 150)) });
    }
    t += clampIti(gaussian(rng, 2000, 300));
  }
  return taps;
}

/** 25 min. Linearly ramps ITI/RT/miss-probability from k=0 (m<=6) to k=1 (m>=20). Drift expected ~8-14 min. */
export function graduallyDrowsy(seed: number): TapEvent[] {
  const rng = seededRng(seed);
  const durationMs = 25 * MINUTE_MS;
  const taps: TapEvent[] = [];
  let t = 0;
  while (t <= durationMs) {
    const m = t / MINUTE_MS;
    const k = Math.min(1, Math.max(0, (m - 6) / 14));
    const missProb = 0.08 + 0.27 * k;
    const isMiss = rng.next() < missProb;
    if (isMiss) {
      taps.push({ t, hit: false });
    } else {
      const rtMean = 850 + 1300 * k;
      const rtStd = 180 + 320 * k;
      taps.push({ t, hit: true, reactionMs: clampRt(gaussian(rng, rtMean, rtStd)) });
    }
    const itiMean = 2000 + 3000 * k;
    const itiStd = 350 + 1300 * k;
    t += clampIti(gaussian(rng, itiMean, itiStd));
  }
  return taps;
}

/** alertSteady until 6:00, then nothing — tests the idle-to-fade path. */
export function suddenStop(seed: number): TapEvent[] {
  const cutoffMs = 6 * MINUTE_MS;
  return alertSteady(seed).filter((tap) => tap.t <= cutoffMs);
}

/** 25 min. Each tap is 50/50 a "fast" or "slow" burst; miss probability 0.10. Should never drift. */
export function noisy(seed: number): TapEvent[] {
  const rng = seededRng(seed);
  const durationMs = 25 * MINUTE_MS;
  const taps: TapEvent[] = [];
  let t = 0;
  while (t <= durationMs) {
    const isMiss = rng.next() < 0.1;
    const isFast = rng.next() < 0.5;
    if (isMiss) {
      taps.push({ t, hit: false });
    } else if (isFast) {
      taps.push({ t, hit: true, reactionMs: clampRt(gaussian(rng, 850, 200)) });
    } else {
      taps.push({ t, hit: true, reactionMs: clampRt(gaussian(rng, 1100, 200)) });
    }
    t += isFast ? clampIti(gaussian(rng, 1400, 150)) : clampIti(gaussian(rng, 3200, 300));
  }
  return taps;
}

/** 10 taps spread over 0-120s (fewer than BASELINE_MIN_TAPS), then alertSteady-style behavior. */
export function tooFewBaselineTaps(seed: number): TapEvent[] {
  const rng = seededRng(seed);
  const sparseCount = 10;
  const sparseWindowMs = 120_000;
  const taps: TapEvent[] = [];
  for (let i = 0; i < sparseCount; i++) {
    const t = Math.round((i / (sparseCount - 1)) * sparseWindowMs);
    taps.push({ t, hit: true, reactionMs: clampRt(gaussian(rng, 850, 150)) });
  }

  const durationMs = sparseWindowMs + 10 * MINUTE_MS;
  let t = sparseWindowMs + clampIti(gaussian(rng, 2000, 300));
  let tapNumber = sparseCount;
  while (t <= durationMs) {
    tapNumber++;
    const isMiss = tapNumber % 12 === 0;
    if (isMiss) {
      taps.push({ t, hit: false });
    } else {
      taps.push({ t, hit: true, reactionMs: clampRt(gaussian(rng, 850, 150)) });
    }
    t += clampIti(gaussian(rng, 2000, 300));
  }
  return taps;
}
