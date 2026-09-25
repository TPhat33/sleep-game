// spec §11: "ทุกดาวที่ได้ต่อเข้ากลุ่มดาวปัจจุบัน (กลุ่มละ STARS_PER_CONSTELLATION
// ดวง ตาม constellations.json) ครบแล้วปลดล็อก unlock ถัดไป" — earned stars
// fill the current (first incomplete) constellation in order; once full, the
// next constellation becomes current. Pure so it's testable without the
// store layer — callers (Pond.vue) build the counts from ProgressRecord.

import type { ConstellationDef } from './types';

export interface StarSlot {
  constellationId: string;
  index: number;
  /** True iff this star is the one that fills the constellation. */
  completesConstellation: boolean;
}

/** Where the next earned star should go, or null once every constellation is already complete. */
export function nextStarSlot(
  constellations: readonly ConstellationDef[],
  completedIds: ReadonlySet<string>,
  starCountByConstellation: ReadonlyMap<string, number>,
): StarSlot | null {
  for (const constellation of constellations) {
    if (completedIds.has(constellation.id)) continue;
    const count = starCountByConstellation.get(constellation.id) ?? 0;
    if (count >= constellation.stars.length) continue;
    return {
      constellationId: constellation.id,
      index: count,
      completesConstellation: count + 1 >= constellation.stars.length,
    };
  }
  return null;
}
