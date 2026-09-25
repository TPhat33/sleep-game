// Pure planning for the shuffle-voice word schedule — spec §9.2, plan §1.8.
// Kept separate from AudioEngine so the timeline math is testable without
// any AudioContext at all.
import type { AudioConfig } from '../core/config';
import { pickNoRepeat } from '../core/rng';
import type { Rng } from '../core/rng';

export interface ShuffleWordEvent {
  /** ms from the start of the schedule. */
  atMs: number;
  wordIndex: number;
}

type ShuffleTimingConfig = Pick<
  AudioConfig,
  'SHUFFLE_GAP_MIN_MS' | 'SHUFFLE_GAP_MAX_MS' | 'SHUFFLE_NO_REPEAT'
>;

/**
 * Plans every shuffle-word start time for a full listen session up front:
 * gaps drawn from `rng` within [SHUFFLE_GAP_MIN_MS, SHUFFLE_GAP_MAX_MS],
 * stretched by LISTEN_TAIL_GAP_MULT once within one LISTEN_TAIL_MS of the
 * tail, and nothing at all scheduled inside the final LISTEN_TAIL_MS (spec
 * §9.2: "ระยะห่างค่อยๆ ยาวขึ้น x1.5 แล้วหยุดใน LISTEN_TAIL_MS สุดท้าย").
 */
export function planListenShuffleSchedule(
  rng: Rng,
  wordCount: number,
  cfg: ShuffleTimingConfig & { LISTEN_TAIL_MS: number; LISTEN_TAIL_GAP_MULT: number },
  durationMs: number,
): ShuffleWordEvent[] {
  if (wordCount === 0) return [];

  const tailStart = durationMs - cfg.LISTEN_TAIL_MS;
  const stretchStart = Math.max(0, tailStart - cfg.LISTEN_TAIL_MS);
  const indices = Array.from({ length: wordCount }, (_, i) => i);

  const events: ShuffleWordEvent[] = [];
  const recent: number[] = [];
  let elapsed = 0;
  for (;;) {
    const inStretchZone = elapsed >= stretchStart;
    const baseGap =
      cfg.SHUFFLE_GAP_MIN_MS + rng.next() * (cfg.SHUFFLE_GAP_MAX_MS - cfg.SHUFFLE_GAP_MIN_MS);
    const gap = inStretchZone ? baseGap * cfg.LISTEN_TAIL_GAP_MULT : baseGap;
    const next = elapsed + gap;
    if (next >= tailStart) break;
    elapsed = next;

    const idx = pickNoRepeat(rng, indices, recent);
    recent.push(idx);
    if (recent.length > cfg.SHUFFLE_NO_REPEAT) recent.shift();
    events.push({ atMs: elapsed, wordIndex: idx });
  }
  return events;
}
