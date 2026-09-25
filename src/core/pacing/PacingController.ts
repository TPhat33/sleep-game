// Spec §7. No Clock — time arrives as input (`now`, `phaseEnteredAt`) so the
// controller stays a pure function of its input plus a little continuity
// state (dimAlpha/masterVolume captured at each phase change, so a
// drift/fade ramp starts from wherever play left off instead of jumping).

import type { PacingConfig, SessionConfig } from '../config';
import { clamp, easeInOut, lerp } from '../time';
import type { Phase } from '../types';

/** PLAY_CURVE_MS lives in session config (spec §13), but the play progress formula needs it. */
export interface PacingDeps {
  pacing: PacingConfig;
  session: Pick<SessionConfig, 'PLAY_CURVE_MS'>;
}

export interface PacingInput {
  phase: Phase;
  now: number;
  phaseEnteredAt: number;
  /** Time spent in 'play' only. */
  playElapsedMs: number;
  /** M2 passes 0 (time-only pacing) until M3 wires the estimator in. */
  drowsinessScore: number;
  lastTapAt: number | null;
  voicePreference: boolean;
}

export interface PacingOutput {
  /** 1.0 = normal. */
  speed: number;
  spawnIntervalMs: number;
  /** Opacity of the black overlay, 0..1. */
  dimAlpha: number;
  /** For native brightness; null = leave it alone. */
  brightnessTarget: number | null;
  masterVolume: number;
  voiceEnabled: boolean;
}

export class PacingController {
  private lastPhase: Phase | null = null;
  private lastOutput: PacingOutput | null = null;
  private dimAlphaAtEntry: number;
  private volumeAtEntry = 1;

  constructor(private readonly deps: PacingDeps) {
    this.dimAlphaAtEntry = deps.pacing.DIM_START;
  }

  reset(): void {
    this.lastPhase = null;
    this.lastOutput = null;
    this.dimAlphaAtEntry = this.deps.pacing.DIM_START;
    this.volumeAtEntry = 1;
  }

  update(input: PacingInput): PacingOutput {
    if (input.phase !== this.lastPhase) {
      this.dimAlphaAtEntry = this.lastOutput?.dimAlpha ?? this.deps.pacing.DIM_START;
      this.volumeAtEntry = this.lastOutput?.masterVolume ?? 1;
      this.lastPhase = input.phase;
    }
    const output = this.computeOutput(input);
    this.lastOutput = output;
    return output;
  }

  private computeOutput(input: PacingInput): PacingOutput {
    switch (input.phase) {
      case 'play':
        return this.playOutput(input);
      case 'drift':
        return this.driftOutput(input);
      case 'fade':
        return this.fadeOutput(input);
      case 'listen':
        return this.listenOutput(input);
      case 'ended':
        return this.endedOutput();
      case 'home':
      case 'settle':
        return this.idleOutput();
    }
  }

  private playOutput(input: PacingInput): PacingOutput {
    const cfg = this.deps.pacing;
    const progress = clamp(
      Math.max(input.playElapsedMs / this.deps.session.PLAY_CURVE_MS, input.drowsinessScore),
      0,
      1,
    );
    const speed = lerp(cfg.SPEED_START, cfg.SPEED_END, easeInOut(progress));
    return {
      speed,
      spawnIntervalMs: cfg.SPAWN_BASE_MS / speed,
      dimAlpha: lerp(cfg.DIM_START, cfg.DIM_END_PLAY, progress),
      brightnessTarget: null,
      masterVolume: 1,
      voiceEnabled: false,
    };
  }

  private driftOutput(input: PacingInput): PacingOutput {
    const cfg = this.deps.pacing;
    const speed = cfg.SPEED_DRIFT;
    const t = clamp((input.now - input.phaseEnteredAt) / cfg.DRIFT_DIM_MS, 0, 1);
    const rampedDim = lerp(this.dimAlphaAtEntry, cfg.DIM_END_DRIFT, t);
    return {
      speed,
      spawnIntervalMs: cfg.SPAWN_BASE_MS / speed,
      dimAlpha: clamp(rampedDim - this.tapPeekReduction(input), 0, 1),
      brightnessTarget: null,
      masterVolume: 1,
      voiceEnabled: input.voicePreference,
    };
  }

  /** A tap during drift briefly peeks the screen brighter, then fades back over TAP_PEEK_MS. */
  private tapPeekReduction(input: PacingInput): number {
    const cfg = this.deps.pacing;
    if (input.lastTapAt === null) return 0;
    const sinceTap = input.now - input.lastTapAt;
    if (sinceTap < 0 || sinceTap >= cfg.TAP_PEEK_MS) return 0;
    const decay = 1 - sinceTap / cfg.TAP_PEEK_MS;
    return cfg.TAP_PEEK_DIM * decay;
  }

  private fadeOutput(input: PacingInput): PacingOutput {
    const cfg = this.deps.pacing;
    const elapsed = input.now - input.phaseEnteredAt;
    const screenT = clamp(elapsed / cfg.FADE_SCREEN_MS, 0, 1);
    const audioT = clamp(elapsed / cfg.FADE_AUDIO_MS, 0, 1);
    return {
      speed: cfg.SPEED_DRIFT,
      spawnIntervalMs: cfg.SPAWN_BASE_MS / cfg.SPEED_DRIFT,
      dimAlpha: lerp(this.dimAlphaAtEntry, 1, screenT),
      brightnessTarget: cfg.FADE_BRIGHTNESS_TARGET,
      masterVolume: lerp(this.volumeAtEntry, 0, audioT),
      voiceEnabled: false,
    };
  }

  private listenOutput(input: PacingInput): PacingOutput {
    const cfg = this.deps.pacing;
    return {
      speed: 1,
      spawnIntervalMs: cfg.SPAWN_BASE_MS,
      dimAlpha: 1,
      brightnessTarget: cfg.BRIGHTNESS_MIN,
      masterVolume: 1,
      voiceEnabled: input.voicePreference,
    };
  }

  /** [ADDITION] home/settle aren't covered by spec §7's formulas — a neutral, undimmed default. */
  private idleOutput(): PacingOutput {
    const cfg = this.deps.pacing;
    return {
      speed: 1,
      spawnIntervalMs: cfg.SPAWN_BASE_MS,
      dimAlpha: cfg.DIM_START,
      brightnessTarget: null,
      masterVolume: 1,
      voiceEnabled: false,
    };
  }

  /** [ADDITION] ended: screen stays black, audio silent; Platform.dispose() (not this) restores brightness. */
  private endedOutput(): PacingOutput {
    const cfg = this.deps.pacing;
    return {
      speed: 1,
      spawnIntervalMs: cfg.SPAWN_BASE_MS,
      dimAlpha: 1,
      brightnessTarget: null,
      masterVolume: 0,
      voiceEnabled: false,
    };
  }
}
