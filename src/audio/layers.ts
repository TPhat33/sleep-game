// Asset paths and small type aliases shared by AudioEngine and its tests —
// spec §9.1's layer table.
import type { BedLayerId } from '../core/types';

export type { BedLayerId };

export type SfxId = 'matchSuccess' | 'starRise';

export const BED_LAYER_URLS: Record<Exclude<BedLayerId, 'brownNoise'>, string> = {
  rain: '/audio/bed/rain.m4a',
  crickets: '/audio/bed/crickets.m4a',
  asmrTaps: '/audio/bed/asmr-taps.m4a',
};

export const SFX_URLS: Record<SfxId, string> = {
  matchSuccess: '/audio/sfx/match-success.m4a',
  starRise: '/audio/sfx/star-rise.m4a',
};

export function voiceWordUrl(index: number): string {
  return `/voice/th/${String(index)}.m4a`;
}
