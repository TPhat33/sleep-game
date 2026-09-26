// spec §14: "ห้ามใช้สีที่มี hue 170°-260° (ฟ้า/น้ำเงิน/ม่วงอมฟ้า)" — no hue
// in 170-260° (blue/purple-blue) anywhere in the palette. Checked directly
// against the CSS file so this catches a future token added straight to
// theme.css, not just ones a TS module happens to mirror.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PALETTE } from '@/scene/palette';

const THEME_CSS_PATH = fileURLToPath(new URL('../../../src/ui/theme.css', import.meta.url));

const BANNED_HUE_MIN = 170;
const BANNED_HUE_MAX = 260;

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0; // achromatic — no hue to violate

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

function numberToHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function parseThemeTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  const pattern = /--color-([\w-]+):\s*(#[0-9a-fA-F]{6});/g;
  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    const hex = match[2];
    if (name && hex) tokens[name] = hex;
  }
  return tokens;
}

describe('theme.css palette', () => {
  const css = readFileSync(THEME_CSS_PATH, 'utf8');
  const tokens = parseThemeTokens(css);

  it('extracts at least the known tokens (sanity check the parser itself)', () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(8);
    expect(tokens.amber).toBe('#c98a3e');
  });

  it('keeps every --color-* token outside the banned 170-260° hue range', () => {
    for (const [name, hex] of Object.entries(tokens)) {
      const hue = hexToHue(hex);
      const inBannedRange = hue >= BANNED_HUE_MIN && hue <= BANNED_HUE_MAX;
      expect(inBannedRange, `--color-${name} (${hex}) has hue ${hue.toFixed(1)}°`).toBe(false);
    }
  });
});

describe('scene/palette.ts', () => {
  it('keeps every palette entry outside the banned 170-260° hue range', () => {
    for (const [name, value] of Object.entries(PALETTE)) {
      const hue = hexToHue(numberToHex(value));
      const inBannedRange = hue >= BANNED_HUE_MIN && hue <= BANNED_HUE_MAX;
      expect(
        inBannedRange,
        `PALETTE.${name} (${numberToHex(value)}) has hue ${hue.toFixed(1)}°`,
      ).toBe(false);
    }
  });

  it('matches theme.css exactly for every token both files define', () => {
    const css = readFileSync(THEME_CSS_PATH, 'utf8');
    const tokens = parseThemeTokens(css);
    const cssKeyFor: Record<string, string> = {
      bgNight: 'bg-night',
      water: 'water',
      amber: 'amber',
      ember: 'ember',
      moss: 'moss',
      firefly: 'firefly',
      gold: 'gold',
      textDim: 'text-dim',
    };
    for (const [paletteKey, cssKey] of Object.entries(cssKeyFor)) {
      const cssHex = tokens[cssKey];
      const paletteHex = numberToHex(PALETTE[paletteKey as keyof typeof PALETTE]);
      expect(paletteHex, `PALETTE.${paletteKey} vs --color-${cssKey}`).toBe(cssHex);
    }
  });
});
