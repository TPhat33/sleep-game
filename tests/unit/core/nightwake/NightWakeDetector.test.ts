import { describe, expect, it } from 'vitest';

import { CONFIG } from '@/core/config';
import { FakeClock } from '@/core/clock';
import { NightWakeDetector } from '@/core/nightwake/NightWakeDetector';
import type { LastSessionInfo } from '@/core/types';

// FakeClock's default start is 2026-01-15T22:00:00+07:00 (night hour, 22).
const NIGHT_START = 1_768_489_200_000;
const HOUR_MS = 60 * 60_000;

function detectorAt(epochMs: number): NightWakeDetector {
  return new NightWakeDetector(new FakeClock(epochMs), CONFIG.nightWake);
}

describe('NightWakeDetector.isNightWake', () => {
  it('is false with no last session', () => {
    const detector = detectorAt(NIGHT_START);
    expect(detector.isNightWake(null)).toBe(false);
  });

  it('is false when the last session ended too long ago', () => {
    const detector = detectorAt(NIGHT_START);
    const last: LastSessionInfo = {
      endedAt: NIGHT_START - CONFIG.nightWake.NIGHT_WAKE_WINDOW_MS - 1,
      endReason: 'fade',
    };
    expect(detector.isNightWake(last)).toBe(false);
  });

  it('is true at a night hour with a recently ended session (any reason)', () => {
    const detector = detectorAt(NIGHT_START); // hour 22
    const last: LastSessionInfo = { endedAt: NIGHT_START - HOUR_MS, endReason: 'user_exit' };
    expect(detector.isNightWake(last)).toBe(true);
  });

  it('is true just after midnight (hour < NIGHT_END_HOUR)', () => {
    const detector = detectorAt(NIGHT_START + 2 * HOUR_MS); // hour 0
    const last: LastSessionInfo = { endedAt: NIGHT_START + HOUR_MS, endReason: 'user_exit' };
    expect(detector.isNightWake(last)).toBe(true);
  });

  it('is false during the day with a non-sleep end reason', () => {
    const noonEpoch = NIGHT_START + 14 * HOUR_MS; // 22:00 + 14h = 12:00 next day
    const detector = detectorAt(noonEpoch);
    const last: LastSessionInfo = { endedAt: noonEpoch - HOUR_MS, endReason: 'user_exit' };
    expect(detector.isNightWake(last)).toBe(false);
  });

  it('is true during the day if the last session ended by fade or listen_timer', () => {
    const noonEpoch = NIGHT_START + 14 * HOUR_MS; // 12:00
    const detector = detectorAt(noonEpoch);
    const fadeLast: LastSessionInfo = { endedAt: noonEpoch - HOUR_MS, endReason: 'fade' };
    const listenLast: LastSessionInfo = { endedAt: noonEpoch - HOUR_MS, endReason: 'listen_timer' };
    expect(detector.isNightWake(fadeLast)).toBe(true);
    expect(detector.isNightWake(listenLast)).toBe(true);
  });

  it('is false during the day with app_background even within the window', () => {
    const noonEpoch = NIGHT_START + 14 * HOUR_MS;
    const detector = detectorAt(noonEpoch);
    const last: LastSessionInfo = { endedAt: noonEpoch - HOUR_MS, endReason: 'app_background' };
    expect(detector.isNightWake(last)).toBe(false);
  });
});

describe('NightWakeDetector.isRevealWindow', () => {
  it('is true between REVEAL_START_HOUR and NIGHT_START_HOUR', () => {
    const morning = NIGHT_START + 9 * HOUR_MS; // hour 7
    expect(detectorAt(morning).isRevealWindow()).toBe(true);
  });

  it('is false at night', () => {
    expect(detectorAt(NIGHT_START).isRevealWindow()).toBe(false); // hour 22
  });

  it('is false before REVEAL_START_HOUR', () => {
    const preDawn = NIGHT_START + 7 * HOUR_MS; // hour 5
    expect(detectorAt(preDawn).isRevealWindow()).toBe(false);
  });
});
