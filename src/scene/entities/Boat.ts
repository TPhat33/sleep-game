// Thin Pixi view for one boat — spec §8: 3 boats (amber/ember/moss) at the
// bottom edge, each holding BOAT_CAPACITY dreams; full boats glow. The
// caller (PondScene, task 27) owns capacity/fill state from PondModel and
// just calls setFill() each time it changes.
import { Container, Graphics } from 'pixi.js';

import type { DreamColor } from '../../core/types';
import { PALETTE, dreamColorHex } from '../palette';

const HULL_WIDTH = 90;
const HULL_HEIGHT = 34;
const HULL_RADIUS = 10;
const PIP_RADIUS = 6;
const PIP_SPACING = 22;
const DIM_ALPHA = 0.85;
const GLOW_ALPHA = 1;
const FILLED_ALPHA = 1;
const EMPTY_ALPHA = 0.35;

export class BoatEntity extends Container {
  private readonly hull = new Graphics();
  private readonly pips = new Graphics();

  constructor(
    private readonly color: DreamColor,
    private readonly capacity: number,
  ) {
    super();
    this.addChild(this.hull, this.pips);
    this.setFill(0);
  }

  /** `count` is 0..capacity; `glowing` is true briefly right after the boat fills (before it visually resets). */
  setFill(count: number, glowing = false): void {
    const hex = dreamColorHex(this.color);
    this.hull
      .clear()
      .roundRect(-HULL_WIDTH / 2, -HULL_HEIGHT / 2, HULL_WIDTH, HULL_HEIGHT, HULL_RADIUS)
      .fill({ color: hex, alpha: glowing ? GLOW_ALPHA : DIM_ALPHA });

    this.pips.clear();
    const offset = (this.capacity - 1) / 2;
    for (let i = 0; i < this.capacity; i++) {
      const filled = i < count;
      this.pips
        .circle((i - offset) * PIP_SPACING, 0, PIP_RADIUS)
        .fill({ color: PALETTE.firefly, alpha: filled ? FILLED_ALPHA : EMPTY_ALPHA });
    }
  }

  setPosition(x: number, y: number): void {
    this.position.set(x, y);
  }
}
