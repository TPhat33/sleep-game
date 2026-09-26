// The only code (besides db.ts) that touches IndexedDB. Takes a Clock for
// timestamps and retention purges, per plan §2.2.

import type { IDBPDatabase } from 'idb';

import type { Clock } from '../core/clock';
import type { LastSessionInfo, SessionSummary } from '../core/types';
import type {
  EaseOfSleepRating,
  HushglowDB,
  JarRecord,
  ProgressRecord,
  SettingsRecord,
  SurveyRecord,
} from './db';
import { DEFAULT_PROGRESS, DEFAULT_SETTINGS } from './db';

export class SettingsRepository {
  constructor(private readonly db: IDBPDatabase<HushglowDB>) {}

  async get(): Promise<SettingsRecord> {
    const record = await this.db.get('settings', 'main');
    return record ?? DEFAULT_SETTINGS;
  }

  async update(patch: Partial<SettingsRecord>): Promise<SettingsRecord> {
    const current = await this.get();
    const next: SettingsRecord = { ...current, ...patch };
    await this.db.put('settings', next, 'main');
    return next;
  }
}

export class ProgressRepository {
  constructor(private readonly db: IDBPDatabase<HushglowDB>) {}

  async get(): Promise<ProgressRecord> {
    const record = await this.db.get('progress', 'main');
    return record ?? DEFAULT_PROGRESS;
  }

  private async update(patch: Partial<ProgressRecord>): Promise<ProgressRecord> {
    const current = await this.get();
    const next: ProgressRecord = { ...current, ...patch };
    await this.db.put('progress', next, 'main');
    return next;
  }

  async addStar(star: ProgressRecord['stars'][number]): Promise<ProgressRecord> {
    const current = await this.get();
    return this.update({ stars: [...current.stars, star] });
  }

  async completeConstellation(constellationId: string): Promise<ProgressRecord> {
    const current = await this.get();
    if (current.completedConstellations.includes(constellationId)) return current;
    return this.update({
      completedConstellations: [...current.completedConstellations, constellationId],
    });
  }

  async addJournalEntry(dreamId: string): Promise<ProgressRecord> {
    const current = await this.get();
    if (current.journal.includes(dreamId)) return current;
    return this.update({ journal: [...current.journal, dreamId] });
  }

  async addVisitor(visitorId: string): Promise<ProgressRecord> {
    const current = await this.get();
    if (current.visitors.includes(visitorId)) return current;
    return this.update({ visitors: [...current.visitors, visitorId] });
  }

  async setPendingVisitor(visitorId: string | null): Promise<ProgressRecord> {
    return this.update({ pendingVisitor: visitorId });
  }
}

export class SessionsRepository {
  constructor(
    private readonly db: IDBPDatabase<HushglowDB>,
    private readonly ids: () => string,
  ) {}

  async writeProvisional(session: {
    id: string;
    startedAt: number;
    nightWake: boolean;
    backgroundedAt: number;
  }): Promise<void> {
    const provisional: SessionSummary = {
      id: session.id,
      startedAt: session.startedAt,
      endedAt: session.backgroundedAt,
      endReason: 'app_background',
      nightWake: session.nightWake,
      phaseDurationsMs: {},
      minutesToFade: null,
      peakDrowsiness: 0,
      listenUsed: false,
      gentleExitShown: false,
      starsEarned: 0,
    };
    await this.db.put('sessions', provisional);
  }

  async finalize(summary: SessionSummary): Promise<void> {
    await this.db.put('sessions', summary);
  }

  async deleteProvisional(id: string): Promise<void> {
    await this.db.delete('sessions', id);
  }

  async getLastSession(): Promise<LastSessionInfo | null> {
    const cursor = await this.db
      .transaction('sessions')
      .store.index('by-endedAt')
      .openCursor(null, 'prev');
    if (!cursor) return null;
    return { endedAt: cursor.value.endedAt, endReason: cursor.value.endReason };
  }

  async list(): Promise<SessionSummary[]> {
    return this.db.getAllFromIndex('sessions', 'by-endedAt');
  }

  newId(): string {
    return this.ids();
  }
}

export class JarRepository {
  constructor(
    private readonly db: IDBPDatabase<HushglowDB>,
    private readonly clock: Clock,
    private readonly ids: () => string,
  ) {}

  async addEntry(items: readonly string[]): Promise<JarRecord> {
    const record: JarRecord = { id: this.ids(), createdAt: this.clock.now(), items: [...items] };
    await this.db.put('jar', record);
    return record;
  }

  async list(): Promise<JarRecord[]> {
    return this.db.getAllFromIndex('jar', 'by-createdAt');
  }

  /** Deletes jar records older than `retentionDays`. Never exposes their contents — spec §11. */
  async purgeOld(retentionDays: number): Promise<number> {
    const cutoff = this.clock.now() - retentionDays * 24 * 60 * 60_000;
    const tx = this.db.transaction('jar', 'readwrite');
    let cursor = await tx.store.index('by-createdAt').openCursor();
    let purged = 0;
    while (cursor) {
      if (cursor.value.createdAt < cutoff) {
        await cursor.delete();
        purged++;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return purged;
  }
}

export class SurveysRepository {
  constructor(private readonly db: IDBPDatabase<HushglowDB>) {}

  async get(dateKey: string): Promise<SurveyRecord | null> {
    const record = await this.db.get('surveys', dateKey);
    return record ?? null;
  }

  async answer(
    dateKey: string,
    easeOfSleep: EaseOfSleepRating,
    answeredAt: number,
  ): Promise<SurveyRecord> {
    const record: SurveyRecord = { date: dateKey, easeOfSleep, answeredAt };
    await this.db.put('surveys', record, dateKey);
    return record;
  }
}

export class Repositories {
  readonly settings: SettingsRepository;
  readonly progress: ProgressRepository;
  readonly sessions: SessionsRepository;
  readonly jar: JarRepository;
  readonly surveys: SurveysRepository;

  constructor(db: IDBPDatabase<HushglowDB>, clock: Clock, ids: () => string) {
    this.settings = new SettingsRepository(db);
    this.progress = new ProgressRepository(db);
    this.sessions = new SessionsRepository(db, ids);
    this.jar = new JarRepository(db, clock, ids);
    this.surveys = new SurveysRepository(db);
  }
}
