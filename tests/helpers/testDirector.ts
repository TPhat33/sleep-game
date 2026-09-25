// Shared test rig for SessionDirector specs: wires a FakeClock, a real
// EventBus/DrowsinessEstimator/NightWakeDetector, and records every emitted
// event for assertions.
import { FakeClock } from '@/core/clock';
import { CONFIG, makeConfig } from '@/core/config';
import { DrowsinessEstimator } from '@/core/drowsiness/DrowsinessEstimator';
import { EventBus } from '@/core/events';
import type { AppEvents } from '@/core/events';
import { NightWakeDetector } from '@/core/nightwake/NightWakeDetector';
import { SessionDirector } from '@/core/session/SessionDirector';
import type { TapEvent } from '@/core/types';

export interface TestDirectorRig {
  clock: FakeClock;
  bus: EventBus<AppEvents>;
  estimator: DrowsinessEstimator;
  nightWake: NightWakeDetector;
  director: SessionDirector;
  events: { type: keyof AppEvents; payload: AppEvents[keyof AppEvents] }[];
  nextId: () => string;
}

export function createTestDirector(overrides?: Parameters<typeof makeConfig>[0]): TestDirectorRig {
  const cfg = overrides ? makeConfig(overrides) : CONFIG;
  const clock = new FakeClock(0);
  const bus = new EventBus<AppEvents>({
    onError: (err) => {
      throw err;
    },
  });
  const estimator = new DrowsinessEstimator(clock, cfg.drowsiness);
  const nightWake = new NightWakeDetector(clock, cfg.nightWake);
  const events: { type: keyof AppEvents; payload: AppEvents[keyof AppEvents] }[] = [];
  const eventTypes: (keyof AppEvents)[] = [
    'session:started',
    'phase:changed',
    'tap:recorded',
    'drowsiness:sample',
    'ui:listenOffer',
    'ui:gentleExit',
    'listen:extended',
    'app:lifecycle',
    'scene:starEarned',
    'session:ended',
  ];

  let idCounter = 0;
  const nextId = () => `session-${String(++idCounter)}`;

  const director = new SessionDirector({
    clock,
    bus,
    cfg,
    estimator,
    nightWake,
    ids: nextId,
  });

  for (const type of eventTypes) {
    bus.on(type, (payload) => {
      events.push({ type, payload });
    });
  }

  return { clock, bus, estimator, nightWake, director, events, nextId };
}

/** Feeds steady "alert" taps into the director's estimator via tap() while advancing the clock. */
export function tapSteadily(rig: TestDirectorRig, intervalMs: number, count: number): void {
  for (let i = 0; i < count; i++) {
    rig.clock.advance(intervalMs);
    rig.director.tap({ hit: true, reactionMs: 800 });
  }
}

/** Replays a fixture tap (from tests/fixtures/tapStreams.ts) through director.tap(), dropping `t`. */
export function replayTap(rig: TestDirectorRig, tap: TapEvent): void {
  if (tap.hit && tap.reactionMs !== undefined) {
    rig.director.tap({ hit: true, reactionMs: tap.reactionMs });
  } else {
    rig.director.tap({ hit: tap.hit });
  }
}
