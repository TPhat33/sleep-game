// Local-time and easing helpers. Constructing `new Date(epochMs)` from a
// clock-sourced value is fine — reading the current time any other way is
// not (spec §0; see clock.ts).

/** Local hour (0-23) for an epoch-ms timestamp, in the runtime's local timezone. */
export function localHour(epochMs: number): number {
  return new Date(epochMs).getHours();
}

const YEAR_DIGITS = 4;

/** 'YYYY-MM-DD' local date key, used for the `surveys` store's key (spec §11). */
export function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const year = String(d.getFullYear()).padStart(YEAR_DIGITS, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function minutes(ms: number): number {
  return ms / 60_000;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const CUBIC_DEGREE = 3;
const EASE_MIDPOINT = 0.5;
const EASE_IN_OUT_SCALE = 4;
const EASE_IN_OUT_SLOPE = -2;

/** Cubic ease-in-out. */
export function easeInOut(t: number): number {
  return t < EASE_MIDPOINT
    ? EASE_IN_OUT_SCALE * t * t * t
    : 1 - Math.pow(EASE_IN_OUT_SLOPE * t + 2, CUBIC_DEGREE) / 2;
}

/** Cubic ease-out. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, CUBIC_DEGREE);
}
