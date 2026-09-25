// Pure play-loop simulation — spec §8: dream spawning (no-repeat within
// NO_REPEAT_WINDOW), the respawn queue, boats + capacity, and star
// creation. No Pixi, no Clock (time arrives as `now` on each call, like
// PacingController) — the caller (scene/entities + PondScene, M2+) renders
// this state each frame and reports taps back in.
//
// Path progress (`t`, 0..1) is deliberately unit-less here: converting a
// pixel speed (BASE_DRIFT_PX_S * pacing speed) into a per-call `deltaT`
// is the caller's job, using stream.ts's pointAtT/estimatePathLengthPx for
// the current viewport. That keeps this model free of any viewport state.

import { randInt, randRange } from '../../core/rng';
import type { Rng } from '../../core/rng';
import type { SceneConfig } from '../../core/config';
import type { DreamColor, DreamDef } from '../../core/types';
import { isExhaleWindow } from './breath';

export interface DreamInstance {
  readonly instanceId: string;
  readonly defId: string;
  readonly color: DreamColor;
  /** 0 (spawn) .. 1 (off-screen). */
  t: number;
  readonly spawnedAt: number;
}

export type BoatCounts = Record<DreamColor, number>;

export interface TapResult {
  readonly color: DreamColor;
  /** Tapped during the exhale half of the breath cycle (± BREATH_TOLERANCE_MS) — spec §8. */
  readonly golden: boolean;
  /** True iff this tap filled the boat to BOAT_CAPACITY — the caller should emit a star and call SessionDirector.starEarned(golden). */
  readonly boatFilled: boolean;
}

export interface PondModelDeps {
  rng: Rng;
  dreams: readonly DreamDef[];
  cfg: Pick<
    SceneConfig,
    | 'MAX_DREAMS_ON_SCREEN'
    | 'NO_REPEAT_WINDOW'
    | 'RESPAWN_DELAY_MS'
    | 'BOAT_CAPACITY'
    | 'BREATH_PERIOD_MS'
    | 'BREATH_TOLERANCE_MS'
  >;
}

export const DREAM_COLORS: readonly DreamColor[] = ['amber', 'ember', 'moss'];

export class PondModel {
  private readonly active: DreamInstance[] = [];
  /** Recently exited-unresolved dream ids, excluded from spawning until their cooldown passes — spec §8's RESPAWN_DELAY_MS. */
  private readonly cooldownUntil = new Map<string, number>();
  /** Ring of the last NO_REPEAT_WINDOW spawned def ids. */
  private readonly recentDefIds: string[] = [];
  private readonly boats: BoatCounts = { amber: 0, ember: 0, moss: 0 };
  private nextInstanceSeq = 0;
  private breathAnchorMs = 0;

  constructor(private readonly deps: PondModelDeps) {}

  get activeDreams(): readonly DreamInstance[] {
    return this.active;
  }

  get boatCounts(): Readonly<BoatCounts> {
    return this.boats;
  }

  /** Call once when 'play' is entered (or re-entered), so the exhale window is anchored to that moment. */
  startBreath(now: number): void {
    this.breathAnchorMs = now;
  }

  breathPhaseMs(now: number): number {
    return now - this.breathAnchorMs;
  }

  /**
   * Advances every active dream's path progress by `deltaT` and removes any
   * that reached the end unresolved, putting their def on cooldown. Returns
   * the instances that exited this call, for the caller to despawn views.
   */
  update(now: number, deltaT: number): { exited: readonly DreamInstance[] } {
    const exited: DreamInstance[] = [];
    for (let i = this.active.length - 1; i >= 0; i--) {
      const dream = this.active[i];
      /* v8 ignore next -- i is in range by construction (loop bound), guards noUncheckedIndexedAccess. */
      if (!dream) continue;
      dream.t += deltaT;
      if (dream.t >= 1) {
        this.active.splice(i, 1);
        exited.push(dream);
        this.queueCooldown(dream.defId, now);
      }
    }
    return { exited };
  }

  /** Spawns one new dream if there's room, picking a def that isn't on cooldown or in the recent-repeat window. Called on the pacing-driven spawn timer. */
  trySpawn(now: number): DreamInstance | null {
    if (this.active.length >= this.deps.cfg.MAX_DREAMS_ON_SCREEN) return null;
    const def = this.pickSpawnable(now);
    if (!def) return null;

    this.recentDefIds.push(def.id);
    if (this.recentDefIds.length > this.deps.cfg.NO_REPEAT_WINDOW) this.recentDefIds.shift();

    const instance: DreamInstance = {
      instanceId: `dream-${String(this.nextInstanceSeq++)}`,
      defId: def.id,
      color: def.color,
      t: 0,
      spawnedAt: now,
    };
    this.active.push(instance);
    return instance;
  }

  /** The scene layer resolves hit-testing (screen-space) and calls this with the tapped instance's id. Returns null if it's no longer active (already exited/tapped). */
  tapDream(instanceId: string, now: number): TapResult | null {
    const idx = this.active.findIndex((d) => d.instanceId === instanceId);
    if (idx === -1) return null;
    const dream = this.active[idx];
    /* v8 ignore next -- idx came from findIndex on this.active, so it's in range. */
    if (!dream) return null;
    this.active.splice(idx, 1);

    const golden = isExhaleWindow(
      this.breathPhaseMs(now),
      this.deps.cfg.BREATH_PERIOD_MS,
      this.deps.cfg.BREATH_TOLERANCE_MS,
    );

    const color = dream.color;
    const filled = this.boats[color] + 1 >= this.deps.cfg.BOAT_CAPACITY;
    this.boats[color] = filled ? 0 : this.boats[color] + 1;

    return { color, golden, boatFilled: filled };
  }

  private queueCooldown(defId: string, now: number): void {
    const delay = randRange(this.deps.rng, this.deps.cfg.RESPAWN_DELAY_MS);
    this.cooldownUntil.set(defId, now + delay);
  }

  private pickSpawnable(now: number): DreamDef | null {
    if (this.deps.dreams.length === 0) return null;
    const recentSet = new Set(this.recentDefIds);
    const eligible = this.deps.dreams.filter((d) => {
      if (recentSet.has(d.id)) return false;
      const until = this.cooldownUntil.get(d.id);
      return until === undefined || until <= now;
    });
    const pool = eligible.length > 0 ? eligible : this.deps.dreams;
    const picked = pool[randInt(this.deps.rng, 0, pool.length - 1)];
    return picked ?? null;
  }
}
