// Thin Pixi view for one floating dream — renders PondModel.DreamInstance
// state each frame. All gameplay rules (spawn/despawn/tap resolution) live
// in scene/model/PondModel.ts; this class only draws. Spec §8: no screen
// shake, no particle bursts.
import { Container, Graphics, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';

import type { DreamColor } from '../../core/types';
import { dreamColorHex } from '../palette';

const RADIUS_PX = 22;
const HIGHLIGHT_ALPHA = 0.35;

export class DreamEntity extends Container {
  constructor(color: DreamColor, texture?: Texture) {
    super();
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.width = RADIUS_PX * 2;
      sprite.height = RADIUS_PX * 2;
      this.addChild(sprite);
    } else {
      const hex = dreamColorHex(color);
      const graphic = new Graphics()
        .circle(0, 0, RADIUS_PX)
        .fill(hex)
        .circle(-RADIUS_PX * 0.25, -RADIUS_PX * 0.3, RADIUS_PX * 0.3)
        .fill({ color: hex, alpha: HIGHLIGHT_ALPHA });
      this.addChild(graphic);
    }
  }

  setPosition(x: number, y: number): void {
    this.position.set(x, y);
  }
}
