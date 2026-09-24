// The provide/inject contract between bootstrap.ts (the composition root)
// and the Vue UI (plan §1.7: no Pinia — services are created once and
// supplied via app.provide/inject instead).

import type { InjectionKey } from 'vue';

import type { Clock } from '../core/clock';
import type { AppEvents, EventBus } from '../core/events';
import type { Rng } from '../core/rng';
import type { Platform } from '../platform/Platform';

export interface Services {
  clock: Clock;
  rng: Rng;
  bus: EventBus<AppEvents>;
  platform: Platform;
}

export const ServicesKey: InjectionKey<Services> = Symbol('services');
