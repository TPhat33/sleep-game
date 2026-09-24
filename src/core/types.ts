// Core domain types — spec §4, plus plan §4.5 additions.

export type Phase = 'home' | 'settle' | 'play' | 'drift' | 'fade' | 'listen' | 'ended';

export type EndReason = 'fade' | 'listen_timer' | 'user_exit' | 'app_background';

export type DreamColor = 'amber' | 'ember' | 'moss';

export interface DreamDef {
  id: string;
  nameTh: string;
  color: DreamColor;
  sprite: string;
}

export interface TapEvent {
  t: number;
  hit: boolean;
  correctBoat?: boolean;
  reactionMs?: number;
}

export interface DrowsinessSample {
  t: number;
  score: number;
  raw: number;
  features: WindowFeatures;
}

/**
 * A window feature is null when the window has no data to compute it from
 * (see plan Appendix A rule 1-3). `missRate`/`tapCount` are always defined
 * once `tapCount > 0`.
 */
export interface WindowFeatures {
  itiMedian: number | null;
  itiCv: number | null;
  rtMedian: number | null;
  missRate: number;
  tapCount: number;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  endReason: EndReason;
  nightWake: boolean;
  phaseDurationsMs: Partial<Record<Phase, number>>;
  minutesToFade: number | null;
  peakDrowsiness: number;
  listenUsed: boolean;
  gentleExitShown: boolean;
  starsEarned: number;
}

export type FeatureKey = 'rtMedian' | 'itiMedian' | 'itiCv' | 'missRate';

export interface FeatureStats {
  mean: number;
  std: number;
}

export type Baseline = Record<FeatureKey, FeatureStats> & {
  source: 'measured' | 'default' | 'mixed';
};

export interface LastSessionInfo {
  endedAt: number;
  endReason: EndReason;
}

/**
 * Shared vocabulary types that both `src/platform` and `src/audio` need to
 * reference (e.g. in `AppEvents` and `CONFIG.audio.OUTPUT_STRATEGY`). They
 * live in core, not in the layer that primarily "owns" the concept, so core
 * stays the one thing every other layer imports from and never the reverse
 * (plan §1.1 dependency rule). `src/platform/Platform.ts` re-exports
 * `LifecycleState` and `PlatformKind` for convenience.
 */
export type LifecycleState = 'active' | 'background';
export type PlatformKind = 'web' | 'ios' | 'android';
export type AudioOutputKind = 'webaudio-direct' | 'element-bridge';
