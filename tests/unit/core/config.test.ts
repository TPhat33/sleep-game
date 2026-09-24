import { describe, expect, it } from 'vitest';

import { CONFIG, makeConfig } from '@/core/config';

describe('CONFIG', () => {
  it('is frozen at every level', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
    expect(Object.isFrozen(CONFIG.session)).toBe(true);
    expect(Object.isFrozen(CONFIG.drowsiness.WEIGHTS)).toBe(true);
    expect(Object.isFrozen(CONFIG.drowsiness.DEFAULT_BASELINE.rtMedian)).toBe(true);
  });

  it('matches every spec §13 value', () => {
    expect(CONFIG.session.PLAY_MAX_MS).toBe(25 * 60_000);
    expect(CONFIG.session.PLAY_CURVE_MS).toBe(20 * 60_000);
    expect(CONFIG.session.LISTEN_OFFER_MS).toBe(20 * 60_000);
    expect(CONFIG.session.GENTLE_EXIT_MS).toBe(30 * 60_000);
    expect(CONFIG.session.IDLE_TO_FADE_MS).toBe(45_000);

    expect(CONFIG.drowsiness.BASELINE_MS).toBe(120_000);
    expect(CONFIG.drowsiness.BASELINE_MIN_TAPS).toBe(15);
    expect(CONFIG.drowsiness.WINDOW_MS).toBe(60_000);
    expect(CONFIG.drowsiness.WINDOW_STEP_MS).toBe(15_000);
    expect(CONFIG.drowsiness.WEIGHTS).toEqual({
      rtMedian: 0.35,
      itiMedian: 0.25,
      itiCv: 0.2,
      missRate: 0.2,
    });
    expect(CONFIG.drowsiness.BIAS).toBe(1.5);
    expect(CONFIG.drowsiness.EMA_ALPHA).toBe(0.3);
    expect(CONFIG.drowsiness.DRIFT_THRESHOLD).toBe(0.6);
    expect(CONFIG.drowsiness.DRIFT_CONFIRM_WINDOWS).toBe(2);
    expect(CONFIG.drowsiness.ALERT_THRESHOLD).toBe(0.3);
    expect(CONFIG.drowsiness.NO_TAP_WINDOW_SCORE).toBe(0.8);
    expect(CONFIG.drowsiness.STD_FLOOR).toEqual({
      rtMedian: 80,
      itiMedian: 150,
      itiCv: 0.05,
      missRate: 0.05,
    });
    expect(CONFIG.drowsiness.DEFAULT_BASELINE).toEqual({
      rtMedian: { mean: 900, std: 250 },
      itiMedian: { mean: 2200, std: 600 },
      itiCv: { mean: 0.35, std: 0.1 },
      missRate: { mean: 0.1, std: 0.05 },
    });

    expect(CONFIG.pacing.SPEED_START).toBe(1.0);
    expect(CONFIG.pacing.SPEED_END).toBe(0.4);
    expect(CONFIG.pacing.SPEED_DRIFT).toBe(0.25);
    expect(CONFIG.pacing.SPAWN_BASE_MS).toBe(3500);
    expect(CONFIG.pacing.DIM_START).toBe(0.0);
    expect(CONFIG.pacing.DIM_END_PLAY).toBe(0.55);
    expect(CONFIG.pacing.DIM_END_DRIFT).toBe(0.85);
    expect(CONFIG.pacing.DRIFT_DIM_MS).toBe(5 * 60_000);
    expect(CONFIG.pacing.FADE_SCREEN_MS).toBe(8_000);
    expect(CONFIG.pacing.FADE_AUDIO_MS).toBe(60_000);
    expect(CONFIG.pacing.TAP_PEEK_DIM).toBe(0.2);
    expect(CONFIG.pacing.TAP_PEEK_MS).toBe(4_000);
    expect(CONFIG.pacing.BRIGHTNESS_MIN).toBe(0.02);

    expect(CONFIG.scene.MAX_DREAMS_ON_SCREEN).toBe(6);
    expect(CONFIG.scene.NO_REPEAT_WINDOW).toBe(12);
    expect(CONFIG.scene.BASE_DRIFT_PX_S).toBe(40);
    expect(CONFIG.scene.RESPAWN_DELAY_MS).toEqual([10_000, 20_000]);
    expect(CONFIG.scene.STAR_RISE_MS).toBe(2_500);
    expect(CONFIG.scene.BREATH_PERIOD_MS).toBe(10_000);
    expect(CONFIG.scene.BREATH_TOLERANCE_MS).toBe(600);
    expect(CONFIG.scene.SFX_MAX_GAIN).toBe(0.25);

    expect(CONFIG.audio.SHUFFLE_GAP_MIN_MS).toBe(8_000);
    expect(CONFIG.audio.SHUFFLE_GAP_MAX_MS).toBe(14_000);
    expect(CONFIG.audio.LISTEN_TAIL_MS).toBe(5 * 60_000);
    expect(CONFIG.audio.LISTEN_OPTIONS_MIN).toEqual([30, 60, 90]);

    expect(CONFIG.nightWake.NIGHT_START_HOUR).toBe(22);
    expect(CONFIG.nightWake.NIGHT_END_HOUR).toBe(5);
    expect(CONFIG.nightWake.NIGHT_WAKE_WINDOW_MS).toBe(3 * 60 * 60_000);
    expect(CONFIG.nightWake.REVEAL_START_HOUR).toBe(6);

    expect(CONFIG.meta.STARS_PER_CONSTELLATION).toBe(12);
    expect(CONFIG.meta.VISITOR_CHANCE).toBe(0.3);
    expect(CONFIG.meta.JAR_MAX_ITEMS).toBe(10);
    expect(CONFIG.meta.JAR_MAX_CHARS).toBe(60);
    expect(CONFIG.meta.JAR_RETENTION_DAYS).toBe(7);
  });

  it('includes the plan §1.5 additions', () => {
    expect(CONFIG.session.GENTLE_EXIT_CONFIRM_WINDOWS).toBe(2);
    expect(CONFIG.session.APP_BACKGROUND_GRACE_MS).toBe(10_000);
    expect(CONFIG.drowsiness.BASELINE_SUBWINDOW_MS).toBe(30_000);
    expect(CONFIG.drowsiness.Z_CLAMP).toBe(3);
    expect(CONFIG.pacing.FADE_BRIGHTNESS_TARGET).toBe(0.02);
    expect(CONFIG.scene.FPS_PLAY).toBe(30);
    expect(CONFIG.scene.FPS_DRIFT).toBe(20);
    expect(CONFIG.audio.SHUFFLE_NO_REPEAT).toBe(30);
    expect(CONFIG.audio.OUTPUT_STRATEGY).toEqual({
      web: 'webaudio-direct',
      ios: 'webaudio-direct',
      android: 'webaudio-direct',
    });
    expect(CONFIG.meta.SYNODIC_MONTH_DAYS).toBeCloseTo(29.530588, 6);
  });
});

describe('makeConfig', () => {
  it('deep-merges overrides onto CONFIG without mutating it', () => {
    const original = CONFIG.drowsiness.DRIFT_THRESHOLD;
    const overridden = makeConfig({ drowsiness: { DRIFT_THRESHOLD: 0.9 } });

    expect(overridden.drowsiness.DRIFT_THRESHOLD).toBe(0.9);
    expect(overridden.drowsiness.BASELINE_MS).toBe(CONFIG.drowsiness.BASELINE_MS);
    expect(CONFIG.drowsiness.DRIFT_THRESHOLD).toBe(original);
  });

  it('returns a frozen config', () => {
    const overridden = makeConfig({ session: { PLAY_MAX_MS: 1_000 } });
    expect(Object.isFrozen(overridden)).toBe(true);
    expect(Object.isFrozen(overridden.session)).toBe(true);
  });

  it('with no overrides equals CONFIG by value', () => {
    expect(makeConfig()).toEqual(CONFIG);
  });
});
