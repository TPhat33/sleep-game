import { describe, expect, it } from 'vitest';

import { estimatePathLengthPx, fitToViewport, pointAtT } from '@/scene/stream';

describe('pointAtT', () => {
  it('starts at the upper-right control point and ends at the lower-left one', () => {
    const start = pointAtT(0);
    const end = pointAtT(1);
    expect(start.x).toBeGreaterThan(0.8);
    expect(start.y).toBeLessThan(0.2);
    expect(end.x).toBeLessThan(0.2);
    expect(end.y).toBeGreaterThan(0.8);
  });

  it('moves monotonically from upper-right toward lower-left', () => {
    let prev = pointAtT(0);
    for (let i = 1; i <= 20; i++) {
      const next = pointAtT(i / 20);
      expect(next.x).toBeLessThanOrEqual(prev.x);
      expect(next.y).toBeGreaterThanOrEqual(prev.y);
      prev = next;
    }
  });

  it('stays within the normalized 0..1 box', () => {
    for (let i = 0; i <= 20; i++) {
      const p = pointAtT(i / 20);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('fitToViewport', () => {
  it('scales normalized coordinates to pixel coordinates', () => {
    const fit = fitToViewport(800, 400);
    expect(fit.toPixels({ x: 0.5, y: 0.5 })).toEqual({ x: 400, y: 200 });
    expect(fit.toPixels({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(fit.toPixels({ x: 1, y: 1 })).toEqual({ x: 800, y: 400 });
  });

  it('stretches independently per axis for a wide (landscape) viewport, with no aspect correction', () => {
    const portrait = fitToViewport(390, 844);
    const landscape = fitToViewport(844, 390);
    const pPortrait = portrait.toPixels(pointAtT(0.5));
    const pLandscape = landscape.toPixels(pointAtT(0.5));
    expect(pLandscape.x).toBeGreaterThan(pPortrait.x);
    expect(pLandscape.y).toBeLessThan(pPortrait.y);
  });
});

describe('estimatePathLengthPx', () => {
  it('is positive and roughly matches the straight-line distance lower bound', () => {
    const fit = fitToViewport(400, 800);
    const length = estimatePathLengthPx(fit);
    const start = fit.toPixels(pointAtT(0));
    const end = fit.toPixels(pointAtT(1));
    const straightLine = Math.hypot(end.x - start.x, end.y - start.y);
    expect(length).toBeGreaterThanOrEqual(straightLine);
    expect(length).toBeGreaterThan(0);
  });

  it('scales up for a larger viewport', () => {
    const small = estimatePathLengthPx(fitToViewport(200, 400));
    const large = estimatePathLengthPx(fitToViewport(400, 800));
    expect(large).toBeCloseTo(small * 2, 0);
  });
});
