// Pre-rendered seamless brown-noise loop (plan §2.2 [DEVIATION] — a pure
// function, not an AudioWorklet). Reused unchanged by the M1 AudioEngine.

import type { Rng } from '../../core/rng';

/** Leaky-integrator coefficient: how much of the random walk carries forward each sample. */
const INTEGRATOR_LEAK = 0.999;
/** One-pole DC-blocker coefficient. */
const DC_BLOCKER_R = 0.995;
const DBFS_TARGET = -6;
const DBFS_DIVISOR = 20;
const LOG_BASE = 10;
/** -6 dBFS in linear amplitude: 10^(-6/20). */
const TARGET_PEAK_LINEAR = Math.pow(LOG_BASE, DBFS_TARGET / DBFS_DIVISOR);
const DEFAULT_CROSSFADE_S = 1;

function at(arr: Float32Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`sample index ${String(i)} out of range`);
  return v;
}

/**
 * Renders `seconds` of brown noise at `sampleRate`, seamlessly loopable,
 * peak-normalized to -6 dBFS, and DC-blocked.
 */
export function renderBrownNoise(
  sampleRate: number,
  seconds: number,
  rng: Rng,
  crossfadeS: number = DEFAULT_CROSSFADE_S,
): Float32Array {
  const length = Math.round(seconds * sampleRate);
  const crossfadeSamples = Math.max(
    1,
    Math.min(Math.round(crossfadeS * sampleRate), Math.floor(length / 2)),
  );

  const walk = new Float32Array(length);
  let acc = 0;
  const WHITE_NOISE_RANGE = 2;
  const WHITE_NOISE_OFFSET = 1;
  for (let i = 0; i < length; i++) {
    const white = rng.next() * WHITE_NOISE_RANGE - WHITE_NOISE_OFFSET;
    acc = INTEGRATOR_LEAK * acc + white;
    walk[i] = acc;
  }

  const blocked = new Float32Array(length);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < length; i++) {
    const x = at(walk, i);
    const y = x - prevIn + DC_BLOCKER_R * prevOut;
    blocked[i] = y;
    prevIn = x;
    prevOut = y;
  }

  const out = normalizePeak(blocked, TARGET_PEAK_LINEAR);
  crossfadeTailToHead(out, crossfadeSamples);
  // The crossfade's equal-power blend can locally exceed the target peak
  // (its weights aren't a strict convex combination); reclamp afterwards.
  return normalizePeak(out, TARGET_PEAK_LINEAR);
}

function normalizePeak(samples: Float32Array, targetPeak: number): Float32Array {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak <= targetPeak || peak === 0) return samples;
  const gain = targetPeak / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = at(samples, i) * gain;
  return out;
}

const HALF_PI = Math.PI / 2;

/** Blends the buffer's tail toward its own first sample so out[N-1] === out[0]. */
function crossfadeTailToHead(samples: Float32Array, crossfadeSamples: number): void {
  const length = samples.length;
  const target = at(samples, 0);
  for (let i = 0; i < crossfadeSamples; i++) {
    const t = (i + 1) / crossfadeSamples;
    const fadeIn = Math.sin(t * HALF_PI);
    const fadeOut = Math.cos(t * HALF_PI);
    const pos = length - crossfadeSamples + i;
    samples[pos] = at(samples, pos) * fadeOut + target * fadeIn;
  }
}
