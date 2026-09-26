import { describe, expect, it } from 'vitest';

import { computeSessionStats } from '@/core/sessionStats';
import type { SessionSummary } from '@/core/types';

function makeSession(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: 's',
    startedAt: 0,
    endedAt: 1000,
    endReason: 'fade',
    nightWake: false,
    phaseDurationsMs: {},
    minutesToFade: null,
    peakDrowsiness: 0,
    listenUsed: false,
    gentleExitShown: false,
    starsEarned: 0,
    ...overrides,
  };
}

describe('computeSessionStats', () => {
  it('handles an empty sessions list without throwing', () => {
    const stats = computeSessionStats([]);
    expect(stats.overall).toEqual({
      sessionCount: 0,
      averageMinutesToFade: null,
      fadeRate: 0,
      listenRate: 0,
    });
    expect(stats.byBucket).toEqual([
      { bucket: 'normal', sessionCount: 0, averageMinutesToFade: null, fadeRate: 0, listenRate: 0 },
      {
        bucket: 'night_wake',
        sessionCount: 0,
        averageMinutesToFade: null,
        fadeRate: 0,
        listenRate: 0,
      },
    ]);
  });

  it('averages minutesToFade only over sessions that have it', () => {
    const sessions = [
      makeSession({ endReason: 'fade', minutesToFade: 10 }),
      makeSession({ endReason: 'fade', minutesToFade: 20 }),
      makeSession({ endReason: 'listen_timer', minutesToFade: null }),
    ];
    const stats = computeSessionStats(sessions);
    expect(stats.overall.averageMinutesToFade).toBe(15);
  });

  it('computes fadeRate and listenRate as fractions of all sessions', () => {
    const sessions = [
      makeSession({ endReason: 'fade' }),
      makeSession({ endReason: 'fade' }),
      makeSession({ endReason: 'listen_timer' }),
      makeSession({ endReason: 'user_exit' }),
    ];
    const stats = computeSessionStats(sessions);
    expect(stats.overall.sessionCount).toBe(4);
    expect(stats.overall.fadeRate).toBe(0.5);
    expect(stats.overall.listenRate).toBe(0.25);
  });

  it('splits sessions into normal and night_wake buckets', () => {
    const sessions = [
      makeSession({ nightWake: false, endReason: 'fade', minutesToFade: 8 }),
      makeSession({ nightWake: false, endReason: 'fade', minutesToFade: 12 }),
      makeSession({ nightWake: true, endReason: 'listen_timer' }),
    ];
    const stats = computeSessionStats(sessions);
    const normal = stats.byBucket.find((b) => b.bucket === 'normal');
    const nightWake = stats.byBucket.find((b) => b.bucket === 'night_wake');

    expect(normal).toMatchObject({ sessionCount: 2, averageMinutesToFade: 10, fadeRate: 1 });
    expect(nightWake).toMatchObject({
      sessionCount: 1,
      averageMinutesToFade: null,
      listenRate: 1,
    });
  });
});
