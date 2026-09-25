// The composition root (plan §1.2): the only place that calls `new
// RealClock()`, `createPlatform()`, `openAppDb()`, etc. Everything else
// receives its dependencies through its constructor.

import { AudioEngine } from '../audio/AudioEngine';
import { createLoadBuffer } from '../audio/loadBuffer';
import { RealClock } from '../core/clock';
import { CONFIG } from '../core/config';
import { DrowsinessEstimator } from '../core/drowsiness/DrowsinessEstimator';
import { EventBus } from '../core/events';
import type { AppEvents } from '../core/events';
import { NightWakeDetector } from '../core/nightwake/NightWakeDetector';
import { PacingController } from '../core/pacing/PacingController';
import { systemRng } from '../core/rng';
import { SessionDirector } from '../core/session/SessionDirector';
import { createPlatform } from '../platform';
import visitors from '../content/visitors.json';
import words from '../content/words.th.json';
import { openAppDb } from '../store/db';
import { Repositories } from '../store/repositories';
import { SessionRuntime } from './SessionRuntime';
import { VisitorReveal } from './VisitorReveal';
import type { Services } from './services';

function createAudioContext(): AudioContext {
  return new AudioContext({ latencyHint: 'playback' });
}

export async function bootstrap(): Promise<Services> {
  const clock = new RealClock();
  const rng = systemRng;
  const bus = new EventBus<AppEvents>();
  const platform = await createPlatform();
  const db = await openAppDb();
  const ids = (): string => crypto.randomUUID();

  const repositories = new Repositories(db, clock, ids);
  const estimator = new DrowsinessEstimator(clock, CONFIG.drowsiness);
  const nightWake = new NightWakeDetector(clock, CONFIG.nightWake);
  const director = new SessionDirector({
    clock,
    bus,
    cfg: CONFIG,
    estimator,
    nightWake,
    ids,
  });
  const pacing = new PacingController({ pacing: CONFIG.pacing, session: CONFIG.session });

  const audioEngine = new AudioEngine(
    clock,
    { audio: CONFIG.audio, scene: CONFIG.scene },
    {
      rng,
      createContext: createAudioContext,
      loadBuffer: createLoadBuffer(rng, CONFIG.audio.BROWN_NOISE_LOOP_S),
      outputKind: CONFIG.audio.OUTPUT_STRATEGY[platform.info.kind],
      words,
    },
  );

  const sessionRuntime = new SessionRuntime({
    bus,
    platform,
    audioEngine,
    sessions: repositories.sessions,
    cfg: { pacing: CONFIG.pacing, audio: CONFIG.audio },
  });

  const visitorReveal = new VisitorReveal({
    bus,
    rng,
    progress: repositories.progress,
    visitors,
    visitorChance: CONFIG.meta.VISITOR_CHANCE,
  });

  return {
    clock,
    rng,
    bus,
    platform,
    ids,
    repositories,
    estimator,
    nightWake,
    director,
    pacing,
    audioEngine,
    sessionRuntime,
    visitorReveal,
  };
}
