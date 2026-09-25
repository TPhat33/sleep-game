import { describe, expect, it } from 'vitest';

import { shouldShowMorningSurvey } from '@/core/morningSurvey';
import { CONFIG } from '@/core/config';

const DAY_MS = 24 * 60 * 60_000;
const cfg = CONFIG.meta;

// 2024-01-01 is a Monday; times below are local (TZ pinned to Asia/Bangkok in vitest.config.ts).
function atHour(hour: number): number {
  return new Date(2024, 0, 1, hour, 0, 0, 0).getTime();
}

describe('shouldShowMorningSurvey', () => {
  it('is false when already answered today', () => {
    const now = atHour(8);
    const lastSession = { endedAt: now - 60_000, endReason: 'fade' as const };
    expect(shouldShowMorningSurvey(now, cfg, lastSession, true)).toBe(false);
  });

  it('is false when there is no last session', () => {
    expect(shouldShowMorningSurvey(atHour(8), cfg, null, false)).toBe(false);
  });

  it('is false when the last session ended more than 18h ago', () => {
    const now = atHour(8);
    const lastSession = { endedAt: now - 19 * 60 * 60_000, endReason: 'fade' as const };
    expect(shouldShowMorningSurvey(now, cfg, lastSession, false)).toBe(false);
  });

  it('is true within the morning window, after a recent session, unanswered', () => {
    const now = atHour(8);
    const lastSession = { endedAt: now - 60 * 60_000, endReason: 'listen_timer' as const };
    expect(shouldShowMorningSurvey(now, cfg, lastSession, false)).toBe(true);
  });

  it('is false before MORNING_SURVEY_START_HOUR', () => {
    const now = atHour(3);
    const lastSession = { endedAt: now - DAY_MS / 4, endReason: 'fade' as const };
    expect(shouldShowMorningSurvey(now, cfg, lastSession, false)).toBe(false);
  });

  it('is false at/after MORNING_SURVEY_END_HOUR', () => {
    const now = atHour(12);
    const lastSession = { endedAt: now - 60_000, endReason: 'fade' as const };
    expect(shouldShowMorningSurvey(now, cfg, lastSession, false)).toBe(false);
  });

  it('is true right at MORNING_SURVEY_START_HOUR', () => {
    const now = atHour(cfg.MORNING_SURVEY_START_HOUR);
    const lastSession = { endedAt: now - 60_000, endReason: 'fade' as const };
    expect(shouldShowMorningSurvey(now, cfg, lastSession, false)).toBe(true);
  });
});
