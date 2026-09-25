import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { DB_VERSION, openAppDb } from '@/store/db';
import type { FireflyPondDB } from '@/store/db';
import type { IDBPDatabase } from 'idb';

let openDbs: IDBPDatabase<FireflyPondDB>[] = [];

afterEach(() => {
  for (const db of openDbs) db.close();
  openDbs = [];
});

async function freshDb(): Promise<IDBPDatabase<FireflyPondDB>> {
  const db = await openAppDb(`test-${Math.random().toString(36).slice(2)}`);
  openDbs.push(db);
  return db;
}

describe('openAppDb', () => {
  it('creates all five v1 stores', async () => {
    const db = await freshDb();
    expect(Array.from(db.objectStoreNames).sort()).toEqual([
      'jar',
      'progress',
      'sessions',
      'settings',
      'surveys',
    ]);
    expect(db.version).toBe(DB_VERSION);
  });

  it('sessions is keyed by id and has a by-endedAt index', async () => {
    const db = await freshDb();
    await db.put('sessions', {
      id: 'a',
      startedAt: 0,
      endedAt: 100,
      endReason: 'user_exit',
      nightWake: false,
      phaseDurationsMs: {},
      minutesToFade: null,
      peakDrowsiness: 0,
      listenUsed: false,
      gentleExitShown: false,
      starsEarned: 0,
    });
    const byId = await db.get('sessions', 'a');
    expect(byId?.endedAt).toBe(100);
    const byIndex = await db.getAllFromIndex('sessions', 'by-endedAt');
    expect(byIndex).toHaveLength(1);
  });

  it('jar has a by-createdAt index', async () => {
    const db = await freshDb();
    await db.put('jar', { id: 'j1', createdAt: 500, items: ['whale'] });
    const byIndex = await db.getAllFromIndex('jar', 'by-createdAt');
    expect(byIndex).toHaveLength(1);
  });

  it('settings and progress are single-record stores keyed "main"', async () => {
    const db = await freshDb();
    await db.put(
      'settings',
      {
        enabledLayers: ['rain'],
        voiceEnabled: true,
        breathCueEnabled: false,
        listenDefaultMinutes: 60,
        sleepLatencyBucket: null,
        analyticsOptIn: false,
      },
      'main',
    );
    const settings = await db.get('settings', 'main');
    expect(settings?.listenDefaultMinutes).toBe(60);
  });

  it('surveys is keyed by date', async () => {
    const db = await freshDb();
    await db.put('surveys', { date: '2026-01-15', easeOfSleep: 4, answeredAt: 123 }, '2026-01-15');
    const survey = await db.get('surveys', '2026-01-15');
    expect(survey?.easeOfSleep).toBe(4);
  });

  it('re-opening the same database name does not re-run migrations', async () => {
    const name = `test-${Math.random().toString(36).slice(2)}`;
    const db1 = await openAppDb(name);
    openDbs.push(db1);
    await db1.put('jar', { id: 'x', createdAt: 1, items: ['ร่ม'] });
    db1.close();

    const db2 = await openAppDb(name);
    openDbs.push(db2);
    const record = await db2.get('jar', 'x');
    expect(record?.items).toEqual(['ร่ม']);
  });
});
