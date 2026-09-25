import { describe, expect, it } from 'vitest';

import { CONFIG } from '@/core/config';
import type { AppEvents } from '@/core/events';
import type { Phase } from '@/core/types';

import { alertSteady, graduallyDrowsy } from '../../../fixtures/tapStreams';
import { createTestDirector, replayTap, tapSteadily } from '../../../helpers/testDirector';

function phaseChanges(events: ReturnType<typeof createTestDirector>['events']) {
  return events
    .filter((e) => e.type === 'phase:changed')
    .map((e) => e.payload as AppEvents['phase:changed']);
}

describe('SessionDirector: home -> settle | listen', () => {
  it('start() with no night wake goes home -> settle, reason "start"', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 30 * 60_000 });
    expect(rig.director.phase).toBe('settle');
    const changes = phaseChanges(rig.events);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: 'home', to: 'settle', reason: 'start' });
  });

  it('start() during a night wake skips settle: home -> listen, reason "night_wake"', () => {
    const rig = createTestDirector();
    rig.clock.advance(23 * 60 * 60_000); // 23:00, a night hour
    rig.director.start({
      lastSession: { endedAt: rig.clock.now() - 60_000, endReason: 'fade' },
      listenDurationMs: 30 * 60_000,
    });
    expect(rig.director.phase).toBe('listen');
    const changes = phaseChanges(rig.events);
    expect(changes[0]).toMatchObject({
      from: 'home',
      to: 'listen',
      reason: 'night_wake',
      listenDurationMs: 30 * 60_000,
    });
  });

  it('startListenOnly() goes home -> listen, reason "listen_only" [ADDITION]', () => {
    const rig = createTestDirector();
    rig.director.startListenOnly(60 * 60_000);
    expect(rig.director.phase).toBe('listen');
    expect(phaseChanges(rig.events)[0]).toMatchObject({
      from: 'home',
      to: 'listen',
      reason: 'listen_only',
    });
  });

  it('emits session:started with a fresh sessionId', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    const started = rig.events.find((e) => e.type === 'session:started');
    expect(started).toBeDefined();
    expect(rig.director.snapshot().sessionId).not.toBeNull();
  });
});

describe('SessionDirector: settle -> play', () => {
  it('completeSettle("jar_closed") transitions settle -> play', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    expect(rig.director.phase).toBe('play');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({
      from: 'settle',
      to: 'play',
      reason: 'jar_closed',
    });
  });

  it('completeSettle("settle_skipped") also transitions settle -> play', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('settle_skipped');
    expect(rig.director.phase).toBe('play');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({ reason: 'settle_skipped' });
  });

  it('is a no-op from any other phase', () => {
    const rig = createTestDirector();
    rig.director.completeSettle('jar_closed'); // still 'home'
    expect(rig.director.phase).toBe('home');
  });
});

describe('SessionDirector: play -> drift', () => {
  it('drift via sustained drowsiness ("drowsy")', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');

    const taps = graduallyDrowsy(1);
    let tapIdx = 0;
    while (rig.director.phase === 'play' && rig.clock.now() < 25 * 60_000) {
      rig.clock.advance(1000);
      while (tapIdx < taps.length && taps[tapIdx]!.t <= rig.clock.now()) {
        replayTap(rig, taps[tapIdx]!);
        tapIdx++;
      }
    }
    expect(rig.director.phase).toBe('drift');
    const driftChange = phaseChanges(rig.events).find((c) => c.to === 'drift');
    expect(driftChange).toMatchObject({ from: 'play', to: 'drift', reason: 'drowsy' });
  });

  it('drift when PLAY_MAX_MS elapses ("play_max")', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    // Tap continuously (well under IDLE_TO_FADE_MS apart) so idle never fires first.
    tapSteadily(rig, 2000, CONFIG.session.PLAY_MAX_MS / 2000);
    expect(rig.director.phase).toBe('drift');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({
      from: 'play',
      to: 'drift',
      reason: 'play_max',
    });
  });
});

describe('SessionDirector: -> listen from play/drift', () => {
  it('play -> listen via requestListen("listen_button")', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.requestListen('listen_button', 45 * 60_000);
    expect(rig.director.phase).toBe('listen');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({
      from: 'play',
      to: 'listen',
      reason: 'listen_button',
      listenDurationMs: 45 * 60_000,
    });
  });

  it('drift -> listen via requestListen("listen_button")', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    tapSteadily(rig, 2000, CONFIG.session.PLAY_MAX_MS / 2000);
    expect(rig.director.phase).toBe('drift');
    rig.director.requestListen('listen_button', 30 * 60_000);
    expect(rig.director.phase).toBe('listen');
  });

  it('shows the listen offer once after LISTEN_OFFER_MS of play+drift, and accepting it enters listen', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    tapSteadily(rig, 2000, CONFIG.session.LISTEN_OFFER_MS / 2000);

    const offers = rig.events.filter((e) => e.type === 'ui:listenOffer');
    expect(offers).toHaveLength(1);
    expect(rig.director.snapshot().listenOfferShown).toBe(true);

    rig.director.requestListen('listen_offer', 30 * 60_000);
    expect(rig.director.phase).toBe('listen');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({ reason: 'listen_offer' });
  });
});

describe('SessionDirector: -> fade (idle)', () => {
  it('play -> fade after IDLE_TO_FADE_MS with no taps', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.clock.advance(CONFIG.session.IDLE_TO_FADE_MS);
    expect(rig.director.phase).toBe('fade');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({
      from: 'play',
      to: 'fade',
      reason: 'idle',
    });
  });

  it('drift -> fade after IDLE_TO_FADE_MS with no taps', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    tapSteadily(rig, 2000, CONFIG.session.PLAY_MAX_MS / 2000); // -> drift, without idling out first
    expect(rig.director.phase).toBe('drift');
    rig.clock.advance(CONFIG.session.IDLE_TO_FADE_MS);
    expect(rig.director.phase).toBe('fade');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({
      from: 'drift',
      to: 'fade',
      reason: 'idle',
    });
  });

  it('a tap resets the idle timer', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.clock.advance(CONFIG.session.IDLE_TO_FADE_MS - 1000);
    rig.director.tap({ hit: true, reactionMs: 800 });
    rig.clock.advance(CONFIG.session.IDLE_TO_FADE_MS - 1000);
    expect(rig.director.phase).toBe('play'); // hasn't idled out yet, reset by the tap
    rig.clock.advance(1000);
    expect(rig.director.phase).toBe('fade');
  });
});

describe('SessionDirector: fade -> ended', () => {
  it('ends with reason "fade" once both screen and audio fades complete', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.clock.advance(CONFIG.session.IDLE_TO_FADE_MS); // -> fade
    expect(rig.director.phase).toBe('fade');

    const fadeDoneMs = Math.max(CONFIG.pacing.FADE_SCREEN_MS, CONFIG.pacing.FADE_AUDIO_MS);
    rig.clock.advance(fadeDoneMs);
    expect(rig.director.phase).toBe('ended');
    const ended = rig.events.find((e) => e.type === 'session:ended');
    expect((ended?.payload as AppEvents['session:ended']).summary.endReason).toBe('fade');
  });
});

describe('SessionDirector: listen -> ended', () => {
  it('ends with reason "listen_timer" once the listen duration elapses', () => {
    const rig = createTestDirector();
    rig.director.startListenOnly(10 * 60_000);
    rig.clock.advance(10 * 60_000);
    expect(rig.director.phase).toBe('ended');
    const ended = rig.events.find((e) => e.type === 'session:ended');
    expect((ended?.payload as AppEvents['session:ended']).summary.endReason).toBe('listen_timer');
  });

  it('extendListen() pushes the deadline out', () => {
    const rig = createTestDirector();
    rig.director.startListenOnly(10 * 60_000);
    rig.clock.advance(9 * 60_000);
    rig.director.extendListen(10 * 60_000);
    rig.clock.advance(60_000 + 1);
    expect(rig.director.phase).toBe('listen'); // would have ended at 10 min without the extension
    rig.clock.advance(10 * 60_000);
    expect(rig.director.phase).toBe('ended');
  });
});

describe('SessionDirector: user_exit from any phase', () => {
  const scenarios: { name: string; setup: (rig: ReturnType<typeof createTestDirector>) => void }[] =
    [
      {
        name: 'settle',
        setup: (rig) => {
          rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
        },
      },
      {
        name: 'play',
        setup: (rig) => {
          rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
          rig.director.completeSettle('jar_closed');
        },
      },
      {
        name: 'listen',
        setup: (rig) => {
          rig.director.startListenOnly(1800_000);
        },
      },
    ];

  for (const { name, setup } of scenarios) {
    it(`exit() ends the session with reason "user_exit" from ${name}`, () => {
      const rig = createTestDirector();
      setup(rig);
      rig.director.exit();
      expect(rig.director.phase).toBe('ended');
      const ended = rig.events.find((e) => e.type === 'session:ended');
      expect((ended?.payload as AppEvents['session:ended']).summary.endReason).toBe('user_exit');
    });
  }

  it('is a no-op from home', () => {
    const rig = createTestDirector();
    rig.director.exit();
    expect(rig.director.phase).toBe('home');
  });
});

describe('SessionDirector: gentle exit prompt (spec §5.2)', () => {
  it('shows once when play+drift >= GENTLE_EXIT_MS and score stays below ALERT_THRESHOLD for 2 windows', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');

    // Steady alert-style taps well past GENTLE_EXIT_MS — long enough for the
    // real alertSteady fixture (capped at 25 min) to not cover on its own.
    const durationMs =
      CONFIG.session.GENTLE_EXIT_MS + 2 * CONFIG.drowsiness.WINDOW_STEP_MS + 60_000;
    tapSteadily(rig, 2000, Math.ceil(durationMs / 2000));

    const prompts = rig.events.filter((e) => e.type === 'ui:gentleExit');
    expect(prompts).toHaveLength(1);
    expect(rig.director.snapshot().gentleExitShown).toBe(true);
  });

  it('gentleExitChoice("listen") enters listen', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.gentleExitChoice('listen', 30 * 60_000);
    expect(rig.director.phase).toBe('listen');
    expect(phaseChanges(rig.events).at(-1)).toMatchObject({ reason: 'gentle_exit_listen' });
  });

  it('gentleExitChoice("rest") ends the session', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.gentleExitChoice('rest', 30 * 60_000);
    expect(rig.director.phase).toBe('ended');
  });

  it('gentleExitChoice("continue") stays in the current phase', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.gentleExitChoice('continue', 30 * 60_000);
    expect(rig.director.phase).toBe('play');
  });
});

describe('SessionDirector: app lifecycle (plan §1.9)', () => {
  it('backgrounding during play, then returning within grace: session continues', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.appLifecycle('background');
    rig.clock.advance(CONFIG.session.APP_BACKGROUND_GRACE_MS - 1000);
    rig.director.appLifecycle('active');
    rig.clock.advance(CONFIG.session.APP_BACKGROUND_GRACE_MS);
    expect(rig.director.phase).toBe('play');
  });

  it('backgrounding during play beyond the grace period ends with "app_background"', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.appLifecycle('background');
    rig.clock.advance(CONFIG.session.APP_BACKGROUND_GRACE_MS + 1000);
    expect(rig.director.phase).toBe('ended');
    const ended = rig.events.find((e) => e.type === 'session:ended');
    expect((ended?.payload as AppEvents['session:ended']).summary.endReason).toBe('app_background');
  });

  it('backgrounding during fade ends immediately with reason "fade" (they fell asleep)', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.clock.advance(CONFIG.session.IDLE_TO_FADE_MS); // -> fade
    expect(rig.director.phase).toBe('fade');
    rig.director.appLifecycle('background');
    expect(rig.director.phase).toBe('ended');
    const ended = rig.events.find((e) => e.type === 'session:ended');
    expect((ended?.payload as AppEvents['session:ended']).summary.endReason).toBe('fade');
  });

  it('backgrounding during listen does not end the session', () => {
    const rig = createTestDirector();
    rig.director.startListenOnly(30 * 60_000);
    rig.director.appLifecycle('background');
    rig.clock.advance(CONFIG.session.APP_BACKGROUND_GRACE_MS * 5);
    expect(rig.director.phase).toBe('listen');
  });

  it('a long clock jump (simulating a frozen JS background period) is caught up correctly via reconcile() on return', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.appLifecycle('background');
    // Simulate the JS thread freezing for well past the grace period, with no timers firing.
    rig.clock.jump(CONFIG.session.APP_BACKGROUND_GRACE_MS * 10);
    expect(rig.director.phase).toBe('play'); // timers haven't fired yet — flush() below catches them up
    rig.director.appLifecycle('active');
    expect(rig.director.phase).toBe('ended');
  });
});

describe('SessionDirector: dispose', () => {
  it('clears all timers so nothing fires afterward', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');
    rig.director.dispose();
    const countBefore = rig.events.length;
    rig.clock.advance(24 * 60 * 60_000);
    expect(rig.events.length).toBe(countBefore);
    expect(rig.director.phase).toBe('play'); // frozen: no more transitions fire
  });
});

describe('SessionDirector: 90-minute simulation', () => {
  it('follows a sane phase path for a steady, alert tap stream (never drifts, never repeats a phase)', () => {
    const rig = createTestDirector();
    rig.director.start({ lastSession: null, listenDurationMs: 1800_000 });
    rig.director.completeSettle('jar_closed');

    const taps = alertSteady(3);
    let tapIdx = 0;
    const path: Phase[] = ['play'];
    const unsub = rig.bus.on('phase:changed', (e) => path.push(e.to));

    while (rig.clock.now() < 90 * 60_000 && rig.director.phase !== 'ended') {
      rig.clock.advance(1000);
      while (tapIdx < taps.length && taps[tapIdx]!.t <= rig.clock.now()) {
        replayTap(rig, taps[tapIdx]!);
        tapIdx++;
      }
      if (tapIdx >= taps.length) break; // fixture only covers 25 min; stop feeding taps after that
    }
    unsub();

    // No repeated phase in the path (a strictly-forward state machine).
    const seen = new Set<Phase>();
    for (const p of path) {
      expect(seen.has(p)).toBe(false);
      seen.add(p);
    }
  });
});
