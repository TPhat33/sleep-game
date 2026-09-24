// Spec §0 (extended): anything that needs randomness (spawn choice, respawn
// delay, shuffle gaps, word choice, visitor chance, …) takes an injected Rng
// so tests are reproducible. Math.random is lint-banned everywhere except
// this file — see eslint.config.ts.

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
}

const MULBERRY32_INCREMENT = 0x6d2b79f5;
const MULBERRY32_SHIFT_1 = 15;
const MULBERRY32_SHIFT_2 = 7;
const MULBERRY32_MULT_1 = 61;
const MULBERRY32_SHIFT_3 = 14;
const UINT32_DIVISOR = 4_294_967_296;

/** mulberry32: a small, fast, deterministic PRNG — good enough for gameplay pacing, not for security. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + MULBERRY32_INCREMENT) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> MULBERRY32_SHIFT_1), t | 1);
      t = (t + Math.imul(t ^ (t >>> MULBERRY32_SHIFT_2), t | MULBERRY32_MULT_1)) ^ t;
      return ((t ^ (t >>> MULBERRY32_SHIFT_3)) >>> 0) / UINT32_DIVISOR;
    },
  };
}

/** The only allowed use of Math.random — everything else takes an injected Rng. */
export const systemRng: Rng = {
  next(): number {
    return Math.random();
  },
};

export function randRange(rng: Rng, [min, max]: readonly [number, number]): number {
  return min + rng.next() * (max - min);
}

export function randInt(rng: Rng, min: number, maxInclusive: number): number {
  return min + Math.floor(rng.next() * (maxInclusive - min + 1));
}

/**
 * Picks an index not in `recent` (a ring of the last N picks); falls back to
 * any index if all are excluded. Throws if `items` is empty.
 */
// `T` is generic so this reads naturally at call sites (`pickNoRepeat(rng, dreams, recent)`),
// even though only its length matters here.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function pickNoRepeat<T>(rng: Rng, items: readonly T[], recent: readonly number[]): number {
  if (items.length === 0) {
    throw new Error('pickNoRepeat() requires a non-empty items array');
  }
  const recentSet = new Set(recent);
  const allIndices = items.map((_, i) => i);
  const pool = allIndices.filter((i) => !recentSet.has(i));
  const candidates = pool.length > 0 ? pool : allIndices;
  const idx = randInt(rng, 0, candidates.length - 1);
  const picked = candidates[idx];
  if (picked === undefined) {
    throw new Error('pickNoRepeat() internal error: index out of range');
  }
  return picked;
}
