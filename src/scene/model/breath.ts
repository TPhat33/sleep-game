// Firefly breath cue — spec §8: brightness follows a sinusoid over
// BREATH_PERIOD_MS (inhale = brightening, exhale = dimming), and tapping a
// dream during the exhale half (± BREATH_TOLERANCE_MS) earns a gold star.
// Pure functions of elapsed time — no Clock/Rng needed, so the caller just
// passes `now - breathAnchorMs`.

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

const HALF = 0.5;

/**
 * 0..1 brightness for a sinusoidal breath: the first half of the period
 * rises 0 -> 1 (inhale), the second half falls 1 -> 0 (exhale).
 */
export function breathBrightness(elapsedMs: number, periodMs: number): number {
  const phase = mod(elapsedMs, periodMs) / periodMs;
  return Math.sin(Math.PI * phase);
}

/**
 * Whether `elapsedMs` falls in the exhale half of the cycle, widened by
 * `toleranceMs` on both edges (spec: "ครึ่งหลังของคาบ ± BREATH_TOLERANCE_MS").
 * The trailing edge's tolerance wraps past the period boundary into the
 * start of the next cycle.
 */
export function isExhaleWindow(elapsedMs: number, periodMs: number, toleranceMs: number): boolean {
  const phase = mod(elapsedMs, periodMs);
  const halfStart = periodMs * HALF - toleranceMs;
  return phase >= halfStart || phase < toleranceMs;
}
