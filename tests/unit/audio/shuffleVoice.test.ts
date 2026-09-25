import { describe, expect, it } from 'vitest';

import { CONFIG } from '@/core/config';
import { seededRng } from '@/core/rng';
import { planListenShuffleSchedule } from '@/audio/shuffleVoice';

const cfg = CONFIG.audio;
const WORD_COUNT = 150;

describe('planListenShuffleSchedule', () => {
  it('keeps every gap within [SHUFFLE_GAP_MIN_MS, SHUFFLE_GAP_MAX_MS * LISTEN_TAIL_GAP_MULT]', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const events = planListenShuffleSchedule(seededRng(seed), WORD_COUNT, cfg, 30 * 60_000);
      let prev = 0;
      for (const e of events) {
        const gap = e.atMs - prev;
        expect(gap).toBeGreaterThanOrEqual(cfg.SHUFFLE_GAP_MIN_MS - 1e-6);
        expect(gap).toBeLessThanOrEqual(cfg.SHUFFLE_GAP_MAX_MS * cfg.LISTEN_TAIL_GAP_MULT + 1e-6);
        prev = e.atMs;
      }
    }
  });

  it('schedules nothing within the final LISTEN_TAIL_MS', () => {
    const durationMs = 30 * 60_000;
    const events = planListenShuffleSchedule(seededRng(7), WORD_COUNT, cfg, durationMs);
    const tailStart = durationMs - cfg.LISTEN_TAIL_MS;
    for (const e of events) {
      expect(e.atMs).toBeLessThan(tailStart);
    }
  });

  it('stretches gaps by LISTEN_TAIL_GAP_MULT once within one LISTEN_TAIL_MS of the tail', () => {
    const durationMs = 30 * 60_000;
    const tailStart = durationMs - cfg.LISTEN_TAIL_MS;
    const stretchStart = tailStart - cfg.LISTEN_TAIL_MS;
    const events = planListenShuffleSchedule(seededRng(3), WORD_COUNT, cfg, durationMs);

    let prev = 0;
    let sawStretchedGap = false;
    for (const e of events) {
      const gap = e.atMs - prev;
      if (prev >= stretchStart) {
        expect(gap).toBeGreaterThanOrEqual(
          cfg.SHUFFLE_GAP_MIN_MS * cfg.LISTEN_TAIL_GAP_MULT - 1e-6,
        );
        sawStretchedGap = true;
      }
      prev = e.atMs;
    }
    expect(sawStretchedGap).toBe(true);
  });

  it('never repeats a word within the last SHUFFLE_NO_REPEAT picks', () => {
    for (const seed of [1, 2, 3]) {
      const events = planListenShuffleSchedule(seededRng(seed), WORD_COUNT, cfg, 90 * 60_000);
      const indices = events.map((e) => e.wordIndex);
      for (let i = 0; i < indices.length; i++) {
        const windowStart = Math.max(0, i - cfg.SHUFFLE_NO_REPEAT);
        const recentWindow = indices.slice(windowStart, i);
        expect(recentWindow).not.toContain(indices[i]);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = planListenShuffleSchedule(seededRng(42), WORD_COUNT, cfg, 60 * 60_000);
    const b = planListenShuffleSchedule(seededRng(42), WORD_COUNT, cfg, 60 * 60_000);
    expect(a).toEqual(b);
  });

  it('produces events in strictly increasing time order', () => {
    const events = planListenShuffleSchedule(seededRng(9), WORD_COUNT, cfg, 45 * 60_000);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.atMs).toBeGreaterThan(events[i - 1]!.atMs);
    }
  });

  it('returns an empty schedule when wordCount is 0', () => {
    expect(planListenShuffleSchedule(seededRng(1), 0, cfg, 30 * 60_000)).toEqual([]);
  });

  it('handles a very short duration (shorter than 2x LISTEN_TAIL_MS) without throwing', () => {
    expect(() => planListenShuffleSchedule(seededRng(1), WORD_COUNT, cfg, 60_000)).not.toThrow();
    const events = planListenShuffleSchedule(seededRng(1), WORD_COUNT, cfg, 60_000);
    expect(events).toEqual([]); // tailStart <= 0, so nothing can be scheduled before it
  });
});
