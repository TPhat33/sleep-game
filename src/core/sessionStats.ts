// spec §12 M5 / plan §6 M5: the "สถิติของฉัน" (my stats) page, computed
// from the `sessions` store only. [ADDITION] The spec's "แยกตาม bucket"
// (broken down by bucket) doesn't say what the bucket is, and
// SessionSummary has no sleep-latency-bucket field to group by (that
// lives in settings, not per-session) — computed from sessions alone, the
// only grouping available is nightWake vs a normal session, so that's
// what "bucket" means here.

import { mean } from './drowsiness/features';
import type { SessionSummary } from './types';

export type SessionBucket = 'normal' | 'night_wake';

export interface StatsSummary {
  sessionCount: number;
  /** Average over sessions that reached fade (excludes listen-only/no-fade sessions), or null with no data. */
  averageMinutesToFade: number | null;
  /** Fraction (0..1) of sessions ending in 'fade' — i.e. falling asleep during play/drift. */
  fadeRate: number;
  /** Fraction (0..1) of sessions ending in 'listen_timer'. */
  listenRate: number;
}

export interface BucketedStats extends StatsSummary {
  bucket: SessionBucket;
}

export interface SessionStats {
  overall: StatsSummary;
  byBucket: readonly BucketedStats[];
}

function summarize(sessions: readonly SessionSummary[]): StatsSummary {
  const count = sessions.length;
  const minutesToFadeValues = sessions
    .map((s) => s.minutesToFade)
    .filter((v): v is number => v !== null);
  const fadeCount = sessions.filter((s) => s.endReason === 'fade').length;
  const listenCount = sessions.filter((s) => s.endReason === 'listen_timer').length;

  return {
    sessionCount: count,
    averageMinutesToFade: minutesToFadeValues.length > 0 ? mean(minutesToFadeValues) : null,
    fadeRate: count > 0 ? fadeCount / count : 0,
    listenRate: count > 0 ? listenCount / count : 0,
  };
}

export function computeSessionStats(sessions: readonly SessionSummary[]): SessionStats {
  const normal = sessions.filter((s) => !s.nightWake);
  const nightWake = sessions.filter((s) => s.nightWake);

  return {
    overall: summarize(sessions),
    byBucket: [
      { bucket: 'normal', ...summarize(normal) },
      { bucket: 'night_wake', ...summarize(nightWake) },
    ],
  };
}
