// Numeric (Pixi-friendly) versions of the spec §14 palette — must match
// src/ui/theme.css's hex values exactly; that file is the CSS source of
// truth, this one exists because Pixi wants numbers, not CSS strings.
import type { DreamColor } from '../core/types';

export const PALETTE = {
  bgNight: 0x0b0806,
  water: 0x140e0a,
  amber: 0xc98a3e,
  ember: 0xa4502d,
  moss: 0x6e6a34,
  firefly: 0xe3b25a,
  gold: 0xf0c46a,
  textDim: 0x8a6a4a,
} as const;

export function dreamColorHex(color: DreamColor): number {
  return PALETTE[color];
}
