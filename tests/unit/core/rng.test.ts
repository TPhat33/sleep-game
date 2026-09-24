import { describe, expect, it } from 'vitest';

import { pickNoRepeat, randInt, randRange, seededRng, systemRng } from '@/core/rng';

describe('systemRng', () => {
  it('produces values in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = systemRng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seededRng', () => {
  it('is deterministic: the same seed gives the same sequence', () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds give different sequences', () => {
    const a = seededRng(1);
    const b = seededRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('stays within [0, 1) over 100,000 draws', () => {
    const rng = seededRng(7);
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('randRange', () => {
  it('stays within [min, max)', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 1000; i++) {
      const v = randRange(rng, [10, 20]);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });
});

describe('randInt', () => {
  it('stays within [min, maxInclusive] and hits both ends over many draws', () => {
    const rng = seededRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = randInt(rng, 0, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('pickNoRepeat', () => {
  it('never returns a recent index while an alternative exists', () => {
    const rng = seededRng(11);
    const items = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 1000; i++) {
      const recent = [0, 1, 2, 3];
      const idx = pickNoRepeat(rng, items, recent);
      expect(recent).not.toContain(idx);
    }
  });

  it('falls back to any index when all are excluded', () => {
    const rng = seededRng(13);
    const items = ['a', 'b', 'c'];
    const recent = [0, 1, 2];
    const idx = pickNoRepeat(rng, items, recent);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThanOrEqual(2);
  });

  it('throws for an empty items array', () => {
    const rng = seededRng(1);
    expect(() => pickNoRepeat(rng, [], [])).toThrow();
  });
});
