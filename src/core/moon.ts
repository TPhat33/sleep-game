// Moon phase from a date — spec §11: "used to slightly adjust the scene."
// A pure function of (epochMs, synodicMonthDays); the caller supplies
// CONFIG.meta.SYNODIC_MONTH_DAYS so this file never imports config itself.

export type MoonPhaseName =
  | 'new'
  | 'waxingCrescent'
  | 'firstQuarter'
  | 'waxingGibbous'
  | 'full'
  | 'waningGibbous'
  | 'lastQuarter'
  | 'waningCrescent';

export interface MoonPhase {
  /** 0..1 through the synodic month; 0 = new moon, 0.5 = full moon. */
  age: number;
  /** 0..1 fraction illuminated. */
  illumination: number;
  name: MoonPhaseName;
}

/** 2000-01-06T18:14:00Z — a commonly used reference new moon for simplified phase calculators. */
export const REFERENCE_NEW_MOON_MS = 947_182_440_000;

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * 60_000;
const PHASE_NAMES: readonly MoonPhaseName[] = [
  'new',
  'waxingCrescent',
  'firstQuarter',
  'waxingGibbous',
  'full',
  'waningGibbous',
  'lastQuarter',
  'waningCrescent',
];
const PHASE_COUNT = PHASE_NAMES.length;

/** 0..1 through the cycle; 0 (and 1) is new moon, 0.5 is full moon. */
export function moonAge(
  epochMs: number,
  synodicMonthDays: number,
  referenceNewMoonMs: number = REFERENCE_NEW_MOON_MS,
): number {
  const daysSinceReference = (epochMs - referenceNewMoonMs) / MS_PER_DAY;
  const cycles = daysSinceReference / synodicMonthDays;
  const fraction = cycles - Math.floor(cycles);
  return fraction;
}

function moonPhaseName(age: number): MoonPhaseName {
  const shifted = (age + 1 / (2 * PHASE_COUNT)) % 1;
  const index = Math.floor(shifted * PHASE_COUNT) % PHASE_COUNT;
  const name = PHASE_NAMES[index];
  if (!name) throw new RangeError('moonPhaseName: index out of range');
  return name;
}

export function moonPhase(epochMs: number, synodicMonthDays: number): MoonPhase {
  const age = moonAge(epochMs, synodicMonthDays);
  const illumination = (1 - Math.cos(2 * Math.PI * age)) / 2;
  return { age, illumination, name: moonPhaseName(age) };
}
