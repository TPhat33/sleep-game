// A soft low tone that swells and fades with the firefly breath cycle —
// spec §9.1: optional, off by default. Pure enough to unit test: given a
// clock time and the breath period, what gain should the tone have right now.
const TONE_HZ = 110;
const HALF_TURN = Math.PI;

export function breathCueGain(elapsedMs: number, periodMs: number, maxGain: number): number {
  const phase = (elapsedMs % periodMs) / periodMs; // 0..1
  const swell = (1 - Math.cos(2 * HALF_TURN * phase)) / 2; // 0..1, smooth in/out
  return swell * maxGain;
}

export const BREATH_CUE_TONE_HZ = TONE_HZ;
