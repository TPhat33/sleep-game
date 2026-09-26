// spec §14: "ไม่มีพื้นที่ใดบนจอมี relative luminance เกิน 0.35" — no AREA of
// the screen exceeds relative luminance 0.35 (checked via screenshot
// sampling). "พื้นที่" (area) is deliberate: this is a grid of small
// block averages, not single-pixel samples, so a handful of physically
// bright pixels (a firefly, a star) get averaged into their dark
// surroundings like the eye actually perceives them, rather than each
// tiny point-light failing the whole scene on its own.
import { PNG } from 'pngjs';

export interface LuminanceSample {
  x: number;
  y: number;
  luminance: number;
}

function srgbChannelToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of one pixel, 0 (black) .. 1 (white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

const DEFAULT_GRID_SIZE = 8;
const BLOCK_SIZE_FRACTION = 0.05;

/**
 * Decodes a PNG screenshot and averages relative luminance over a
 * `gridSize` x `gridSize` grid of square blocks (each block ~5% of the
 * image's shorter dimension) spanning the image.
 */
export function sampleLuminanceGrid(
  pngBuffer: Buffer,
  gridSize: number = DEFAULT_GRID_SIZE,
): LuminanceSample[] {
  const png = PNG.sync.read(pngBuffer);
  const blockRadius = Math.max(
    1,
    Math.round(Math.min(png.width, png.height) * BLOCK_SIZE_FRACTION),
  );
  const samples: LuminanceSample[] = [];

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const cx = Math.min(png.width - 1, Math.round(((gx + 0.5) * png.width) / gridSize));
      const cy = Math.min(png.height - 1, Math.round(((gy + 0.5) * png.height) / gridSize));

      let total = 0;
      let count = 0;
      for (
        let y = Math.max(0, cy - blockRadius);
        y <= Math.min(png.height - 1, cy + blockRadius);
        y++
      ) {
        for (
          let x = Math.max(0, cx - blockRadius);
          x <= Math.min(png.width - 1, cx + blockRadius);
          x++
        ) {
          const idx = (png.width * y + x) << 2;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          if (r === undefined || g === undefined || b === undefined) continue;
          total += relativeLuminance(r, g, b);
          count++;
        }
      }
      samples.push({ x: cx, y: cy, luminance: count > 0 ? total / count : 0 });
    }
  }

  return samples;
}
