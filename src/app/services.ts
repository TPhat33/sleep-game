// The provide/inject contract between bootstrap.ts (the composition root)
// and the Vue UI (plan §1.7: no Pinia — services are created once and
// supplied via app.provide/inject instead).

import type { InjectionKey } from 'vue';

import type { AudioEngine } from '../audio/AudioEngine';
import type { Clock } from '../core/clock';
import type { AppEvents, EventBus } from '../core/events';
import type { DrowsinessEstimator } from '../core/drowsiness/DrowsinessEstimator';
import type { NightWakeDetector } from '../core/nightwake/NightWakeDetector';
import type { PacingController } from '../core/pacing/PacingController';
import type { Rng } from '../core/rng';
import type { SessionDirector } from '../core/session/SessionDirector';
import type { Platform } from '../platform/Platform';
import type { Repositories } from '../store/repositories';
import type { SessionRuntime } from './SessionRuntime';

export interface Services {
  clock: Clock;
  rng: Rng;
  bus: EventBus<AppEvents>;
  platform: Platform;
  ids: () => string;
  repositories: Repositories;
  estimator: DrowsinessEstimator;
  nightWake: NightWakeDetector;
  director: SessionDirector;
  pacing: PacingController;
  audioEngine: AudioEngine;
  /** Not read directly by the UI — held so its bus subscriptions (plan §1.9) stay alive for the app's lifetime. */
  sessionRuntime: SessionRuntime;
}

export const ServicesKey: InjectionKey<Services> = Symbol('services');
