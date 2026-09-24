// All tunable values live here — spec §0: "ห้าม hard-code ในโมดูลอื่น" (no other
// module may hardcode a tunable). Keys keep the spec's UPPER_SNAKE names so
// they can be traced back to spec §13. Values marked [ADDITION] fill gaps the
// spec left implicit (plan §1.5).

import type { AudioOutputKind, PlatformKind } from './types';

export interface FeatureStatsConfig {
  mean: number;
  std: number;
}

export interface SessionConfig {
  PLAY_MAX_MS: number;
  PLAY_CURVE_MS: number;
  LISTEN_OFFER_MS: number;
  GENTLE_EXIT_MS: number;
  IDLE_TO_FADE_MS: number;
  /** [ADDITION] spec §5.2 "ต่อเนื่อง 2 รอบ" for the gentle-exit alert check. */
  GENTLE_EXIT_CONFIRM_WINDOWS: number;
  /** [ADDITION] default listen timer before settings exist. */
  LISTEN_DEFAULT_MIN: number;
  /** [ADDITION] the listen controls' "ต่อเวลา" (extend) button. */
  LISTEN_EXTEND_MS: number;
  /** [ADDITION] spec M1 "แสดงปุ่ม ... 5 วินาที แล้วดับ". */
  LISTEN_CONTROLS_VISIBLE_MS: number;
  /** [ADDITION] listen mode releases the wake lock so the OS can sleep the screen (plan §1.9). */
  LISTEN_HOLD_WAKE_LOCK: boolean;
  /** [ADDITION] a Control Center / notification-pull backgrounding must not end the session. */
  APP_BACKGROUND_GRACE_MS: number;
}

export interface DrowsinessWeights {
  rtMedian: number;
  itiMedian: number;
  itiCv: number;
  missRate: number;
}

export interface DrowsinessStdFloor {
  rtMedian: number;
  itiMedian: number;
  itiCv: number;
  missRate: number;
}

export interface DrowsinessDefaultBaseline {
  rtMedian: FeatureStatsConfig;
  itiMedian: FeatureStatsConfig;
  itiCv: FeatureStatsConfig;
  missRate: FeatureStatsConfig;
}

export interface DrowsinessConfig {
  BASELINE_MS: number;
  BASELINE_MIN_TAPS: number;
  WINDOW_MS: number;
  WINDOW_STEP_MS: number;
  WEIGHTS: DrowsinessWeights;
  BIAS: number;
  EMA_ALPHA: number;
  DRIFT_THRESHOLD: number;
  DRIFT_CONFIRM_WINDOWS: number;
  ALERT_THRESHOLD: number;
  NO_TAP_WINDOW_SCORE: number;
  STD_FLOOR: DrowsinessStdFloor;
  DEFAULT_BASELINE: DrowsinessDefaultBaseline;
  /** [ADDITION] spec §6.1 "sub-window 30 วินาที" for baseline mean/std. */
  BASELINE_SUBWINDOW_MS: number;
  /** [ADDITION] spec §6.1 clamp(z, -3, 3). */
  Z_CLAMP: number;
}

export interface PacingConfig {
  SPEED_START: number;
  SPEED_END: number;
  SPEED_DRIFT: number;
  SPAWN_BASE_MS: number;
  DIM_START: number;
  DIM_END_PLAY: number;
  DIM_END_DRIFT: number;
  DRIFT_DIM_MS: number;
  FADE_SCREEN_MS: number;
  FADE_AUDIO_MS: number;
  TAP_PEEK_DIM: number;
  TAP_PEEK_MS: number;
  BRIGHTNESS_MIN: number;
  /** [ADDITION] fade also drops native brightness; spec only states this for listen. */
  FADE_BRIGHTNESS_TARGET: number;
}

export interface SceneConfig {
  MAX_DREAMS_ON_SCREEN: number;
  NO_REPEAT_WINDOW: number;
  BASE_DRIFT_PX_S: number;
  RESPAWN_DELAY_MS: readonly [number, number];
  STAR_RISE_MS: number;
  BREATH_PERIOD_MS: number;
  BREATH_TOLERANCE_MS: number;
  SFX_MAX_GAIN: number;
  /** [ADDITION] spec §8 performance targets. */
  FPS_PLAY: number;
  FPS_DRIFT: number;
  FIREFLY_COUNT: readonly [number, number];
  BOAT_CAPACITY: number;
  MAX_DEVICE_PIXEL_RATIO: number;
}

export interface AudioLayerGain {
  rain: number;
  crickets: number;
  brownNoise: number;
  asmrTaps: number;
  shuffleVoice: number;
  breathCue: number;
}

export interface AudioConfig {
  SHUFFLE_GAP_MIN_MS: number;
  SHUFFLE_GAP_MAX_MS: number;
  LISTEN_TAIL_MS: number;
  LISTEN_OPTIONS_MIN: readonly number[];
  /** [ADDITION] spec §9.2 "ไม่ซ้ำภายใน 30 คำล่าสุด". */
  SHUFFLE_NO_REPEAT: number;
  /** [ADDITION] spec §9.2 tail-gap stretch. */
  LISTEN_TAIL_GAP_MULT: number;
  /** [ADDITION] ramp when audio must stop because the app was backgrounded outside listen. */
  STOP_ON_BACKGROUND_RAMP_MS: number;
  /** [ADDITION] seamless brown-noise loop length (plan §2.2). */
  BROWN_NOISE_LOOP_S: number;
  /** [ADDITION] per-platform AudioOutput strategy, updated from M0 device findings. */
  OUTPUT_STRATEGY: Record<PlatformKind, AudioOutputKind>;
  /** [ADDITION] per-layer default gain. */
  LAYER_GAIN: AudioLayerGain;
}

export interface NightWakeConfig {
  NIGHT_START_HOUR: number;
  NIGHT_END_HOUR: number;
  NIGHT_WAKE_WINDOW_MS: number;
  REVEAL_START_HOUR: number;
}

export interface MetaConfig {
  STARS_PER_CONSTELLATION: number;
  VISITOR_CHANCE: number;
  JAR_MAX_ITEMS: number;
  JAR_MAX_CHARS: number;
  JAR_RETENTION_DAYS: number;
  /** [ADDITION] spec §11 "05:00–12:00" morning survey window. */
  MORNING_SURVEY_START_HOUR: number;
  MORNING_SURVEY_END_HOUR: number;
  /** [ADDITION] spec §11 synodic month length in days, for moon phase. */
  SYNODIC_MONTH_DAYS: number;
}

export interface Config {
  session: SessionConfig;
  drowsiness: DrowsinessConfig;
  pacing: PacingConfig;
  scene: SceneConfig;
  audio: AudioConfig;
  nightWake: NightWakeConfig;
  meta: MetaConfig;
}

type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const defaults: Config = {
  session: {
    PLAY_MAX_MS: 25 * MINUTE_MS,
    PLAY_CURVE_MS: 20 * MINUTE_MS,
    LISTEN_OFFER_MS: 20 * MINUTE_MS,
    GENTLE_EXIT_MS: 30 * MINUTE_MS,
    IDLE_TO_FADE_MS: 45_000,
    GENTLE_EXIT_CONFIRM_WINDOWS: 2,
    LISTEN_DEFAULT_MIN: 60,
    LISTEN_EXTEND_MS: 15 * MINUTE_MS,
    LISTEN_CONTROLS_VISIBLE_MS: 5_000,
    LISTEN_HOLD_WAKE_LOCK: false,
    APP_BACKGROUND_GRACE_MS: 10_000,
  },
  drowsiness: {
    BASELINE_MS: 120_000,
    BASELINE_MIN_TAPS: 15,
    WINDOW_MS: MINUTE_MS,
    WINDOW_STEP_MS: 15_000,
    WEIGHTS: { rtMedian: 0.35, itiMedian: 0.25, itiCv: 0.2, missRate: 0.2 },
    BIAS: 1.5,
    EMA_ALPHA: 0.3,
    DRIFT_THRESHOLD: 0.6,
    DRIFT_CONFIRM_WINDOWS: 2,
    ALERT_THRESHOLD: 0.3,
    NO_TAP_WINDOW_SCORE: 0.8,
    STD_FLOOR: { rtMedian: 80, itiMedian: 150, itiCv: 0.05, missRate: 0.05 },
    DEFAULT_BASELINE: {
      rtMedian: { mean: 900, std: 250 },
      itiMedian: { mean: 2200, std: 600 },
      itiCv: { mean: 0.35, std: 0.1 },
      missRate: { mean: 0.1, std: 0.05 },
    },
    BASELINE_SUBWINDOW_MS: 30_000,
    Z_CLAMP: 3,
  },
  pacing: {
    SPEED_START: 1.0,
    SPEED_END: 0.4,
    SPEED_DRIFT: 0.25,
    SPAWN_BASE_MS: 3500,
    DIM_START: 0.0,
    DIM_END_PLAY: 0.55,
    DIM_END_DRIFT: 0.85,
    DRIFT_DIM_MS: 5 * MINUTE_MS,
    FADE_SCREEN_MS: 8_000,
    FADE_AUDIO_MS: MINUTE_MS,
    TAP_PEEK_DIM: 0.2,
    TAP_PEEK_MS: 4_000,
    BRIGHTNESS_MIN: 0.02,
    FADE_BRIGHTNESS_TARGET: 0.02,
  },
  scene: {
    MAX_DREAMS_ON_SCREEN: 6,
    NO_REPEAT_WINDOW: 12,
    BASE_DRIFT_PX_S: 40,
    RESPAWN_DELAY_MS: [10_000, 20_000],
    STAR_RISE_MS: 2_500,
    BREATH_PERIOD_MS: 10_000,
    BREATH_TOLERANCE_MS: 600,
    SFX_MAX_GAIN: 0.25,
    FPS_PLAY: 30,
    FPS_DRIFT: 20,
    FIREFLY_COUNT: [8, 12],
    BOAT_CAPACITY: 3,
    MAX_DEVICE_PIXEL_RATIO: 2,
  },
  audio: {
    SHUFFLE_GAP_MIN_MS: 8_000,
    SHUFFLE_GAP_MAX_MS: 14_000,
    LISTEN_TAIL_MS: 5 * MINUTE_MS,
    LISTEN_OPTIONS_MIN: [30, 60, 90],
    SHUFFLE_NO_REPEAT: 30,
    LISTEN_TAIL_GAP_MULT: 1.5,
    STOP_ON_BACKGROUND_RAMP_MS: 2_000,
    BROWN_NOISE_LOOP_S: 30,
    OUTPUT_STRATEGY: { web: 'webaudio-direct', ios: 'webaudio-direct', android: 'webaudio-direct' },
    LAYER_GAIN: {
      rain: 0.6,
      crickets: 0.4,
      brownNoise: 0.5,
      asmrTaps: 0.3,
      shuffleVoice: 0.35,
      breathCue: 0.2,
    },
  },
  nightWake: {
    NIGHT_START_HOUR: 22,
    NIGHT_END_HOUR: 5,
    NIGHT_WAKE_WINDOW_MS: 3 * HOUR_MS,
    REVEAL_START_HOUR: 6,
  },
  meta: {
    STARS_PER_CONSTELLATION: 12,
    VISITOR_CHANCE: 0.3,
    JAR_MAX_ITEMS: 10,
    JAR_MAX_CHARS: 60,
    JAR_RETENTION_DAYS: 7,
    MORNING_SURVEY_START_HOUR: 5,
    MORNING_SURVEY_END_HOUR: 12,
    SYNODIC_MONTH_DAYS: 29.530588,
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (isPlainObject(value) || Array.isArray(value)) {
    const values: unknown[] = Object.values(value as object);
    for (const v of values) {
      deepFreeze(v);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

// Only ever called with a plain-object `base` (structuredClone(defaults)):
// a nested value is either another plain object (recurse) or a leaf —
// including arrays like RESPAWN_DELAY_MS — which an override replaces
// wholesale rather than merging.
function deepMerge<T>(base: T, overrides: DeepPartial<T> | undefined): T {
  if (overrides === undefined) return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] = isPlainObject(baseValue) ? deepMerge(baseValue, value as never) : value;
  }
  return result as T;
}

/** The frozen, immutable defaults. Production code reads its slice from here (via bootstrap). */
export const CONFIG: DeepReadonly<Config> = deepFreeze(structuredClone(defaults));

/**
 * Deep-merges `overrides` onto {@link CONFIG} and returns a fresh, frozen
 * config. Only tests should call this — production code never overrides
 * tunables (spec §0).
 */
export function makeConfig(overrides?: DeepPartial<Config>): DeepReadonly<Config> {
  return deepFreeze(deepMerge(structuredClone(defaults), overrides));
}
