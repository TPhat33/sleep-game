// Thin Pixi view for a star rising out of a filled boat — spec §8:
// "ปล่อย Star ลอยขึ้นใน STAR_RISE_MS แบบ ease-out". The caller drives
// `setRiseProgress()` with a linear 0..1 fraction of STAR_RISE_MS elapsed;
// this class applies the ease-out curve and golden-vs-normal color.
import { Container, Graphics } from 'pixi.js';

import { clamp, easeOut, lerp } from '../../core/time';
import { PALETTE } from '../palette';

const RADIUS_PX = 8;

export class StarEntity extends Container {
  private readonly glyph: Graphics;

  constructor(golden: boolean) {
    super();
    this.glyph = new Graphics()
      .circle(0, 0, RADIUS_PX)
      .fill(golden ? PALETTE.gold : PALETTE.firefly);
    this.addChild(this.glyph);
  }

  /** `progress` is linear 0..1 through STAR_RISE_MS; rises from (x, yStart) to (x, yEnd) with an ease-out curve. */
  setRiseProgress(progress: number, x: number, yStart: number, yEnd: number): void {
    const eased = easeOut(clamp(progress, 0, 1));
    this.position.set(x, lerp(yStart, yEnd, eased));
  }
}
