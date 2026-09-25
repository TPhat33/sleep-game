// The session state machine — spec §5. "Commands in, events out" (plan
// §1.2): every public method is a command; every state change is published
// on the bus as 'phase:changed' (see events.ts for the full transition-
// reason vocabulary, copied from spec §5.1's table). Deadlines are always
// re-checked against clock.now() in reconcile(), never trusted just because
// a timer callback fired (plan §1.2 rule 5) — every scheduled timer's
// callback is `() => this.reconcile()` (or, for the listen offer, a
// dedicated one-shot check), not a direct transition.

import type { Clock, TimerId } from '../clock';
import type { Config } from '../config';
import type { AppEvents, TransitionReason } from '../events';
import type { EventBus } from '../events';
import type { DrowsinessEstimator } from '../drowsiness/DrowsinessEstimator';
import type { NightWakeDetector } from '../nightwake/NightWakeDetector';
import { minutes } from '../time';
import type { EndReason, LastSessionInfo, Phase, SessionSummary, TapEvent } from '../types';

export interface SessionDirectorDeps {
  clock: Clock;
  bus: EventBus<AppEvents>;
  cfg: Pick<Config, 'session' | 'drowsiness' | 'pacing'>;
  estimator: DrowsinessEstimator;
  nightWake: NightWakeDetector;
  ids: () => string;
}

export interface DirectorSnapshot {
  sessionId: string | null;
  phase: Phase;
  phaseEnteredAt: number;
  sessionStartedAt: number | null;
  /** Play phase only. */
  playElapsedMs: number;
  /** Play + drift combined. */
  activeElapsedMs: number;
  lastTapAt: number | null;
  drowsinessScore: number;
  nightWake: boolean;
  listenEndsAt: number | null;
  listenOfferShown: boolean;
  gentleExitShown: boolean;
  backgroundedAt: number | null;
}

function mapEndReason(reason: TransitionReason): EndReason {
  switch (reason) {
    case 'listen_timer':
    case 'user_exit':
    case 'app_background':
      return reason;
    case 'fade_complete':
    default:
      return 'fade';
  }
}

export class SessionDirector {
  private readonly clock: Clock;
  private readonly bus: EventBus<AppEvents>;
  private readonly cfg: Pick<Config, 'session' | 'drowsiness' | 'pacing'>;
  private readonly estimator: DrowsinessEstimator;
  private readonly nightWake: NightWakeDetector;
  private readonly ids: () => string;

  private _phase: Phase = 'home';
  private phaseEnteredAt: number;
  private sessionId: string | null = null;
  private sessionStartedAt: number | null = null;
  private nightWakeFlag = false;

  private playStartedAt: number | null = null;
  private playElapsedFrozen: number | null = null;
  private activeElapsedFrozen: number | null = null;

  private lastTapAt: number | null = null;
  private lastDrowsinessScore = 0;
  private peakDrowsinessScore = 0;

  private listenEndsAt: number | null = null;
  private listenOfferShown = false;
  private listenUsed = false;
  private gentleExitShown = false;
  private backgroundedAt: number | null = null;

  private driftConfirmCount = 0;
  private alertConfirmCount = 0;
  private starsEarned = 0;
  private fadeReachedActiveMinutes: number | null = null;
  private phaseDurationsMs: Partial<Record<Phase, number>> = {};

  private tickIntervalId: TimerId | null = null;
  private idleTimerId: TimerId | null = null;
  private playMaxTimerId: TimerId | null = null;
  private listenOfferTimerId: TimerId | null = null;
  private fadeCompleteTimerId: TimerId | null = null;
  private listenEndTimerId: TimerId | null = null;
  private backgroundGraceTimerId: TimerId | null = null;

  constructor(deps: SessionDirectorDeps) {
    this.clock = deps.clock;
    this.bus = deps.bus;
    this.cfg = deps.cfg;
    this.estimator = deps.estimator;
    this.nightWake = deps.nightWake;
    this.ids = deps.ids;
    this.phaseEnteredAt = this.clock.now();
  }

  get phase(): Phase {
    return this._phase;
  }

  snapshot(): DirectorSnapshot {
    const now = this.clock.now();
    return {
      sessionId: this.sessionId,
      phase: this._phase,
      phaseEnteredAt: this.phaseEnteredAt,
      sessionStartedAt: this.sessionStartedAt,
      playElapsedMs: this.computePlayElapsedMs(now),
      activeElapsedMs: this.computeActiveElapsedMs(now),
      lastTapAt: this.lastTapAt,
      drowsinessScore: this.lastDrowsinessScore,
      nightWake: this.nightWakeFlag,
      listenEndsAt: this.listenEndsAt,
      listenOfferShown: this.listenOfferShown,
      gentleExitShown: this.gentleExitShown,
      backgroundedAt: this.backgroundedAt,
    };
  }

  // ---- commands --------------------------------------------------------

  start(ctx: { lastSession: LastSessionInfo | null; listenDurationMs: number }): void {
    if (this._phase !== 'home' && this._phase !== 'ended') return;
    this.beginSession(this.nightWake.isNightWake(ctx.lastSession));
    if (this.nightWakeFlag) {
      this.transitionTo('listen', 'night_wake', ctx.listenDurationMs);
    } else {
      this.transitionTo('settle', 'start');
    }
  }

  /** [ADDITION] home -> listen via a "listen only" entry point (plan §2.2). */
  startListenOnly(listenDurationMs: number): void {
    if (this._phase !== 'home' && this._phase !== 'ended') return;
    this.beginSession(false);
    this.transitionTo('listen', 'listen_only', listenDurationMs);
  }

  completeSettle(how: 'jar_closed' | 'settle_skipped'): void {
    if (this._phase !== 'settle') return;
    this.transitionTo('play', how);
  }

  tap(e: Omit<TapEvent, 't'>): void {
    const now = this.clock.now();
    const tapEvent: TapEvent = { ...e, t: now };
    this.lastTapAt = now;
    this.bus.emit('tap:recorded', { at: now, tap: tapEvent });
    if (this._phase === 'play' || this._phase === 'drift') {
      this.estimator.record(tapEvent);
      this.rescheduleIdleTimer();
    }
  }

  starEarned(golden: boolean): void {
    this.starsEarned++;
    this.bus.emit('scene:starEarned', { at: this.clock.now(), golden });
  }

  requestListen(reason: 'listen_button' | 'listen_offer', listenDurationMs: number): void {
    if (this._phase !== 'play' && this._phase !== 'drift') return;
    this.transitionTo('listen', reason, listenDurationMs);
  }

  gentleExitChoice(choice: 'listen' | 'continue' | 'rest', listenDurationMs: number): void {
    if (this._phase !== 'play' && this._phase !== 'drift') return;
    if (choice === 'listen') {
      this.transitionTo('listen', 'gentle_exit_listen', listenDurationMs);
    } else if (choice === 'rest') {
      this.transitionTo('ended', 'user_exit');
    }
  }

  extendListen(ms: number): void {
    if (this._phase !== 'listen' || this.listenEndsAt === null) return;
    this.listenEndsAt += ms;
    this.clearListenEndTimer();
    const remaining = Math.max(0, this.listenEndsAt - this.clock.now());
    this.listenEndTimerId = this.clock.setTimeout(() => {
      this.reconcile();
    }, remaining);
    this.bus.emit('listen:extended', { at: this.clock.now(), newEndsAt: this.listenEndsAt });
  }

  exit(): void {
    if (this._phase === 'ended' || this._phase === 'home') return;
    this.transitionTo('ended', 'user_exit');
  }

  appLifecycle(state: 'active' | 'background'): void {
    const now = this.clock.now();
    if (state === 'background') {
      if (this._phase === 'fade') {
        this.transitionTo('ended', 'fade_complete');
      } else if (this._phase === 'settle' || this._phase === 'play' || this._phase === 'drift') {
        this.backgroundedAt = now;
        this.backgroundGraceTimerId = this.clock.setTimeout(() => {
          this.reconcile();
        }, this.cfg.session.APP_BACKGROUND_GRACE_MS);
      }
    } else if (this.backgroundedAt !== null) {
      this.clearBackgroundGraceTimer();
      // reconcile() first, with backgroundedAt still set: if grace was
      // exceeded while away, it ends the session as 'app_background' here
      // (and clears backgroundedAt itself). Otherwise it's a no-op — grace
      // wasn't exceeded, so clear it below and resume normally.
      this.reconcile();
      this.backgroundedAt = null;
    }
    this.bus.emit('app:lifecycle', { at: now, state });
  }

  /** Re-checks every deadline against clock.now(). Safe to call any time, from anywhere. */
  reconcile(): void {
    const now = this.clock.now();

    if (this.backgroundedAt !== null) {
      const stillGraced =
        this._phase === 'settle' || this._phase === 'play' || this._phase === 'drift';
      if (stillGraced && now - this.backgroundedAt >= this.cfg.session.APP_BACKGROUND_GRACE_MS) {
        this.backgroundedAt = null;
        this.transitionTo('ended', 'app_background');
      }
      // While backgrounded, nothing else progresses (the scene is paused).
      return;
    }

    switch (this._phase) {
      case 'play':
        if (this.isIdleDue(now)) {
          this.transitionTo('fade', 'idle');
          this.reconcile();
        } else if (
          this.playStartedAt !== null &&
          now - this.playStartedAt >= this.cfg.session.PLAY_MAX_MS
        ) {
          this.transitionTo('drift', 'play_max');
          this.reconcile();
        }
        return;
      case 'drift':
        if (this.isIdleDue(now)) {
          this.transitionTo('fade', 'idle');
          this.reconcile();
        }
        return;
      case 'fade': {
        const fadeDoneMs = Math.max(this.cfg.pacing.FADE_SCREEN_MS, this.cfg.pacing.FADE_AUDIO_MS);
        if (now - this.phaseEnteredAt >= fadeDoneMs) {
          this.transitionTo('ended', 'fade_complete');
        }
        return;
      }
      case 'listen':
        if (this.listenEndsAt !== null && now >= this.listenEndsAt) {
          this.transitionTo('ended', 'listen_timer');
        }
        return;
      default:
        return;
    }
  }

  dispose(): void {
    this.clearTickInterval();
    this.clearIdleTimer();
    this.clearPlayMaxTimer();
    this.clearListenOfferTimer();
    this.clearFadeCompleteTimer();
    this.clearListenEndTimer();
    this.clearBackgroundGraceTimer();
  }

  // ---- internals ---------------------------------------------------------

  private beginSession(nightWake: boolean): void {
    this.sessionId = this.ids();
    this.sessionStartedAt = this.clock.now();
    this.nightWakeFlag = nightWake;
    this.playElapsedFrozen = null;
    this.activeElapsedFrozen = null;
    this.lastTapAt = null;
    this.lastDrowsinessScore = 0;
    this.peakDrowsinessScore = 0;
    this.listenEndsAt = null;
    this.listenOfferShown = false;
    this.listenUsed = false;
    this.gentleExitShown = false;
    this.backgroundedAt = null;
    this.driftConfirmCount = 0;
    this.alertConfirmCount = 0;
    this.starsEarned = 0;
    this.fadeReachedActiveMinutes = null;
    this.phaseDurationsMs = {};
    this.bus.emit('session:started', {
      at: this.sessionStartedAt,
      sessionId: this.sessionId,
      nightWake,
    });
  }

  private isIdleDue(now: number): boolean {
    const lastAction = this.lastTapAt ?? this.phaseEnteredAt;
    return now - lastAction >= this.cfg.session.IDLE_TO_FADE_MS;
  }

  private computePlayElapsedMs(now: number): number {
    if (this._phase === 'play' && this.playStartedAt !== null) return now - this.playStartedAt;
    return this.playElapsedFrozen ?? 0;
  }

  private computeActiveElapsedMs(now: number): number {
    if ((this._phase === 'play' || this._phase === 'drift') && this.playStartedAt !== null) {
      return now - this.playStartedAt;
    }
    return this.activeElapsedFrozen ?? 0;
  }

  private transitionTo(next: Phase, reason: TransitionReason, listenDurationMs?: number): void {
    const now = this.clock.now();
    const from = this._phase;

    this.phaseDurationsMs[from] = (this.phaseDurationsMs[from] ?? 0) + (now - this.phaseEnteredAt);

    if (from === 'play' || from === 'drift') {
      this.activeElapsedFrozen = this.computeActiveElapsedMs(now);
    }
    if (from === 'play') {
      this.playElapsedFrozen = this.computePlayElapsedMs(now);
    }

    if (next === 'drift') {
      this.clearPlayMaxTimer();
    } else {
      this.clearTickInterval();
      this.clearPlayMaxTimer();
      this.clearIdleTimer();
      this.clearListenOfferTimer();
    }
    if (from === 'fade') this.clearFadeCompleteTimer();
    if (from === 'listen') this.clearListenEndTimer();

    this._phase = next;
    this.phaseEnteredAt = now;

    if (next === 'listen') this.listenUsed = true;
    if (next === 'fade') this.fadeReachedActiveMinutes = minutes(this.computeActiveElapsedMs(now));

    if (next === 'listen' && listenDurationMs !== undefined) {
      this.bus.emit('phase:changed', { at: now, from, to: next, reason, listenDurationMs });
    } else {
      this.bus.emit('phase:changed', { at: now, from, to: next, reason });
    }

    switch (next) {
      case 'play':
        this.enterPlay(now);
        break;
      case 'drift':
        this.enterDrift();
        break;
      case 'listen':
        this.enterListen(now, listenDurationMs ?? 0);
        break;
      case 'fade':
        this.enterFade();
        break;
      case 'ended':
        this.enterEnded(now, reason);
        break;
      case 'settle':
      case 'home':
        break;
    }
  }

  private enterPlay(now: number): void {
    this.playStartedAt = now;
    this.playElapsedFrozen = null;
    this.activeElapsedFrozen = null;
    this.driftConfirmCount = 0;
    this.alertConfirmCount = 0;
    this.estimator.reset();
    this.estimator.startBaseline();
    this.tickIntervalId = this.clock.setInterval(() => {
      this.onTick();
    }, this.cfg.drowsiness.WINDOW_STEP_MS);
    this.playMaxTimerId = this.clock.setTimeout(() => {
      this.reconcile();
    }, this.cfg.session.PLAY_MAX_MS);
    this.listenOfferTimerId = this.clock.setTimeout(() => {
      this.onListenOfferDue();
    }, this.cfg.session.LISTEN_OFFER_MS);
    this.rescheduleIdleTimer();
  }

  private enterDrift(): void {
    // Tick interval, idle timer and the listen-offer timer all continue
    // uninterrupted: they track play+drift as one continuous "active" span.
  }

  private enterListen(now: number, listenDurationMs: number): void {
    this.listenEndsAt = now + listenDurationMs;
    this.listenEndTimerId = this.clock.setTimeout(() => {
      this.reconcile();
    }, listenDurationMs);
  }

  private enterFade(): void {
    const fadeDoneMs = Math.max(this.cfg.pacing.FADE_SCREEN_MS, this.cfg.pacing.FADE_AUDIO_MS);
    this.fadeCompleteTimerId = this.clock.setTimeout(() => {
      this.reconcile();
    }, fadeDoneMs);
  }

  private enterEnded(now: number, reason: TransitionReason): void {
    this.clearBackgroundGraceTimer();
    this.backgroundedAt = null;

    const summary: SessionSummary = {
      id: this.sessionId ?? '',
      startedAt: this.sessionStartedAt ?? now,
      endedAt: now,
      endReason: mapEndReason(reason),
      nightWake: this.nightWakeFlag,
      phaseDurationsMs: { ...this.phaseDurationsMs },
      minutesToFade: this.fadeReachedActiveMinutes,
      peakDrowsiness: this.peakDrowsinessScore,
      listenUsed: this.listenUsed,
      gentleExitShown: this.gentleExitShown,
      starsEarned: this.starsEarned,
    };
    this.bus.emit('session:ended', { at: now, summary });
  }

  private onTick(): void {
    const sample = this.estimator.tick();
    if (sample) {
      this.bus.emit('drowsiness:sample', { at: this.clock.now(), sample });
      this.lastDrowsinessScore = sample.score;
      this.peakDrowsinessScore = Math.max(this.peakDrowsinessScore, sample.score);
      this.evaluateDrift(sample.score);
      this.evaluateGentleExit(sample.score);
    }
    this.reconcile();
  }

  private evaluateDrift(score: number): void {
    if (this._phase !== 'play') {
      this.driftConfirmCount = 0;
      return;
    }
    if (score >= this.cfg.drowsiness.DRIFT_THRESHOLD) {
      this.driftConfirmCount++;
      if (this.driftConfirmCount >= this.cfg.drowsiness.DRIFT_CONFIRM_WINDOWS) {
        this.transitionTo('drift', 'drowsy');
      }
    } else {
      this.driftConfirmCount = 0;
    }
  }

  private evaluateGentleExit(score: number): void {
    if (this.gentleExitShown) return;
    if (this._phase !== 'play' && this._phase !== 'drift') return;

    if (score < this.cfg.drowsiness.ALERT_THRESHOLD) {
      this.alertConfirmCount++;
    } else {
      this.alertConfirmCount = 0;
      return;
    }
    if (this.alertConfirmCount < this.cfg.session.GENTLE_EXIT_CONFIRM_WINDOWS) return;

    const activeElapsed = this.computeActiveElapsedMs(this.clock.now());
    if (activeElapsed >= this.cfg.session.GENTLE_EXIT_MS) {
      this.gentleExitShown = true;
      this.bus.emit('ui:gentleExit', { at: this.clock.now() });
    }
  }

  private onListenOfferDue(): void {
    this.listenOfferTimerId = null;
    if (this._phase !== 'play' && this._phase !== 'drift') return;
    if (this.listenOfferShown) return;
    this.listenOfferShown = true;
    this.bus.emit('ui:listenOffer', { at: this.clock.now() });
  }

  private rescheduleIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimerId = this.clock.setTimeout(() => {
      this.reconcile();
    }, this.cfg.session.IDLE_TO_FADE_MS);
  }

  private clearTickInterval(): void {
    if (this.tickIntervalId === null) return;
    this.clock.clearInterval(this.tickIntervalId);
    this.tickIntervalId = null;
  }

  private clearIdleTimer(): void {
    if (this.idleTimerId === null) return;
    this.clock.clearTimeout(this.idleTimerId);
    this.idleTimerId = null;
  }

  private clearPlayMaxTimer(): void {
    if (this.playMaxTimerId === null) return;
    this.clock.clearTimeout(this.playMaxTimerId);
    this.playMaxTimerId = null;
  }

  private clearListenOfferTimer(): void {
    if (this.listenOfferTimerId === null) return;
    this.clock.clearTimeout(this.listenOfferTimerId);
    this.listenOfferTimerId = null;
  }

  private clearFadeCompleteTimer(): void {
    if (this.fadeCompleteTimerId === null) return;
    this.clock.clearTimeout(this.fadeCompleteTimerId);
    this.fadeCompleteTimerId = null;
  }

  private clearListenEndTimer(): void {
    if (this.listenEndTimerId === null) return;
    this.clock.clearTimeout(this.listenEndTimerId);
    this.listenEndTimerId = null;
  }

  private clearBackgroundGraceTimer(): void {
    if (this.backgroundGraceTimerId === null) return;
    this.clock.clearTimeout(this.backgroundGraceTimerId);
    this.backgroundGraceTimerId = null;
  }
}
