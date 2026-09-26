import { describe, expect, it } from 'vitest';

import { VisitorReveal } from '@/app/VisitorReveal';
import { EventBus } from '@/core/events';
import type { AppEvents } from '@/core/events';
import { seededRng } from '@/core/rng';
import type { SessionSummary, VisitorDef } from '@/core/types';
import type { ProgressRecord } from '@/store/db';
import { DEFAULT_PROGRESS } from '@/store/db';

const VISITORS: VisitorDef[] = [
  { id: 'owl', name: 'Owl', sprite: '/visitors/owl.svg' },
  { id: 'moth', name: 'Moth', sprite: '/visitors/moth.svg' },
];

function createFakeProgressRepo(initial: ProgressRecord = DEFAULT_PROGRESS) {
  let record = { ...initial };
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    get(): Promise<ProgressRecord> {
      calls.push({ method: 'get', args: [] });
      return Promise.resolve(record);
    },
    setPendingVisitor(visitorId: string | null): Promise<ProgressRecord> {
      calls.push({ method: 'setPendingVisitor', args: [visitorId] });
      record = { ...record, pendingVisitor: visitorId };
      return Promise.resolve(record);
    },
    _record: () => record,
  };
}

function baseSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: 's1',
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

function createBus(): EventBus<AppEvents> {
  return new EventBus<AppEvents>({
    onError: (err) => {
      throw err;
    },
  });
}

describe('VisitorReveal', () => {
  it('ignores end reasons other than fade/listen_timer', async () => {
    const bus = createBus();
    const progress = createFakeProgressRepo();
    new VisitorReveal({
      bus,
      rng: seededRng(1),
      progress: progress as never,
      visitors: VISITORS,
      visitorChance: 1,
    });
    bus.emit('session:ended', { at: 0, summary: baseSummary({ endReason: 'user_exit' }) });
    await Promise.resolve();
    expect(progress.calls).toHaveLength(0);
  });

  it('never queues a visitor when visitorChance is 0', async () => {
    const bus = createBus();
    const progress = createFakeProgressRepo();
    new VisitorReveal({
      bus,
      rng: seededRng(1),
      progress: progress as never,
      visitors: VISITORS,
      visitorChance: 0,
    });
    bus.emit('session:ended', { at: 0, summary: baseSummary({ endReason: 'fade' }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(progress._record().pendingVisitor).toBeNull();
  });

  it('queues a visitor on a fade/listen_timer end when visitorChance is 1', async () => {
    const bus = createBus();
    const progress = createFakeProgressRepo();
    new VisitorReveal({
      bus,
      rng: seededRng(1),
      progress: progress as never,
      visitors: VISITORS,
      visitorChance: 1,
    });
    bus.emit('session:ended', { at: 0, summary: baseSummary({ endReason: 'listen_timer' }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(progress._record().pendingVisitor).not.toBeNull();
  });

  it('does not overwrite an already-pending, unrevealed visitor', async () => {
    const bus = createBus();
    const progress = createFakeProgressRepo({ ...DEFAULT_PROGRESS, pendingVisitor: 'owl' });
    new VisitorReveal({
      bus,
      rng: seededRng(1),
      progress: progress as never,
      visitors: VISITORS,
      visitorChance: 1,
    });
    bus.emit('session:ended', { at: 0, summary: baseSummary({ endReason: 'fade' }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(progress.calls.some((c) => c.method === 'setPendingVisitor')).toBe(false);
  });

  it('prefers a visitor the player has not yet collected', async () => {
    const bus = createBus();
    const progress = createFakeProgressRepo({ ...DEFAULT_PROGRESS, visitors: ['owl'] });
    new VisitorReveal({
      bus,
      rng: seededRng(1),
      progress: progress as never,
      visitors: VISITORS,
      visitorChance: 1,
    });
    bus.emit('session:ended', { at: 0, summary: baseSummary({ endReason: 'fade' }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(progress._record().pendingVisitor).toBe('moth');
  });
});
