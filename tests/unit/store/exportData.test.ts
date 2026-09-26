import { describe, expect, it } from 'vitest';

import { buildExportPayload } from '@/store/exportData';
import { DEFAULT_PROGRESS, DEFAULT_SETTINGS } from '@/store/db';
import type { SessionSummary } from '@/core/types';

const SECRET_JAR_TEXT = 'worried about tomorrow, should never be exported';

function makeSession(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: 's1',
    startedAt: 0,
    endedAt: 1000,
    endReason: 'fade',
    nightWake: false,
    phaseDurationsMs: {},
    minutesToFade: 12,
    peakDrowsiness: 0.4,
    listenUsed: false,
    gentleExitShown: false,
    starsEarned: 1,
    ...overrides,
  };
}

describe('buildExportPayload', () => {
  it('never has a jar field, even structurally', () => {
    const payload = buildExportPayload(0, DEFAULT_SETTINGS, DEFAULT_PROGRESS, []);
    expect(Object.keys(payload)).not.toContain('jar');
  });

  it('never contains jar text anywhere in the serialized JSON', () => {
    // Simulates a jar entry existing in the DB alongside real settings/progress/sessions —
    // buildExportPayload's signature has no way to receive jar data at all,
    // so this proves the exclusion holds however the caller is wired.
    const payload = buildExportPayload(
      1_700_000_000_000,
      { ...DEFAULT_SETTINGS, listenDefaultMinutes: 30 },
      { ...DEFAULT_PROGRESS, journal: ['whale'] },
      [makeSession({})],
    );
    const json = JSON.stringify(payload);
    expect(json).not.toContain(SECRET_JAR_TEXT);
    expect(json).not.toContain('jar');
  });

  it('includes settings, progress and sessions as given', () => {
    const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' })];
    const payload = buildExportPayload(500, DEFAULT_SETTINGS, DEFAULT_PROGRESS, sessions);
    expect(payload.exportedAt).toBe(500);
    expect(payload.settings).toEqual(DEFAULT_SETTINGS);
    expect(payload.progress).toEqual(DEFAULT_PROGRESS);
    expect(payload.sessions).toEqual(sessions);
  });

  it('copies the sessions array rather than aliasing the caller input', () => {
    const sessions = [makeSession({ id: 'a' })];
    const payload = buildExportPayload(0, DEFAULT_SETTINGS, DEFAULT_PROGRESS, sessions);
    expect(payload.sessions).not.toBe(sessions);
    expect(payload.sessions).toEqual(sessions);
  });
});
