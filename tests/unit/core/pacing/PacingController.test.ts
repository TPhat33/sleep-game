import { describe, expect, it } from 'vitest';

import { CONFIG } from '@/core/config';
import type { PacingInput } from '@/core/pacing/PacingController';
import { PacingController } from '@/core/pacing/PacingController';

const cfg = CONFIG.pacing;
const deps = { pacing: CONFIG.pacing, session: CONFIG.session };

function input(overrides: Partial<PacingInput>): PacingInput {
  return {
    phase: 'play',
    now: 0,
    phaseEnteredAt: 0,
    playElapsedMs: 0,
    drowsinessScore: 0,
    lastTapAt: null,
    voicePreference: false,
    ...overrides,
  };
}

describe('PacingController: play', () => {
  it('starts at SPEED_START/DIM_START at progress 0', () => {
    const pc = new PacingController(deps);
    const out = pc.update(input({ phase: 'play', playElapsedMs: 0 }));
    expect(out.speed).toBeCloseTo(cfg.SPEED_START, 6);
    expect(out.dimAlpha).toBeCloseTo(cfg.DIM_START, 6);
    expect(out.spawnIntervalMs).toBeCloseTo(cfg.SPAWN_BASE_MS / cfg.SPEED_START, 6);
    expect(out.brightnessTarget).toBeNull();
    expect(out.voiceEnabled).toBe(false);
  });

  it('reaches SPEED_END/DIM_END_PLAY at progress 1 (playElapsedMs >= PLAY_CURVE_MS)', () => {
    const pc = new PacingController(deps);
    const out = pc.update(input({ phase: 'play', playElapsedMs: CONFIG.session.PLAY_CURVE_MS }));
    expect(out.speed).toBeCloseTo(cfg.SPEED_END, 6);
    expect(out.dimAlpha).toBeCloseTo(cfg.DIM_END_PLAY, 6);
  });

  it('progress is the max of the time curve and drowsinessScore', () => {
    const pc = new PacingController(deps);
    const out = pc.update(input({ phase: 'play', playElapsedMs: 0, drowsinessScore: 1 }));
    expect(out.speed).toBeCloseTo(cfg.SPEED_END, 6);
  });

  it('clamps progress to 1 even if playElapsedMs exceeds PLAY_CURVE_MS', () => {
    const pc = new PacingController(deps);
    const out = pc.update(
      input({ phase: 'play', playElapsedMs: CONFIG.session.PLAY_CURVE_MS * 10 }),
    );
    expect(out.speed).toBeCloseTo(cfg.SPEED_END, 6);
    expect(out.dimAlpha).toBeCloseTo(cfg.DIM_END_PLAY, 6);
  });

  it('spawnIntervalMs = SPAWN_BASE_MS / speed', () => {
    const pc = new PacingController(deps);
    const out = pc.update(
      input({ phase: 'play', playElapsedMs: CONFIG.session.PLAY_CURVE_MS / 2 }),
    );
    expect(out.spawnIntervalMs).toBeCloseTo(cfg.SPAWN_BASE_MS / out.speed, 6);
  });
});

describe('PacingController: drift', () => {
  it('uses SPEED_DRIFT and ramps dimAlpha from the play-exit value toward DIM_END_DRIFT over DRIFT_DIM_MS', () => {
    const pc = new PacingController(deps);
    const playOut = pc.update(
      input({ phase: 'play', playElapsedMs: CONFIG.session.PLAY_CURVE_MS }),
    );
    expect(playOut.dimAlpha).toBeCloseTo(cfg.DIM_END_PLAY, 6);

    const driftStart = pc.update(input({ phase: 'drift', now: 1000, phaseEnteredAt: 1000 }));
    expect(driftStart.speed).toBeCloseTo(cfg.SPEED_DRIFT, 6);
    expect(driftStart.dimAlpha).toBeCloseTo(cfg.DIM_END_PLAY, 2); // ramp start ~= where play left off

    const driftEnd = pc.update(
      input({ phase: 'drift', now: 1000 + cfg.DRIFT_DIM_MS, phaseEnteredAt: 1000 }),
    );
    expect(driftEnd.dimAlpha).toBeCloseTo(cfg.DIM_END_DRIFT, 2);
  });

  it('a tap peeks dimAlpha down by TAP_PEEK_DIM, decaying back over TAP_PEEK_MS', () => {
    const pc = new PacingController(deps);
    // Ramp well into drift first so dimAlpha is comfortably above TAP_PEEK_DIM
    // (otherwise the peek reduction would floor-clamp at 0, masking the effect).
    const midDrift = cfg.DRIFT_DIM_MS / 2;
    pc.update(input({ phase: 'drift', now: 0, phaseEnteredAt: 0 }));
    pc.update(input({ phase: 'drift', now: midDrift, phaseEnteredAt: 0 }));

    const atTap = pc.update(
      input({ phase: 'drift', now: midDrift + 100, phaseEnteredAt: 0, lastTapAt: midDrift + 100 }),
    );
    const withoutPeek = pc.update(
      input({ phase: 'drift', now: midDrift + 100, phaseEnteredAt: 0, lastTapAt: null }),
    );
    expect(withoutPeek.dimAlpha - atTap.dimAlpha).toBeCloseTo(cfg.TAP_PEEK_DIM, 2);

    const afterPeek = pc.update(
      input({
        phase: 'drift',
        now: midDrift + cfg.TAP_PEEK_MS + 100,
        phaseEnteredAt: 0,
        lastTapAt: midDrift + 100,
      }),
    );
    const noPeekAtSameTime = pc.update(
      input({
        phase: 'drift',
        now: midDrift + cfg.TAP_PEEK_MS + 100,
        phaseEnteredAt: 0,
        lastTapAt: null,
      }),
    );
    expect(afterPeek.dimAlpha).toBeCloseTo(noPeekAtSameTime.dimAlpha, 6);
  });
});

describe('PacingController: fade', () => {
  it('ramps dimAlpha to 1 over FADE_SCREEN_MS and masterVolume to 0 over FADE_AUDIO_MS, from the pre-fade values', () => {
    const pc = new PacingController(deps);
    pc.update(input({ phase: 'play', now: 0, phaseEnteredAt: 0, playElapsedMs: 0 }));

    const fadeStart = pc.update(input({ phase: 'fade', now: 1000, phaseEnteredAt: 1000 }));
    expect(fadeStart.dimAlpha).toBeCloseTo(cfg.DIM_START, 2);
    expect(fadeStart.masterVolume).toBeCloseTo(1, 2);
    expect(fadeStart.brightnessTarget).toBe(cfg.FADE_BRIGHTNESS_TARGET);

    const screenDone = pc.update(
      input({ phase: 'fade', now: 1000 + cfg.FADE_SCREEN_MS, phaseEnteredAt: 1000 }),
    );
    expect(screenDone.dimAlpha).toBeCloseTo(1, 6);

    const audioDone = pc.update(
      input({ phase: 'fade', now: 1000 + cfg.FADE_AUDIO_MS, phaseEnteredAt: 1000 }),
    );
    expect(audioDone.masterVolume).toBeCloseTo(0, 6);
  });
});

describe('PacingController: listen', () => {
  it('is pure black, minimum brightness, and voice follows the preference', () => {
    const pc = new PacingController(deps);
    const out = pc.update(input({ phase: 'listen', voicePreference: true }));
    expect(out.dimAlpha).toBe(1);
    expect(out.brightnessTarget).toBe(cfg.BRIGHTNESS_MIN);
    expect(out.voiceEnabled).toBe(true);
  });
});

describe('PacingController: reset', () => {
  it('reset() clears continuity state so the next phase ramps from DIM_START again', () => {
    const pc = new PacingController(deps);
    pc.update(input({ phase: 'play', playElapsedMs: CONFIG.session.PLAY_CURVE_MS }));
    pc.reset();
    const out = pc.update(input({ phase: 'drift', now: 0, phaseEnteredAt: 0 }));
    expect(out.dimAlpha).toBeCloseTo(cfg.DIM_START, 2);
  });
});
