import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { FakeClock } from '@/core/clock';
import { openAppDb } from '@/store/db';
import type { HushglowDB } from '@/store/db';
import { Repositories } from '@/store/repositories';
import type { IDBPDatabase } from 'idb';

let openDbs: IDBPDatabase<HushglowDB>[] = [];

afterEach(() => {
  for (const db of openDbs) db.close();
  openDbs = [];
});

async function freshRepos(startEpochMs = 0): Promise<{ repos: Repositories; clock: FakeClock }> {
  const db = await openAppDb(`test-${Math.random().toString(36).slice(2)}`);
  openDbs.push(db);
  const clock = new FakeClock(startEpochMs);
  let idCounter = 0;
  const repos = new Repositories(db, clock, () => `id-${String(++idCounter)}`);
  return { repos, clock };
}

describe('SettingsRepository', () => {
  it('returns defaults when nothing is stored, and update() merges + persists', async () => {
    const { repos } = await freshRepos();
    const defaults = await repos.settings.get();
    expect(defaults.listenDefaultMinutes).toBe(60);

    const updated = await repos.settings.update({ voiceEnabled: false });
    expect(updated.voiceEnabled).toBe(false);
    expect(updated.listenDefaultMinutes).toBe(60); // untouched fields survive the merge

    const reread = await repos.settings.get();
    expect(reread.voiceEnabled).toBe(false);
  });
});

describe('ProgressRepository', () => {
  it('accumulates stars, constellations, journal entries and visitors without duplicating', async () => {
    const { repos } = await freshRepos();
    await repos.progress.addStar({ constellationId: 'c1', index: 0, golden: false });
    await repos.progress.addStar({ constellationId: 'c1', index: 1, golden: true });
    await repos.progress.completeConstellation('c1');
    await repos.progress.completeConstellation('c1'); // idempotent
    await repos.progress.addJournalEntry('whale');
    await repos.progress.addJournalEntry('whale'); // idempotent
    await repos.progress.addVisitor('v1');

    const progress = await repos.progress.get();
    expect(progress.stars).toHaveLength(2);
    expect(progress.completedConstellations).toEqual(['c1']);
    expect(progress.journal).toEqual(['whale']);
    expect(progress.visitors).toEqual(['v1']);
  });

  it('setPendingVisitor stores and clears the pending visitor', async () => {
    const { repos } = await freshRepos();
    await repos.progress.setPendingVisitor('v9');
    expect((await repos.progress.get()).pendingVisitor).toBe('v9');
    await repos.progress.setPendingVisitor(null);
    expect((await repos.progress.get()).pendingVisitor).toBeNull();
  });
});

describe('SessionsRepository', () => {
  it('writeProvisional() then deleteProvisional() leaves no trace (returned within grace)', async () => {
    const { repos } = await freshRepos();
    await repos.sessions.writeProvisional({
      id: 's1',
      startedAt: 0,
      nightWake: false,
      backgroundedAt: 500,
    });
    expect(await repos.sessions.getLastSession()).toMatchObject({
      endedAt: 500,
      endReason: 'app_background',
    });

    await repos.sessions.deleteProvisional('s1');
    expect(await repos.sessions.getLastSession()).toBeNull();
  });

  it('finalize() overwrites the provisional record with the real summary', async () => {
    const { repos } = await freshRepos();
    await repos.sessions.writeProvisional({
      id: 's1',
      startedAt: 0,
      nightWake: false,
      backgroundedAt: 500,
    });
    await repos.sessions.finalize({
      id: 's1',
      startedAt: 0,
      endedAt: 2000,
      endReason: 'fade',
      nightWake: false,
      phaseDurationsMs: { play: 2000 },
      minutesToFade: 30,
      peakDrowsiness: 0.7,
      listenUsed: false,
      gentleExitShown: false,
      starsEarned: 3,
    });
    const last = await repos.sessions.getLastSession();
    expect(last).toEqual({ endedAt: 2000, endReason: 'fade' });
  });

  it('getLastSession() returns the most recently ended session', async () => {
    const { repos } = await freshRepos();
    await repos.sessions.finalize(makeSummary('a', 1000));
    await repos.sessions.finalize(makeSummary('b', 3000));
    await repos.sessions.finalize(makeSummary('c', 2000));
    expect(await repos.sessions.getLastSession()).toMatchObject({ endedAt: 3000 });
  });

  it('list() returns all sessions', async () => {
    const { repos } = await freshRepos();
    await repos.sessions.finalize(makeSummary('a', 1000));
    await repos.sessions.finalize(makeSummary('b', 2000));
    expect(await repos.sessions.list()).toHaveLength(2);
  });
});

describe('JarRepository', () => {
  it('addEntry() stores items with the clock timestamp', async () => {
    const { repos, clock } = await freshRepos(5000);
    const entry = await repos.jar.addEntry(['whale', 'umbrella']);
    expect(entry.createdAt).toBe(5000);
    expect(entry.items).toEqual(['whale', 'umbrella']);
    clock.advance(1); // clock is otherwise unused here; just confirming the fixture works
    expect(await repos.jar.list()).toHaveLength(1);
  });

  it('purgeOld() deletes entries older than the retention window and keeps recent ones', async () => {
    const { repos, clock } = await freshRepos(0);
    await repos.jar.addEntry(['old entry']);
    clock.advance(8 * 24 * 60 * 60_000); // 8 days later
    await repos.jar.addEntry(['recent entry']);

    const purged = await repos.jar.purgeOld(7);
    expect(purged).toBe(1);
    const remaining = await repos.jar.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.items).toEqual(['recent entry']);
  });

  it('purgeOld() never exposes jar contents through its return value', async () => {
    const { repos, clock } = await freshRepos(0);
    await repos.jar.addEntry(['a secret dream note']);
    clock.advance(30 * 24 * 60 * 60_000);
    const purged = await repos.jar.purgeOld(7);
    expect(typeof purged).toBe('number');
  });
});

describe('SurveysRepository', () => {
  it('answer() then get() round-trips by date key', async () => {
    const { repos } = await freshRepos();
    await repos.surveys.answer('2026-01-15', 4, 12345);
    const survey = await repos.surveys.get('2026-01-15');
    expect(survey).toEqual({ date: '2026-01-15', easeOfSleep: 4, answeredAt: 12345 });
  });

  it('get() returns null when no survey exists for that date', async () => {
    const { repos } = await freshRepos();
    expect(await repos.surveys.get('2026-01-01')).toBeNull();
  });
});

function makeSummary(id: string, endedAt: number) {
  return {
    id,
    startedAt: 0,
    endedAt,
    endReason: 'user_exit' as const,
    nightWake: false,
    phaseDurationsMs: {},
    minutesToFade: null,
    peakDrowsiness: 0,
    listenUsed: false,
    gentleExitShown: false,
    starsEarned: 0,
  };
}
