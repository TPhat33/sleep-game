// IndexedDB schema — spec §11. `idb`'s typed DBSchema plus an ordered
// migration array (index i upgrades i -> i+1); all five v1 stores are
// created up front so no pre-release migration is ever needed (plan §2.2).
// This file and repositories.ts are the only code that touches the DB.

import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import { openDB } from 'idb';

import type { BedLayerId, SessionSummary } from '../core/types';

export const DB_NAME = 'hushglow';
export const DB_VERSION = 1;

export type SleepLatencyBucket = '<15' | '15-30' | '>30';

export interface SettingsRecord {
  enabledLayers: BedLayerId[];
  voiceEnabled: boolean;
  breathCueEnabled: boolean;
  listenDefaultMinutes: number;
  sleepLatencyBucket: SleepLatencyBucket | null;
  analyticsOptIn: boolean;
}

export interface StarRecord {
  constellationId: string;
  index: number;
  golden: boolean;
}

export interface ProgressRecord {
  stars: StarRecord[];
  completedConstellations: string[];
  /** Dream ids the player has seen. */
  journal: string[];
  visitors: string[];
  pendingVisitor: string | null;
}

export interface JarRecord {
  id: string;
  createdAt: number;
  items: string[];
}

export type EaseOfSleepRating = 1 | 2 | 3 | 4 | 5;

export interface SurveyRecord {
  date: string;
  easeOfSleep: EaseOfSleepRating;
  answeredAt: number;
}

export interface HushglowDB extends DBSchema {
  settings: {
    key: 'main';
    value: SettingsRecord;
  };
  progress: {
    key: 'main';
    value: ProgressRecord;
  };
  sessions: {
    key: string;
    value: SessionSummary;
    indexes: { 'by-endedAt': number };
  };
  jar: {
    key: string;
    value: JarRecord;
    indexes: { 'by-createdAt': number };
  };
  surveys: {
    key: string;
    value: SurveyRecord;
  };
}

type UpgradeTransaction = IDBPTransaction<
  HushglowDB,
  StoreNames<HushglowDB>[],
  'versionchange'
>;
type Migration = (db: IDBPDatabase<HushglowDB>, tx: UpgradeTransaction) => void;

export const MIGRATIONS: readonly Migration[] = [
  (db) => {
    db.createObjectStore('settings');
    db.createObjectStore('progress');
    db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('by-endedAt', 'endedAt');
    db.createObjectStore('jar', { keyPath: 'id' }).createIndex('by-createdAt', 'createdAt');
    db.createObjectStore('surveys');
  },
];

export function openAppDb(name: string = DB_NAME): Promise<IDBPDatabase<HushglowDB>> {
  return openDB<HushglowDB>(name, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      const target = newVersion ?? MIGRATIONS.length;
      for (const migrate of MIGRATIONS.slice(oldVersion, target)) {
        migrate(db, transaction);
      }
    },
  });
}

export const DEFAULT_SETTINGS: SettingsRecord = {
  // [ADDITION] brownNoise is the only bed layer synthesized in-process
  // (AudioEngine + renderBrownNoise) rather than loaded from a file, so
  // it has no asset-loading dependency at all — the safest default while
  // rain/crickets/asmrTaps are still placeholder audio (scripts/gen-
  // placeholder-audio.mjs), not real recorded content.
  enabledLayers: ['brownNoise'],
  voiceEnabled: true,
  breathCueEnabled: false,
  listenDefaultMinutes: 60,
  sleepLatencyBucket: null,
  analyticsOptIn: false,
};

export const DEFAULT_PROGRESS: ProgressRecord = {
  stars: [],
  completedConstellations: [],
  journal: [],
  visitors: [],
  pendingVisitor: null,
};
