// Spec §10. When isNightWake() is true, SessionDirector.start() skips
// settle and enters listen directly, at minimum brightness, with no
// visitor reveal and no morning survey (enforced by callers, not here —
// this class only answers the yes/no question).

import type { NightWakeConfig } from '../config';
import type { Clock } from '../clock';
import { localHour } from '../time';
import type { LastSessionInfo } from '../types';

export class NightWakeDetector {
  constructor(
    private readonly clock: Clock,
    private readonly cfg: NightWakeConfig,
  ) {}

  isNightWake(last: LastSessionInfo | null): boolean {
    if (!last) return false;
    const within = this.endedWithinWindow(last);
    if (!within) return false;

    const hour = localHour(this.clock.now());
    const isNightHour = hour >= this.cfg.NIGHT_START_HOUR || hour < this.cfg.NIGHT_END_HOUR;
    const endedBySleep = last.endReason === 'fade' || last.endReason === 'listen_timer';

    return isNightHour || endedBySleep;
  }

  /** REVEAL_START_HOUR <= hour < NIGHT_START_HOUR — the daytime window a pending visitor/morning survey may show in. */
  isRevealWindow(): boolean {
    const hour = localHour(this.clock.now());
    return hour >= this.cfg.REVEAL_START_HOUR && hour < this.cfg.NIGHT_START_HOUR;
  }

  private endedWithinWindow(last: LastSessionInfo): boolean {
    return this.clock.now() - last.endedAt <= this.cfg.NIGHT_WAKE_WINDOW_MS;
  }
}
