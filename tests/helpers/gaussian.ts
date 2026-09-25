// Box-Muller gaussian sampling on top of the injected seeded Rng, for
// synthetic tap-stream fixtures (plan Appendix A).
import type { Rng } from '@/core/rng';

const TWO_PI = 2 * Math.PI;
const MIN_U = Number.EPSILON;

export function gaussian(rng: Rng, mean: number, std: number): number {
  const u1 = Math.max(rng.next(), MIN_U);
  const u2 = rng.next();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
  return mean + std * z0;
}
