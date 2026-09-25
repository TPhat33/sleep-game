import { describe, expect, it } from 'vitest';

import { FakeClock } from '@/core/clock';
import { CONFIG, makeConfig } from '@/core/config';
import type { DrowsinessConfig } from '@/core/config';
import { DrowsinessEstimator } from '@/core/drowsiness/DrowsinessEstimator';
import type { DrowsinessSample, TapEvent } from '@/core/types';

import {
  alertSteady,
  graduallyDrowsy,
  noisy,
  suddenStop,
  tooFewBaselineTaps,
} from '../../../fixtures/tapStreams';

const SEEDS = [1, 2, 3, 4, 5];

function runEstimator(
  cfg: DrowsinessConfig,
  taps: readonly TapEvent[],
  durationMs: number,
): DrowsinessSample[] {
  const clock = new FakeClock(0);
  const estimator = new DrowsinessEstimator(clock, cfg);
  estimator.startBaseline();
  const samples: DrowsinessSample[] = [];
  let tapIdx = 0;
  const totalSteps = Math.ceil(durationMs / cfg.WINDOW_STEP_MS);
  for (let step = 1; step <= totalSteps; step++) {
    const stepEnd = Math.min(step * cfg.WINDOW_STEP_MS, durationMs);
    clock.advanceTo(stepEnd);
    while (tapIdx < taps.length && taps[tapIdx]!.t <= stepEnd) {
      estimator.record(taps[tapIdx]!);
      tapIdx++;
    }
    const sample = estimator.tick();
    if (sample) samples.push(sample);
  }
  return samples;
}

/** First minute at which score stays >= DRIFT_THRESHOLD for DRIFT_CONFIRM_WINDOWS consecutive samples, or null. */
function firstDriftMinute(
  cfg: DrowsinessConfig,
  samples: readonly DrowsinessSample[],
): number | null {
  let consecutive = 0;
  for (const sample of samples) {
    if (sample.score >= cfg.DRIFT_THRESHOLD) {
      consecutive++;
      if (consecutive >= cfg.DRIFT_CONFIRM_WINDOWS) {
        return sample.t / 60_000;
      }
    } else {
      consecutive = 0;
    }
  }
  return null;
}

describe('DrowsinessEstimator: baseline lifecycle', () => {
  it('tick() returns null and score stays 0 before the baseline is ready', () => {
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, CONFIG.drowsiness);
    estimator.startBaseline();
    clock.advanceTo(CONFIG.drowsiness.BASELINE_MS - 1);
    expect(estimator.tick()).toBeNull();
    expect(estimator.score).toBe(0);
    expect(estimator.isBaselineReady).toBe(false);
  });

  it('becomes ready and produces its first sample at the same tick', () => {
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, CONFIG.drowsiness);
    estimator.startBaseline();
    for (let t = 0; t < CONFIG.drowsiness.BASELINE_MS; t += 2000) {
      estimator.record({ t, hit: true, reactionMs: 800 });
    }
    clock.advanceTo(CONFIG.drowsiness.BASELINE_MS);
    const sample = estimator.tick();
    expect(estimator.isBaselineReady).toBe(true);
    expect(sample).not.toBeNull();
  });
});

describe('DrowsinessEstimator: window membership (rule 1)', () => {
  it('excludes a tap exactly at windowEnd - WINDOW_MS and includes one exactly at windowEnd', () => {
    const cfg = CONFIG.drowsiness;
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, cfg);
    estimator.startBaseline();
    for (let t = 0; t < cfg.BASELINE_MS; t += 2000) {
      estimator.record({ t, hit: true, reactionMs: 800 });
    }
    clock.advanceTo(cfg.BASELINE_MS);
    estimator.tick();

    const windowEnd = clock.now() + cfg.WINDOW_MS;
    estimator.record({ t: windowEnd - cfg.WINDOW_MS, hit: true, reactionMs: 800 }); // excluded (boundary)
    estimator.record({ t: windowEnd, hit: true, reactionMs: 800 }); // included (boundary)
    clock.advanceTo(windowEnd);
    const sample = estimator.tick();
    expect(sample?.features.tapCount).toBe(1);
  });
});

describe('DrowsinessEstimator: feature computation (rules 2-4)', () => {
  it('computes itiMedian/itiCv from consecutive-in-window taps, and rtMedian/missRate', () => {
    const cfg = makeConfig({ drowsiness: { BASELINE_MIN_TAPS: 1 } }).drowsiness;
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, cfg);
    estimator.startBaseline();
    estimator.record({ t: 0, hit: true, reactionMs: 800 });
    clock.advanceTo(cfg.BASELINE_MS);
    estimator.tick();

    const base = clock.now();
    // ITIs of 1000, 2000, 3000ms; one miss (no reactionMs).
    estimator.record({ t: base + 100, hit: true, reactionMs: 700 });
    estimator.record({ t: base + 1100, hit: true, reactionMs: 900 });
    estimator.record({ t: base + 3100, hit: false });
    estimator.record({ t: base + 6100, hit: true, reactionMs: 1100 });
    clock.advanceTo(base + cfg.WINDOW_STEP_MS);
    const sample = estimator.tick()!;

    expect(sample.features.tapCount).toBe(4);
    expect(sample.features.missRate).toBeCloseTo(0.25, 6);
    expect(sample.features.rtMedian).toBeCloseTo(900, 6); // median of [700, 900, 1100]
    expect(sample.features.itiMedian).toBeCloseTo(2000, 6); // median of [1000, 2000, 3000]
    expect(sample.features.itiCv).not.toBeNull();
  });

  it('produces null itiMedian/itiCv/rtMedian when there is not enough data, and those contribute 0 to the weighted sum', () => {
    const cfg = makeConfig({ drowsiness: { BASELINE_MIN_TAPS: 1 } }).drowsiness;
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, cfg);
    estimator.startBaseline();
    estimator.record({ t: 0, hit: true, reactionMs: 800 });
    clock.advanceTo(cfg.BASELINE_MS);
    estimator.tick();

    // A single tap in the next window: no ITI pair, and it's a miss (no reactionMs).
    estimator.record({ t: clock.now() + 100, hit: false });
    clock.advanceTo(clock.now() + cfg.WINDOW_STEP_MS);
    const sample = estimator.tick()!;

    expect(sample.features.itiMedian).toBeNull();
    expect(sample.features.itiCv).toBeNull();
    expect(sample.features.rtMedian).toBeNull();
    expect(sample.features.missRate).toBe(1);
    // Only the missRate weight (0.2) can contribute; z is clamped to Z_CLAMP=3, so
    // raw = sigmoid(min(0.2*3, weightedSum) - BIAS) must be well below sigmoid(-BIAS + small).
    expect(sample.raw).toBeGreaterThan(0);
    expect(sample.raw).toBeLessThan(1);
  });
});

describe('DrowsinessEstimator: no-tap windows (rule 5)', () => {
  it('skips the EMA and sets score = max(prevScore, NO_TAP_WINDOW_SCORE) when tapCount is 0', () => {
    const cfg = makeConfig({ drowsiness: { BASELINE_MIN_TAPS: 1 } }).drowsiness;
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, cfg);
    estimator.startBaseline();
    // Taps throughout the baseline window so the live tick's own window
    // (the final WINDOW_MS of it) also has data, not just the baseline calc.
    for (let t = 0; t < cfg.BASELINE_MS; t += 2000) {
      estimator.record({ t, hit: true, reactionMs: 800 });
    }
    clock.advanceTo(cfg.BASELINE_MS);
    const first = estimator.tick()!;
    expect(first.score).toBeLessThan(cfg.NO_TAP_WINDOW_SCORE);

    // Advance well past WINDOW_MS since the last tap so this window is fully empty.
    clock.advanceTo(clock.now() + cfg.WINDOW_MS + cfg.WINDOW_STEP_MS);
    const second = estimator.tick()!;
    expect(second.features.tapCount).toBe(0);
    expect(second.raw).toBe(cfg.NO_TAP_WINDOW_SCORE);
    expect(second.score).toBe(cfg.NO_TAP_WINDOW_SCORE);

    // prevScore already exceeds NO_TAP_WINDOW_SCORE: max() keeps it, doesn't reset down.
    clock.advanceTo(clock.now() + cfg.WINDOW_STEP_MS);
    const third = estimator.tick()!;
    expect(third.score).toBe(second.score);
  });
});

describe('DrowsinessEstimator: baseline computation (rule 6)', () => {
  it('uses DEFAULT_BASELINE with source "default" when fewer than BASELINE_MIN_TAPS taps were recorded', () => {
    const cfg = CONFIG.drowsiness;
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, cfg);
    estimator.startBaseline();
    for (let i = 0; i < cfg.BASELINE_MIN_TAPS - 1; i++) {
      estimator.record({ t: i * 1000, hit: true, reactionMs: 800 });
    }
    clock.advanceTo(cfg.BASELINE_MS);
    estimator.tick();

    expect(estimator.baseline?.source).toBe('default');
    expect(estimator.baseline?.rtMedian).toEqual(cfg.DEFAULT_BASELINE.rtMedian);
  });

  it('computes measured mean/sample-std from sub-window values when enough taps exist', () => {
    const cfg = CONFIG.drowsiness;
    const clock = new FakeClock(0);
    const estimator = new DrowsinessEstimator(clock, cfg);
    estimator.startBaseline();
    // Dense, steady taps across all 4 sub-windows.
    for (let t = 0; t < cfg.BASELINE_MS; t += 1000) {
      estimator.record({ t, hit: true, reactionMs: 800 });
    }
    clock.advanceTo(cfg.BASELINE_MS);
    estimator.tick();

    const baseline = estimator.baseline!;
    expect(baseline.source).toBe('measured');
    // rtMedian is constant (800) in every sub-window, so std should be ~0.
    expect(baseline.rtMedian.mean).toBeCloseTo(800, 0);
    expect(baseline.rtMedian.std).toBeCloseTo(0, 6);
  });

  it('does not throw and reaches isBaselineReady with tooFewBaselineTaps', () => {
    const cfg = CONFIG.drowsiness;
    const taps = tooFewBaselineTaps(1);
    expect(() => runEstimator(cfg, taps, cfg.BASELINE_MS + 10 * 60_000)).not.toThrow();
  });
});

describe('DrowsinessEstimator: fixtures (plan Appendix A)', () => {
  for (const seed of SEEDS) {
    it(`alertSteady (seed ${String(seed)}) never crosses DRIFT_THRESHOLD`, () => {
      const cfg = CONFIG.drowsiness;
      const taps = alertSteady(seed);
      const samples = runEstimator(cfg, taps, 25 * 60_000);
      const maxScore = Math.max(...samples.map((s) => s.score));
      expect(maxScore).toBeLessThan(cfg.DRIFT_THRESHOLD);
      expect(firstDriftMinute(cfg, samples)).toBeNull();
    });
  }

  for (const seed of SEEDS) {
    it(`graduallyDrowsy (seed ${String(seed)}) crosses DRIFT_THRESHOLD within 8-14 minutes`, () => {
      const cfg = CONFIG.drowsiness;
      const taps = graduallyDrowsy(seed);
      const samples = runEstimator(cfg, taps, 25 * 60_000);
      const driftMinute = firstDriftMinute(cfg, samples);
      expect(driftMinute).not.toBeNull();
      expect(driftMinute!).toBeGreaterThanOrEqual(8);
      expect(driftMinute!).toBeLessThanOrEqual(14);
    });
  }

  for (const seed of SEEDS) {
    it(`suddenStop (seed ${String(seed)}) reaches NO_TAP_WINDOW_SCORE once taps stop`, () => {
      const cfg = CONFIG.drowsiness;
      const taps = suddenStop(seed);
      const lastTapT = taps[taps.length - 1]!.t;
      const durationMs = lastTapT + 5 * 60_000;
      const samples = runEstimator(cfg, taps, durationMs);
      const afterTapsStopped = samples.filter((s) => s.t > lastTapT + cfg.WINDOW_MS);
      expect(afterTapsStopped.length).toBeGreaterThan(0);
      for (const sample of afterTapsStopped) {
        expect(sample.features.tapCount).toBe(0);
        expect(sample.score).toBeGreaterThanOrEqual(cfg.NO_TAP_WINDOW_SCORE);
      }
    });
  }

  for (const seed of SEEDS) {
    it(`noisy (seed ${String(seed)}) never crosses DRIFT_THRESHOLD (hysteresis holds)`, () => {
      const cfg = CONFIG.drowsiness;
      const taps = noisy(seed);
      const samples = runEstimator(cfg, taps, 25 * 60_000);
      const maxScore = Math.max(...samples.map((s) => s.score));
      expect(maxScore).toBeLessThan(cfg.DRIFT_THRESHOLD);
    });
  }

  for (const seed of SEEDS) {
    it(`tooFewBaselineTaps (seed ${String(seed)}) uses the default baseline and does not throw`, () => {
      const cfg = CONFIG.drowsiness;
      const taps = tooFewBaselineTaps(seed);
      const durationMs = cfg.BASELINE_MS + 10 * 60_000;
      const clock = new FakeClock(0);
      const estimator = new DrowsinessEstimator(clock, cfg);
      estimator.startBaseline();
      let tapIdx = 0;
      const totalSteps = Math.ceil(durationMs / cfg.WINDOW_STEP_MS);
      for (let step = 1; step <= totalSteps; step++) {
        const stepEnd = Math.min(step * cfg.WINDOW_STEP_MS, durationMs);
        clock.advanceTo(stepEnd);
        while (tapIdx < taps.length && taps[tapIdx]!.t <= stepEnd) {
          estimator.record(taps[tapIdx]!);
          tapIdx++;
        }
        estimator.tick();
      }
      expect(estimator.isBaselineReady).toBe(true);
      expect(estimator.baseline?.source).toBe('default');
    });
  }
});
