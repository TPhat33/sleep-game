// Content-validation tests, spec §15: dreams.json (30 items, 10 per color,
// sprites present under public/), words.th.json (~150 unique Thai-script
// concrete nouns), constellations.json (stars.length === STARS_PER_CONSTELLATION,
// normalized positions) and visitors.json (sprites present under public/).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import dreams from '@/content/dreams.json';
import words from '@/content/words.th.json';
import constellations from '@/content/constellations.json';
import visitors from '@/content/visitors.json';
import { CONFIG } from '@/core/config';
import type { ConstellationDef, DreamColor, DreamDef, VisitorDef } from '@/core/types';

const PUBLIC_DIR = fileURLToPath(new URL('../../../public/', import.meta.url));
const DREAM_COLORS: readonly DreamColor[] = ['amber', 'ember', 'moss'];
const THAI_ONLY = /^[฀-๿]+$/;

function assertUniqueIds(items: readonly { id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    expect(seen.has(item.id)).toBe(false);
    seen.add(item.id);
  }
}

describe('content: dreams.json', () => {
  const typedDreams = dreams as DreamDef[];

  it('has exactly 30 items', () => {
    expect(typedDreams).toHaveLength(30);
  });

  it('has exactly 10 items per color', () => {
    for (const color of DREAM_COLORS) {
      expect(typedDreams.filter((d) => d.color === color)).toHaveLength(10);
    }
  });

  it('has unique, non-empty ids and Thai names', () => {
    assertUniqueIds(typedDreams);
    for (const d of typedDreams) {
      expect(d.id.length).toBeGreaterThan(0);
      expect(d.nameTh.length).toBeGreaterThan(0);
    }
  });

  it('only uses defined DreamColor values', () => {
    for (const d of typedDreams) {
      expect(DREAM_COLORS).toContain(d.color);
    }
  });

  it('points every sprite at /dreams/<id>.svg, and the file exists under public/', () => {
    for (const d of typedDreams) {
      expect(d.sprite).toBe(`/dreams/${d.id}.svg`);
      expect(existsSync(PUBLIC_DIR + d.sprite.slice(1))).toBe(true);
    }
  });
});

describe('content: words.th.json', () => {
  const typedWords = words;

  it('has about 150 words (spec §15)', () => {
    expect(typedWords.length).toBe(150);
  });

  it('is unique and non-empty', () => {
    expect(new Set(typedWords).size).toBe(typedWords.length);
    for (const w of typedWords) {
      expect(w.length).toBeGreaterThan(0);
    }
  });

  it('is Thai script only (no Latin letters, digits, or punctuation)', () => {
    for (const w of typedWords) {
      expect(w).toMatch(THAI_ONLY);
    }
  });
});

describe('content: constellations.json', () => {
  const typedConstellations = constellations as ConstellationDef[];

  it('has at least one constellation', () => {
    expect(typedConstellations.length).toBeGreaterThan(0);
  });

  it('has unique, non-empty ids and Thai names', () => {
    assertUniqueIds(typedConstellations);
    for (const c of typedConstellations) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.nameTh.length).toBeGreaterThan(0);
    }
  });

  it('gives every constellation exactly CONFIG.meta.STARS_PER_CONSTELLATION stars', () => {
    for (const c of typedConstellations) {
      expect(c.stars).toHaveLength(CONFIG.meta.STARS_PER_CONSTELLATION);
    }
  });

  it('keeps every star position normalized within [0, 1]', () => {
    for (const c of typedConstellations) {
      for (const star of c.stars) {
        expect(star.x).toBeGreaterThanOrEqual(0);
        expect(star.x).toBeLessThanOrEqual(1);
        expect(star.y).toBeGreaterThanOrEqual(0);
        expect(star.y).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('content: visitors.json', () => {
  const typedVisitors = visitors as VisitorDef[];

  it('has at least one visitor', () => {
    expect(typedVisitors.length).toBeGreaterThan(0);
  });

  it('has unique, non-empty ids and Thai names', () => {
    assertUniqueIds(typedVisitors);
    for (const v of typedVisitors) {
      expect(v.id.length).toBeGreaterThan(0);
      expect(v.nameTh.length).toBeGreaterThan(0);
    }
  });

  it('points every sprite at /visitors/<id>.svg, and the file exists under public/', () => {
    for (const v of typedVisitors) {
      expect(v.sprite).toBe(`/visitors/${v.id}.svg`);
      expect(existsSync(PUBLIC_DIR + v.sprite.slice(1))).toBe(true);
    }
  });
});
