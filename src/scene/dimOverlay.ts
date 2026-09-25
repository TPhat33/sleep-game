// The black dim overlay — spec §7: "dimAlpha: ความทึบของ overlay ดำ 0..1".
// A plain DOM div over the Pixi canvas rather than a Pixi graphics node:
// it's simpler, and the canvas keeps rendering fireflies/dreams beneath it
// at full brightness so the overlay is the only thing animating opacity.
export interface DimOverlay {
  setAlpha(alpha: number): void;
  destroy(): void;
}

export function createDimOverlay(container: HTMLElement): DimOverlay {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.background = '#000000';
  el.style.pointerEvents = 'none';
  el.style.opacity = '0';
  container.appendChild(el);

  return {
    setAlpha(alpha: number): void {
      el.style.opacity = String(alpha);
    },
    destroy(): void {
      el.remove();
    },
  };
}
