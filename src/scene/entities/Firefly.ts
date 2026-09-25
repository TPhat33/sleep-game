// Thin Pixi view for one firefly — spec §8: 8-12 fireflies whose brightness
// follows the breath sinusoid (scene/model/breath.ts computes the value;
// this class only maps it to alpha).
import { Container, Graphics } from 'pixi.js';

import { clamp } from '../../core/time';
import { PALETTE } from '../palette';

const RADIUS_PX = 4;
const MIN_ALPHA = 0.15;
const MAX_ALPHA = 0.9;

export class FireflyEntity extends Container {
  private readonly dot = new Graphics().circle(0, 0, RADIUS_PX).fill(PALETTE.firefly);

  constructor() {
    super();
    this.addChild(this.dot);
  }

  /** `brightness` is scene/model/breath.ts's breathBrightness() output, 0..1. */
  setBrightness(brightness: number): void {
    this.alpha = MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * clamp(brightness, 0, 1);
  }

  setPosition(x: number, y: number): void {
    this.position.set(x, y);
  }
}
