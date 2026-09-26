// The glue layer (plan §1.2 rule 6, §1.9): the only code that reacts to
// SessionDirector's bus events by driving Platform, AudioEngine and
// persistence side effects. SessionDirector itself never touches any of
// these directly — "commands in, events out" — so this class is the sole
// place §1.9's per-phase policy table is implemented.
//
// Assumes AudioEngine.unlock() has already been called (from a user
// gesture) by the time any session reaches 'fade' or 'listen' — that
// belongs to UI wiring, not here. stopAll() tolerates an unlocked engine
// (it no-ops), but setMasterVolume()/startListen() do not.

import type { AudioEngine } from '../audio/AudioEngine';
import type { AudioConfig, PacingConfig } from '../core/config';
import type { AppEvents } from '../core/events';
import type { EventBus, Unsubscribe } from '../core/events';
import type { EndReason, LifecycleState, Phase, SessionSummary } from '../core/types';
import type { Platform } from '../platform/Platform';
import type { SessionsRepository } from '../store/repositories';

export interface SessionRuntimeDeps {
  bus: EventBus<AppEvents>;
  platform: Platform;
  audioEngine: AudioEngine;
  sessions: Pick<SessionsRepository, 'writeProvisional' | 'finalize' | 'deleteProvisional'>;
  cfg: {
    pacing: Pick<PacingConfig, 'FADE_BRIGHTNESS_TARGET' | 'FADE_AUDIO_MS' | 'BRIGHTNESS_MIN'>;
    audio: Pick<AudioConfig, 'STOP_ON_BACKGROUND_RAMP_MS'>;
  };
}

const NOW_PLAYING_META = { title: 'Hushglow' };

/** Phases where a backgrounded app is on a grace-period countdown to `ended('app_background')` — plan §1.9. */
const GRACED_PHASES: ReadonlySet<Phase> = new Set<Phase>(['settle', 'play', 'drift']);

export class SessionRuntime {
  private readonly bus: EventBus<AppEvents>;
  private readonly platform: Platform;
  private readonly audioEngine: AudioEngine;
  private readonly sessions: SessionRuntimeDeps['sessions'];
  private readonly cfg: SessionRuntimeDeps['cfg'];

  private readonly unsubscribes: Unsubscribe[];

  private currentPhase: Phase = 'home';
  private sessionId: string | null = null;
  private sessionStartedAt: number | null = null;
  private sessionNightWake = false;
  private provisionalWritten = false;

  constructor(deps: SessionRuntimeDeps) {
    this.bus = deps.bus;
    this.platform = deps.platform;
    this.audioEngine = deps.audioEngine;
    this.sessions = deps.sessions;
    this.cfg = deps.cfg;

    this.unsubscribes = [
      this.bus.on('session:started', (e) => {
        this.sessionId = e.sessionId;
        this.sessionStartedAt = e.at;
        this.sessionNightWake = e.nightWake;
        this.provisionalWritten = false;
      }),
      this.bus.on('phase:changed', (e) => {
        this.currentPhase = e.to;
        this.applyPhasePolicy(e.to, e.listenDurationMs);
      }),
      this.bus.on('app:lifecycle', (e) => {
        this.handleLifecycle(e.state, e.at);
      }),
      this.bus.on('session:ended', (e) => {
        void this.handleEnded(e.summary);
      }),
    ];
  }

  /** Unsubscribes from the bus. Does not touch Platform/AudioEngine state — call during app teardown only. */
  dispose(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  private applyPhasePolicy(to: Phase, listenDurationMs: number | undefined): void {
    switch (to) {
      case 'settle':
        // play and drift are reached only via settle, so the lock acquired
        // here already covers the whole graced span (plan §1.9 table).
        void this.platform.wakeLock.acquire();
        break;
      case 'fade':
        void this.platform.brightness.set(this.cfg.pacing.FADE_BRIGHTNESS_TARGET);
        this.audioEngine.setMasterVolume(0, this.cfg.pacing.FADE_AUDIO_MS);
        break;
      case 'listen':
        void this.platform.wakeLock.release();
        void this.platform.brightness.set(this.cfg.pacing.BRIGHTNESS_MIN);
        void this.platform.backgroundAudio.activate(NOW_PLAYING_META);
        this.audioEngine.startListen(listenDurationMs ?? 0);
        break;
      case 'play':
      case 'drift':
      case 'home':
      case 'ended':
        break;
    }
  }

  private handleLifecycle(state: LifecycleState, at: number): void {
    if (state === 'background') {
      if (
        this.sessionId !== null &&
        this.sessionStartedAt !== null &&
        GRACED_PHASES.has(this.currentPhase)
      ) {
        this.provisionalWritten = true;
        void this.sessions.writeProvisional({
          id: this.sessionId,
          startedAt: this.sessionStartedAt,
          nightWake: this.sessionNightWake,
          backgroundedAt: at,
        });
      }
      return;
    }
    // Returned to the foreground within the grace period — reconcile()
    // already ran (synchronously, before this event) and would have fired
    // 'session:ended' had the grace period actually been exceeded, which
    // clears provisionalWritten. Seeing it still true here means the
    // session is still live and the provisional record is stale.
    if (this.provisionalWritten && this.sessionId !== null) {
      this.provisionalWritten = false;
      void this.sessions.deleteProvisional(this.sessionId);
    }
  }

  private async handleEnded(summary: SessionSummary): Promise<void> {
    this.provisionalWritten = false;
    void this.platform.wakeLock.release();
    void this.platform.brightness.restore();
    await this.sessions.finalize(summary);
    await this.audioEngine.stopAll(this.audioStopRampMs(summary.endReason));
    await this.platform.backgroundAudio.deactivate();
    this.sessionId = null;
    this.sessionStartedAt = null;
  }

  /**
   * [ADDITION] Not spelled out in spec/plan: 'fade' and 'listen_timer' both
   * already ramp the master gain to 0 themselves (the fade-phase ramp and
   * the pre-scheduled listen timeline, respectively) before 'ended' is
   * reached, so stopping again here is just cleanup and needs no ramp.
   * 'app_background' and 'user_exit' end abruptly mid-audio, so they use
   * CONFIG.audio.STOP_ON_BACKGROUND_RAMP_MS — named for the background
   * case, reused here for user_exit too since both need the same quick,
   * non-jarring fade rather than a hard cut.
   */
  private audioStopRampMs(reason: EndReason): number {
    switch (reason) {
      case 'fade':
      case 'listen_timer':
        return 0;
      case 'app_background':
      case 'user_exit':
        return this.cfg.audio.STOP_ON_BACKGROUND_RAMP_MS;
    }
  }
}
