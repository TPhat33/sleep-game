// spec §11 "แขกยามค่ำ": when a session ends with 'fade' or 'listen_timer'
// (the player fell asleep, rather than exiting or backgrounding), there's
// a VISITOR_CHANCE random chance a visitor is queued as `pendingVisitor`.
// Sky.vue is what actually reveals it, gated to the daytime reveal window
// (NightWakeDetector.isRevealWindow()) — this class only queues it.
import type { AppEvents, EventBus, Unsubscribe } from '../core/events';
import { randInt } from '../core/rng';
import type { Rng } from '../core/rng';
import type { EndReason, VisitorDef } from '../core/types';
import type { ProgressRepository } from '../store/repositories';

export interface VisitorRevealDeps {
  bus: EventBus<AppEvents>;
  rng: Rng;
  progress: ProgressRepository;
  visitors: readonly VisitorDef[];
  visitorChance: number;
}

const SLEEP_END_REASONS: readonly EndReason[] = ['fade', 'listen_timer'];

export class VisitorReveal {
  private readonly off: Unsubscribe;

  constructor(private readonly deps: VisitorRevealDeps) {
    this.off = deps.bus.on('session:ended', (e) => {
      void this.handleEnded(e.summary.endReason);
    });
  }

  dispose(): void {
    this.off();
  }

  private async handleEnded(endReason: EndReason): Promise<void> {
    if (!SLEEP_END_REASONS.includes(endReason)) return;
    if (this.deps.rng.next() >= this.deps.visitorChance) return;

    const progress = await this.deps.progress.get();
    if (progress.pendingVisitor !== null) return; // don't overwrite one that hasn't been revealed yet
    if (this.deps.visitors.length === 0) return;

    const uncollected = this.deps.visitors.filter((v) => !progress.visitors.includes(v.id));
    const pool = uncollected.length > 0 ? uncollected : this.deps.visitors;
    const visitor = pool[randInt(this.deps.rng, 0, pool.length - 1)];
    if (!visitor) return;

    await this.deps.progress.setPendingVisitor(visitor.id);
  }
}
