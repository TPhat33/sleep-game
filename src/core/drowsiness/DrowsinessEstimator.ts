// Spec §6 + plan Appendix A. Implemented exactly to the letter of Appendix
// A's seven rules — do not tune config values to make a fixture test pass;
// if a fixture fails, first re-check against those rules (plan Appendix A
// closing note).

import type { Clock } from '../clock';
import type { DrowsinessConfig, FeatureStatsConfig } from '../config';
import type {
  Baseline,
  DrowsinessSample,
  FeatureKey,
  FeatureStats,
  TapEvent,
  WindowFeatures,
} from '../types';
import { computeFeatures, mean, sampleStd, tapsInWindow } from './features';

const FEATURE_KEYS: readonly FeatureKey[] = ['rtMedian', 'itiMedian', 'itiCv', 'missRate'];
const NULLABLE_FEATURE_KEYS: readonly Exclude<FeatureKey, 'missRate'>[] = [
  'rtMedian',
  'itiMedian',
  'itiCv',
];
const MIN_SUBWINDOW_VALUES_FOR_MEASURED = 2;
const SUBWINDOW_COUNT = 4;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class DrowsinessEstimator {
  private taps: TapEvent[] = [];
  private baselineStartT: number | null = null;
  private computedBaseline: Baseline | null = null;
  private currentScore = 0;

  constructor(
    private readonly clock: Clock,
    private readonly cfg: DrowsinessConfig,
  ) {}

  get score(): number {
    return this.currentScore;
  }

  get isBaselineReady(): boolean {
    return this.computedBaseline !== null;
  }

  get baseline(): Baseline | null {
    return this.computedBaseline;
  }

  startBaseline(): void {
    this.baselineStartT = this.clock.now();
  }

  record(e: TapEvent): void {
    const last = this.taps[this.taps.length - 1];
    if (last && e.t < last.t) return; // out-of-order events are ignored
    this.taps.push(e);
  }

  reset(): void {
    this.taps = [];
    this.baselineStartT = null;
    this.computedBaseline = null;
    this.currentScore = 0;
  }

  tick(): DrowsinessSample | null {
    const windowEnd = this.clock.now();

    if (!this.isBaselineReady) {
      if (this.baselineStartT === null || windowEnd < this.baselineStartT + this.cfg.BASELINE_MS) {
        return null;
      }
      this.computedBaseline = this.computeBaseline(this.baselineStartT);
    }

    const windowTaps = tapsInWindow(this.taps, windowEnd, this.cfg.WINDOW_MS);
    const features = computeFeatures(windowTaps);
    const raw = this.scoreFeatures(features);

    if (features.tapCount === 0) {
      // Rule 5: skip the EMA on a silent window — the absence of taps is
      // itself the strongest drowsiness signal.
      this.currentScore = Math.max(this.currentScore, this.cfg.NO_TAP_WINDOW_SCORE);
    } else {
      this.currentScore = this.cfg.EMA_ALPHA * raw + (1 - this.cfg.EMA_ALPHA) * this.currentScore;
    }

    return { t: windowEnd, score: this.currentScore, raw, features };
  }

  /** raw = sigmoid(sum of weighted, clamped z-scores - BIAS). Null features contribute 0 (rule 4). */
  private scoreFeatures(features: WindowFeatures): number {
    if (features.tapCount === 0) {
      return this.cfg.NO_TAP_WINDOW_SCORE;
    }
    const baseline = this.computedBaseline;
    if (!baseline) {
      // Unreachable in practice: tick() only calls scoreFeatures() once the
      // baseline is ready. Kept explicit rather than asserting non-null.
      return 0;
    }

    let weightedSum = 0;
    for (const key of FEATURE_KEYS) {
      const value = features[key];
      if (value === null) continue;
      const stats = baseline[key];
      const floor = this.cfg.STD_FLOOR[key];
      const z = (value - stats.mean) / Math.max(stats.std, floor);
      weightedSum += this.cfg.WEIGHTS[key] * clamp(z, -this.cfg.Z_CLAMP, this.cfg.Z_CLAMP);
    }
    return sigmoid(weightedSum - this.cfg.BIAS);
  }

  /** Appendix A rule 6. */
  private computeBaseline(t0: number): Baseline {
    const baselineTaps = this.taps.filter(
      (tap) => tap.t >= t0 && tap.t < t0 + this.cfg.BASELINE_MS,
    );

    if (baselineTaps.length < this.cfg.BASELINE_MIN_TAPS) {
      return { ...cloneDefaults(this.cfg.DEFAULT_BASELINE), source: 'default' };
    }

    const subWindowFeatures: WindowFeatures[] = [];
    for (let k = 0; k < SUBWINDOW_COUNT; k++) {
      const start = t0 + k * this.cfg.BASELINE_SUBWINDOW_MS;
      const end = start + this.cfg.BASELINE_SUBWINDOW_MS;
      const subTaps = this.taps.filter((tap) => tap.t >= start && tap.t < end);
      subWindowFeatures.push(computeFeatures(subTaps));
    }

    const stats = {} as Record<FeatureKey, FeatureStats>;
    let anyDefaulted = false;

    for (const key of NULLABLE_FEATURE_KEYS) {
      const values = subWindowFeatures.map((f) => f[key]).filter((v): v is number => v !== null);
      const result = this.statsForFeature(values, this.cfg.DEFAULT_BASELINE[key]);
      stats[key] = result.stats;
      anyDefaulted ||= result.usedDefault;
    }

    // missRate is never null, but a sub-window with no taps has no meaningful
    // miss rate — only sub-windows with taps count toward the baseline.
    const missRateValues = subWindowFeatures.filter((f) => f.tapCount > 0).map((f) => f.missRate);
    const missRateResult = this.statsForFeature(missRateValues, this.cfg.DEFAULT_BASELINE.missRate);
    stats.missRate = missRateResult.stats;
    anyDefaulted ||= missRateResult.usedDefault;

    return { ...stats, source: anyDefaulted ? 'mixed' : 'measured' };
  }

  private statsForFeature(
    values: readonly number[],
    fallback: FeatureStatsConfig,
  ): { stats: FeatureStats; usedDefault: boolean } {
    if (values.length >= MIN_SUBWINDOW_VALUES_FOR_MEASURED) {
      return { stats: { mean: mean(values), std: sampleStd(values) }, usedDefault: false };
    }
    return { stats: { mean: fallback.mean, std: fallback.std }, usedDefault: true };
  }
}

function cloneDefaults(
  defaults: Record<FeatureKey, FeatureStatsConfig>,
): Record<FeatureKey, FeatureStats> {
  return {
    rtMedian: { ...defaults.rtMedian },
    itiMedian: { ...defaults.itiMedian },
    itiCv: { ...defaults.itiCv },
    missRate: { ...defaults.missRate },
  };
}
