// Pure statistics helpers for the drowsiness algorithm — spec §6.1, plan
// Appendix A rules 1-3.

import type { TapEvent, WindowFeatures } from '../types';

function at(arr: readonly number[], i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`index ${String(i)} out of range`);
  return v;
}

export function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const isEven = sorted.length % 2 === 0;
  if (isEven) {
    return (at(sorted, mid - 1) + at(sorted, mid)) / 2;
  }
  return at(sorted, mid);
}

/** Population standard deviation (divides by n). */
export function populationStd(values: readonly number[]): number {
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

/** Sample standard deviation (divides by n-1). Requires at least 2 values. */
export function sampleStd(values: readonly number[]): number {
  const m = mean(values);
  const sumSquares = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return Math.sqrt(sumSquares / (values.length - 1));
}

const MIN_ITI_CV_SAMPLES = 2;

/**
 * Appendix A rule 1: a tap `t` is in the window when
 * `windowEnd - windowMs < t <= windowEnd`.
 */
export function tapsInWindow(
  taps: readonly TapEvent[],
  windowEnd: number,
  windowMs: number,
): TapEvent[] {
  const windowStart = windowEnd - windowMs;
  return taps.filter((tap) => tap.t > windowStart && tap.t <= windowEnd);
}

/**
 * Computes WindowFeatures from a set of taps already known to be within a
 * window (see {@link tapsInWindow}) — reused for both the live tick()
 * window and each 30s baseline sub-window (plan Appendix A rules 1-3, 6).
 */
export function computeFeatures(windowTaps: readonly TapEvent[]): WindowFeatures {
  const tapCount = windowTaps.length;

  const itis: number[] = [];
  for (let i = 1; i < windowTaps.length; i++) {
    const current = windowTaps[i];
    const previous = windowTaps[i - 1];
    if (current === undefined || previous === undefined) continue;
    itis.push(current.t - previous.t);
  }
  const itiMedian = itis.length > 0 ? median(itis) : null;
  const itiCv = itis.length >= MIN_ITI_CV_SAMPLES ? populationStd(itis) / mean(itis) : null;

  const reactionTimes = windowTaps
    .map((tap) => tap.reactionMs)
    .filter((rt): rt is number => rt !== undefined);
  const rtMedian = reactionTimes.length > 0 ? median(reactionTimes) : null;

  const missRate = tapCount > 0 ? windowTaps.filter((tap) => !tap.hit).length / tapCount : 0;

  return { itiMedian, itiCv, rtMedian, missRate, tapCount };
}
