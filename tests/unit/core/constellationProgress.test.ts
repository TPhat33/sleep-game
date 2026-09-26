import { describe, expect, it } from 'vitest';

import { nextStarSlot } from '@/core/constellationProgress';
import type { ConstellationDef } from '@/core/types';

function makeConstellation(id: string, starCount: number): ConstellationDef {
  return {
    id,
    name: id,
    stars: Array.from({ length: starCount }, () => ({ x: 0.5, y: 0.5 })),
  };
}

const CONSTELLATIONS: ConstellationDef[] = [
  makeConstellation('a', 3),
  makeConstellation('b', 2),
  makeConstellation('c', 2),
];

describe('nextStarSlot', () => {
  it('starts at the first constellation, index 0', () => {
    const slot = nextStarSlot(CONSTELLATIONS, new Set(), new Map());
    expect(slot).toEqual({ constellationId: 'a', index: 0, completesConstellation: false });
  });

  it('continues filling the current constellation at its next index', () => {
    const slot = nextStarSlot(CONSTELLATIONS, new Set(), new Map([['a', 1]]));
    expect(slot).toEqual({ constellationId: 'a', index: 1, completesConstellation: false });
  });

  it('flags completesConstellation on the last slot', () => {
    const slot = nextStarSlot(CONSTELLATIONS, new Set(), new Map([['a', 2]]));
    expect(slot).toEqual({ constellationId: 'a', index: 2, completesConstellation: true });
  });

  it('skips a completed constellation and moves to the next', () => {
    const slot = nextStarSlot(CONSTELLATIONS, new Set(['a']), new Map([['a', 3]]));
    expect(slot).toEqual({ constellationId: 'b', index: 0, completesConstellation: false });
  });

  it('returns null once every constellation is complete', () => {
    const slot = nextStarSlot(
      CONSTELLATIONS,
      new Set(['a', 'b', 'c']),
      new Map([
        ['a', 3],
        ['b', 2],
        ['c', 2],
      ]),
    );
    expect(slot).toBeNull();
  });

  it('returns null for an empty constellation list', () => {
    expect(nextStarSlot([], new Set(), new Map())).toBeNull();
  });
});
