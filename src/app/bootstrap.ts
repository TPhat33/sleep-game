// The composition root (plan §1.2): the only place that calls `new
// RealClock()`, `createPlatform()`, etc. Everything else receives its
// dependencies through its constructor.

import { RealClock } from '../core/clock';
import { EventBus } from '../core/events';
import type { AppEvents } from '../core/events';
import { systemRng } from '../core/rng';
import { createPlatform } from '../platform';
import type { Services } from './services';

export async function bootstrap(): Promise<Services> {
  const clock = new RealClock();
  const rng = systemRng;
  const bus = new EventBus<AppEvents>();
  const platform = await createPlatform();

  return { clock, rng, bus, platform };
}
