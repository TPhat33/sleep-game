// Orchestrates the play/drift/fade scene: owns the Pixi Application, drives
// PondModel + PacingController each frame, syncs entities to model state,
// and turns taps into SessionDirector/AudioEngine/persistence side effects.
// This is the one place all the pieces from tasks 24-26 actually meet —
// deliberately not unit-tested (no DOM/canvas in this harness); the pieces
// it calls (PondModel, breath, stream, PacingController, SessionDirector)
// are each tested on their own.
import { Application } from 'pixi.js';
// Our CSP (spec §0's "no data leaves the device" hardening) has no
// 'unsafe-eval' in script-src, but Pixi's default WebGL shader/uniform
// sync generates and eval()s small functions for speed. This side-effect
// import patches Pixi to use eval-free polyfills instead — the officially
// documented fix for CSP-restricted environments, not a CSP relaxation.
import 'pixi.js/unsafe-eval';

import type { AudioEngine } from '../audio/AudioEngine';
import type { Clock } from '../core/clock';
import type { Config } from '../core/config';
import type { AppEvents, EventBus, Unsubscribe } from '../core/events';
import type { PacingController } from '../core/pacing/PacingController';
import { randInt, randRange } from '../core/rng';
import type { Rng } from '../core/rng';
import type { SessionDirector } from '../core/session/SessionDirector';
import type { DreamColor, DreamDef } from '../core/types';
import { createDimOverlay } from './dimOverlay';
import type { DimOverlay } from './dimOverlay';
import { BoatEntity } from './entities/Boat';
import { DreamEntity } from './entities/Dream';
import { FireflyEntity } from './entities/Firefly';
import { StarEntity } from './entities/Star';
import { breathBrightness } from './model/breath';
import type { DreamInstance } from './model/PondModel';
import { PondModel } from './model/PondModel';
import { estimatePathLengthPx, fitToViewport, pointAtT } from './stream';
import type { ViewportFit } from './stream';

const BOAT_CAPACITY_COLORS: readonly DreamColor[] = ['amber', 'ember', 'moss'];
const TAP_HIT_RADIUS_PX = 36;
const BOAT_MARGIN_BOTTOM_PX = 48;
const FIREFLY_ZONE_HEIGHT_FRACTION = 0.6;
const MS_PER_S = 1000;

export interface PondSceneDeps {
  clock: Clock;
  rng: Rng;
  bus: EventBus<AppEvents>;
  director: SessionDirector;
  pacing: PacingController;
  audioEngine: AudioEngine;
  dreams: readonly DreamDef[];
  cfg: Pick<Config, 'scene' | 'session' | 'pacing'>;
  onDreamSeen: (defId: string) => void;
  onStarEarned: (color: DreamColor, golden: boolean) => void;
}

interface RisingStar {
  entity: StarEntity;
  startedAt: number;
  x: number;
  yStart: number;
  yEnd: number;
}

export class PondScene {
  private readonly model: PondModel;
  private app: Application | null = null;
  private dimOverlay: DimOverlay | null = null;
  private fit: ViewportFit | null = null;
  private pathLengthPx = 1;

  private readonly dreamViews = new Map<string, DreamEntity>();
  private readonly boatViews: Record<DreamColor, BoatEntity>;
  private readonly fireflyViews: FireflyEntity[] = [];
  private readonly risingStars: RisingStar[] = [];

  private readonly offs: Unsubscribe[] = [];
  private spawnAccumulatorMs = 0;
  private lastFrameNow: number;
  private paused = false;
  private voicePreference = true;
  private shuffleActive = false;

  constructor(private readonly deps: PondSceneDeps) {
    this.model = new PondModel({ rng: deps.rng, dreams: deps.dreams, cfg: deps.cfg.scene });
    this.boatViews = {
      amber: new BoatEntity('amber', deps.cfg.scene.BOAT_CAPACITY),
      ember: new BoatEntity('ember', deps.cfg.scene.BOAT_CAPACITY),
      moss: new BoatEntity('moss', deps.cfg.scene.BOAT_CAPACITY),
    };
    this.lastFrameNow = deps.clock.now();
  }

  setVoicePreference(enabled: boolean): void {
    this.voicePreference = enabled;
  }

  async mount(container: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({ backgroundAlpha: 0, resizeTo: container, antialias: true });
    this.app = app;
    container.appendChild(app.canvas);
    this.dimOverlay = createDimOverlay(container);

    for (const color of BOAT_CAPACITY_COLORS) app.stage.addChild(this.boatViews[color]);
    this.spawnFireflies();
    for (const firefly of this.fireflyViews) app.stage.addChild(firefly);

    this.layout();
    this.model.startBreath(this.deps.clock.now());
    this.lastFrameNow = this.deps.clock.now();

    app.ticker.add(() => {
      this.tick();
    });

    this.offs.push(
      this.deps.bus.on('app:lifecycle', (e) => {
        this.paused = e.state === 'background';
      }),
    );
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.dimOverlay?.destroy();
    this.dimOverlay = null;
    this.app?.destroy(true, { children: true });
    this.app = null;
  }

  handleResize(): void {
    this.layout();
  }

  /** `x`/`y` in canvas-local pixels (already offset by the container's bounding rect). */
  handleTap(x: number, y: number): void {
    if (!this.fit) return;
    const now = this.deps.clock.now();
    const nearest = this.findNearestDream(x, y);

    if (!nearest) {
      this.deps.director.tap({ hit: false });
      return;
    }

    const result = this.model.tapDream(nearest.instanceId, now);
    if (!result) {
      this.deps.director.tap({ hit: false });
      return;
    }

    this.removeDreamView(nearest.instanceId);
    this.deps.director.tap({
      hit: true,
      correctBoat: true,
      reactionMs: now - nearest.spawnedAt,
    });
    this.deps.audioEngine.playSfx('matchSuccess');
    this.deps.onDreamSeen(nearest.defId);

    const boatCount = result.boatFilled ? 0 : this.model.boatCounts[result.color];
    this.boatViews[result.color].setFill(boatCount, result.boatFilled);

    if (result.boatFilled) {
      this.deps.director.starEarned(result.golden);
      this.deps.onStarEarned(result.color, result.golden);
      this.deps.audioEngine.playSfx('starRise');
      this.spawnRisingStar(result.color, result.golden, now);
    }
  }

  private findNearestDream(x: number, y: number): DreamInstance | null {
    if (!this.fit) return null;
    let best: DreamInstance | null = null;
    let bestDist = TAP_HIT_RADIUS_PX;
    for (const dream of this.model.activeDreams) {
      const p = this.fit.toPixels(pointAtT(dream.t));
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist <= bestDist) {
        best = dream;
        bestDist = dist;
      }
    }
    return best;
  }

  private layout(): void {
    if (!this.app) return;
    const { width, height } = this.app.renderer;
    this.fit = fitToViewport(width, height);
    this.pathLengthPx = Math.max(1, estimatePathLengthPx(this.fit));

    BOAT_CAPACITY_COLORS.forEach((color, i) => {
      const x = (width * (i + 1)) / (BOAT_CAPACITY_COLORS.length + 1);
      this.boatViews[color].setPosition(x, height - BOAT_MARGIN_BOTTOM_PX);
    });
  }

  private spawnFireflies(): void {
    if (!this.app) return;
    const [min, max] = this.deps.cfg.scene.FIREFLY_COUNT;
    const count = randInt(this.deps.rng, min, max);
    const { width, height } = this.app.renderer;
    for (let i = 0; i < count; i++) {
      const firefly = new FireflyEntity();
      firefly.setPosition(
        randRange(this.deps.rng, [0, width]),
        randRange(this.deps.rng, [0, height * FIREFLY_ZONE_HEIGHT_FRACTION]),
      );
      this.fireflyViews.push(firefly);
    }
  }

  private addDreamView(instance: DreamInstance): void {
    if (!this.app) return;
    const view = new DreamEntity(instance.color);
    this.dreamViews.set(instance.instanceId, view);
    this.app.stage.addChild(view);
    this.syncDreamView(instance);
  }

  private syncDreamView(instance: DreamInstance): void {
    if (!this.fit) return;
    const view = this.dreamViews.get(instance.instanceId);
    if (!view) return;
    const p = this.fit.toPixels(pointAtT(Math.min(1, instance.t)));
    view.setPosition(p.x, p.y);
  }

  private removeDreamView(instanceId: string): void {
    const view = this.dreamViews.get(instanceId);
    if (!view) return;
    view.destroy();
    this.dreamViews.delete(instanceId);
  }

  private spawnRisingStar(color: DreamColor, golden: boolean, now: number): void {
    if (!this.app) return;
    const boat = this.boatViews[color];
    const star = new StarEntity(golden);
    this.app.stage.addChild(star);
    this.risingStars.push({
      entity: star,
      startedAt: now,
      x: boat.position.x,
      yStart: boat.position.y,
      yEnd: 0,
    });
  }

  private updateRisingStars(now: number): void {
    for (let i = this.risingStars.length - 1; i >= 0; i--) {
      const rising = this.risingStars[i];
      if (!rising) continue;
      const progress = (now - rising.startedAt) / this.deps.cfg.scene.STAR_RISE_MS;
      if (progress >= 1) {
        rising.entity.destroy();
        this.risingStars.splice(i, 1);
        continue;
      }
      rising.entity.setRiseProgress(progress, rising.x, rising.yStart, rising.yEnd);
    }
  }

  private tick(): void {
    if (this.paused || !this.app || !this.fit) return;
    const now = this.deps.clock.now();
    const dtMs = Math.max(0, now - this.lastFrameNow);
    this.lastFrameNow = now;

    const snapshot = this.deps.director.snapshot();
    if (snapshot.phase !== 'play' && snapshot.phase !== 'drift' && snapshot.phase !== 'fade')
      return;

    const pacingOut = this.deps.pacing.update({
      phase: snapshot.phase,
      now,
      phaseEnteredAt: snapshot.phaseEnteredAt,
      playElapsedMs: snapshot.playElapsedMs,
      drowsinessScore: snapshot.drowsinessScore,
      lastTapAt: snapshot.lastTapAt,
      voicePreference: this.voicePreference,
    });

    this.dimOverlay?.setAlpha(pacingOut.dimAlpha);
    this.applyVoiceState(pacingOut.voiceEnabled);

    if (snapshot.phase !== 'fade') {
      this.spawnAccumulatorMs += dtMs;
      if (this.spawnAccumulatorMs >= pacingOut.spawnIntervalMs) {
        this.spawnAccumulatorMs = 0;
        const instance = this.model.trySpawn(now);
        if (instance) this.addDreamView(instance);
      }

      const tPerMs =
        (this.deps.cfg.scene.BASE_DRIFT_PX_S * pacingOut.speed) / this.pathLengthPx / MS_PER_S;
      const { exited } = this.model.update(now, tPerMs * dtMs);
      for (const dream of exited) this.removeDreamView(dream.instanceId);
      for (const dream of this.model.activeDreams) this.syncDreamView(dream);
    }

    const brightness = breathBrightness(
      this.model.breathPhaseMs(now),
      this.deps.cfg.scene.BREATH_PERIOD_MS,
    );
    for (const firefly of this.fireflyViews) firefly.setBrightness(brightness);

    this.updateRisingStars(now);
  }

  private applyVoiceState(enabled: boolean): void {
    if (enabled === this.shuffleActive) return;
    this.shuffleActive = enabled;
    if (enabled) {
      this.deps.audioEngine.startShuffle();
    } else {
      this.deps.audioEngine.stopShuffle();
    }
  }
}
