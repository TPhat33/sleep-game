// Morning survey gating — spec §11: "แสดงครั้งแรกที่เปิดแอประหว่าง 05:00–12:00
// หลังคืนที่มีเซสชัน ข้ามได้" (shown the first time the app opens between
// MORNING_SURVEY_START_HOUR-MORNING_SURVEY_END_HOUR after a night with a
// session; skippable). Pure so App.vue can call it without embedding
// untested gating logic in a component.

import type { MetaConfig } from './config';
import { localHour } from './time';
import type { LastSessionInfo } from './types';

/** [ADDITION] The spec doesn't define "a night with a session" precisely; a session that ended within the last 18h counts as "last night". */
const LAST_NIGHT_WINDOW_HOURS = 18;
const MINUTES_PER_HOUR = 60;
const LAST_NIGHT_WINDOW_MS = LAST_NIGHT_WINDOW_HOURS * MINUTES_PER_HOUR * 60_000;

export function shouldShowMorningSurvey(
  now: number,
  cfg: Pick<MetaConfig, 'MORNING_SURVEY_START_HOUR' | 'MORNING_SURVEY_END_HOUR'>,
  lastSession: LastSessionInfo | null,
  alreadyAnsweredToday: boolean,
): boolean {
  if (alreadyAnsweredToday) return false;
  if (!lastSession) return false;
  if (now - lastSession.endedAt > LAST_NIGHT_WINDOW_MS) return false;

  const hour = localHour(now);
  return hour >= cfg.MORNING_SURVEY_START_HOUR && hour < cfg.MORNING_SURVEY_END_HOUR;
}
