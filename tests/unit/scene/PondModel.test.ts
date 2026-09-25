import { describe, expect, it } from 'vitest';

import dreams from '@/content/dreams.json';
import { CONFIG } from '@/core/config';
import { seededRng } from '@/core/rng';
import type { DreamDef } from '@/core/types';
import { DREAM_COLORS, PondModel } from '@/scene/model/PondModel';
import type { PondModelDeps } from '@/scene/model/PondModel';

const typedDreams = dreams as DreamDef[];

function makeDefs(count: number): DreamDef[] {
  const colors: DreamDef['color'][] = ['amber', 'ember', 'moss'];
  return Array.from({ length: count }, (_, i) => ({
    id: `d${String(i)}`,
    nameTh: `ของฝัน${String(i)}`,
    color: colors[i % colors.length] ?? 'amber',
    sprite: `/dreams/d${String(i)}.svg`,
  }));
}

function makeModel(overrides?: Partial<PondModelDeps['cfg']>, defs = makeDefs(10)): PondModel {
  const cfg: PondModelDeps['cfg'] = {
    MAX_DREAMS_ON_SCREEN: 6,
    NO_REPEAT_WINDOW: 4,
    RESPAWN_DELAY_MS: [10_000, 20_000],
    BOAT_CAPACITY: 3,
    BREATH_PERIOD_MS: 10_000,
    BREATH_TOLERANCE_MS: 600,
    ...overrides,
  };
  return new PondModel({ rng: seededRng(1), dreams: defs, cfg });
}

describe('PondModel.trySpawn', () => {
  it('spawns a dream at t=0 when there is room', () => {
    const model = makeModel();
    const instance = model.trySpawn(0);
    expect(instance).not.toBeNull();
    expect(instance?.t).toBe(0);
    expect(model.activeDreams).toHaveLength(1);
  });

  it('refuses to spawn past MAX_DREAMS_ON_SCREEN', () => {
    const model = makeModel({ MAX_DREAMS_ON_SCREEN: 2 });
    expect(model.trySpawn(0)).not.toBeNull();
    expect(model.trySpawn(0)).not.toBeNull();
    expect(model.trySpawn(0)).toBeNull();
    expect(model.activeDreams).toHaveLength(2);
  });

  it('never repeats a def within the last NO_REPEAT_WINDOW spawns', () => {
    const model = makeModel({ NO_REPEAT_WINDOW: 4, MAX_DREAMS_ON_SCREEN: 6 });
    const picks: string[] = [];
    for (let i = 0; i < 40; i++) {
      const instance = model.trySpawn(i);
      expect(instance).not.toBeNull();
      picks.push(instance?.defId ?? '');
      model.tapDream(instance?.instanceId ?? '', i); // resolve immediately so there's always room
    }
    for (let i = 0; i < picks.length; i++) {
      const windowStart = Math.max(0, i - 4);
      const recentWindow = picks.slice(windowStart, i);
      expect(recentWindow).not.toContain(picks[i]);
    }
  });

  it('assigns unique, sequential instance ids', () => {
    const model = makeModel({ MAX_DREAMS_ON_SCREEN: 3 });
    const ids = [
      model.trySpawn(0)?.instanceId,
      model.trySpawn(0)?.instanceId,
      model.trySpawn(0)?.instanceId,
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('returns null when the dream pool is empty', () => {
    const model = makeModel(undefined, []);
    expect(model.trySpawn(0)).toBeNull();
  });
});

describe('PondModel.update', () => {
  it('advances active dreams by deltaT', () => {
    const model = makeModel();
    model.trySpawn(0);
    model.update(1000, 0.1);
    expect(model.activeDreams[0]?.t).toBeCloseTo(0.1, 6);
  });

  it('removes a dream once its t reaches 1 and reports it as exited', () => {
    const model = makeModel();
    model.trySpawn(0);
    const { exited } = model.update(1000, 1.5);
    expect(model.activeDreams).toHaveLength(0);
    expect(exited).toHaveLength(1);
  });

  it('puts an unresolved exit on cooldown, excluding it from the very next spawn pick', () => {
    // Two defs only: d0 exits unresolved, so with a cooldown active the next
    // pick must be d1 even though d0 would otherwise be a valid (non-recent) choice.
    const defs = makeDefs(2);
    const model = makeModel({ NO_REPEAT_WINDOW: 0, RESPAWN_DELAY_MS: [50_000, 50_000] }, defs);
    const first = model.trySpawn(0);
    expect(first?.defId).toBeDefined();
    model.update(0, 1.5); // exits unresolved -> cooldown until 50_000
    const second = model.trySpawn(100);
    expect(second?.defId).not.toBe(first?.defId);
  });

  it('falls back to the full pool once every def is excluded', () => {
    const defs = makeDefs(1);
    const model = makeModel({ NO_REPEAT_WINDOW: 0, RESPAWN_DELAY_MS: [50_000, 50_000] }, defs);
    model.trySpawn(0);
    model.update(0, 1.5);
    // Only one def exists and it's on cooldown — must still spawn it (fallback) rather than return null.
    const spawned = model.trySpawn(10);
    expect(spawned?.defId).toBe(defs[0]?.id);
  });
});

describe('PondModel.tapDream', () => {
  it('returns null for an id that is not active', () => {
    const model = makeModel();
    expect(model.tapDream('nope', 0)).toBeNull();
  });

  it('removes the tapped dream from active and increments its boat', () => {
    const model = makeModel();
    const instance = model.trySpawn(0);
    const result = model.tapDream(instance?.instanceId ?? '', 0);
    expect(result).not.toBeNull();
    expect(model.activeDreams).toHaveLength(0);
    expect(model.boatCounts[result?.color ?? 'amber']).toBe(1);
  });

  it('fills and resets the boat at BOAT_CAPACITY, reporting boatFilled', () => {
    const defs: DreamDef[] = [
      { id: 'a', nameTh: 'a', color: 'amber', sprite: '/dreams/a.svg' },
      { id: 'b', nameTh: 'b', color: 'amber', sprite: '/dreams/b.svg' },
      { id: 'c', nameTh: 'c', color: 'amber', sprite: '/dreams/c.svg' },
      { id: 'd', nameTh: 'd', color: 'amber', sprite: '/dreams/d.svg' },
    ];
    const model = makeModel(
      { BOAT_CAPACITY: 3, NO_REPEAT_WINDOW: 0, MAX_DREAMS_ON_SCREEN: 4 },
      defs,
    );
    const results = [];
    for (let i = 0; i < 3; i++) {
      const instance = model.trySpawn(0);
      results.push(model.tapDream(instance?.instanceId ?? '', 0));
    }
    expect(results[0]?.boatFilled).toBe(false);
    expect(results[1]?.boatFilled).toBe(false);
    expect(results[2]?.boatFilled).toBe(true);
    expect(model.boatCounts.amber).toBe(0); // reset after filling
  });

  it('marks a tap golden only within the exhale window relative to startBreath()', () => {
    const model = makeModel({ BREATH_PERIOD_MS: 10_000, BREATH_TOLERANCE_MS: 0 });
    model.startBreath(0);

    const inhale = model.trySpawn(0);
    const inhaleResult = model.tapDream(inhale?.instanceId ?? '', 2_000); // 20% through -> inhale
    expect(inhaleResult?.golden).toBe(false);

    const exhale = model.trySpawn(2_000);
    const exhaleResult = model.tapDream(exhale?.instanceId ?? '', 7_000); // 70% through -> exhale
    expect(exhaleResult?.golden).toBe(true);
  });
});

describe('PondModel: integration with real content', () => {
  it('spawns from the full 30-item dreams.json using CONFIG.scene', () => {
    const model = new PondModel({
      rng: seededRng(7),
      dreams: typedDreams,
      cfg: CONFIG.scene,
    });
    const instance = model.trySpawn(0);
    expect(instance).not.toBeNull();
    expect(DREAM_COLORS).toContain(instance?.color);
  });
});
