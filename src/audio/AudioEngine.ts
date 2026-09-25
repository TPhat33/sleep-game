// Spec §9.3's public API, wired to the pre-scheduled Web Audio graph design
// from plan §1.8: a single graph (per-layer gain -> master gain -> output),
// with everything long-running (the listen timeline) scheduled up front
// against the audio clock so it survives a frozen/backgrounded JS thread.

import type { Clock, TimerId } from '../core/clock';
import type { AudioConfig, SceneConfig } from '../core/config';
import { pickNoRepeat, randRange } from '../core/rng';
import type { Rng } from '../core/rng';
import type { AudioOutputKind, BedLayerId } from '../core/types';
import { BED_LAYER_URLS, SFX_URLS, voiceWordUrl } from './layers';
import type { SfxId } from './layers';
import { createElementBridgeOutput } from './outputs/elementBridge';
import type {
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioOutput,
  GainNodeLike,
} from './outputs/AudioOutput';
import { createWebAudioDirectOutput } from './outputs/webaudioDirect';
import { planListenShuffleSchedule } from './shuffleVoice';

export interface AudioEngineCfg {
  audio: AudioConfig;
  /** SFX_MAX_GAIN lives in scene config (spec §13), but playSfx() needs it. */
  scene: Pick<SceneConfig, 'SFX_MAX_GAIN'>;
}

export interface AudioEngineDeps {
  rng: Rng;
  createContext: () => AudioContextLike;
  loadBuffer: (url: string, ctx: AudioContextLike) => Promise<AudioBuffer>;
  outputKind: AudioOutputKind;
  words: readonly string[];
  /** Only used by the element-bridge output strategy. Defaults to `() => new Audio()`. */
  createAudioElement?: () => {
    srcObject: MediaStream | null;
    play: () => Promise<void>;
    pause: () => void;
  };
}

const MS_PER_S = 1000;

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private output: AudioOutput | null = null;

  private readonly layerGains = new Map<BedLayerId, GainNodeLike>();
  private readonly layerSources = new Map<BedLayerId, AudioBufferSourceNodeLike>();
  private readonly bufferCache = new Map<string, AudioBuffer>();

  private shuffleVoiceGain: GainNodeLike | null = null;
  private shuffleTimerId: TimerId | null = null;
  private readonly shuffleRecent: number[] = [];

  private listenTimerIds: TimerId[] = [];

  constructor(
    private readonly clock: Clock,
    private readonly cfg: AudioEngineCfg,
    private readonly deps: AudioEngineDeps,
  ) {}

  async unlock(): Promise<void> {
    if (!this.ctx) {
      const ctx = this.deps.createContext();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 1;
      this.master = master;
      this.output = this.createOutput(ctx);
      this.output.attach(master);
      await this.output.start();
    }
    await this.ctx.resume();
  }

  private createOutput(ctx: AudioContextLike): AudioOutput {
    if (this.deps.outputKind === 'element-bridge') {
      const factory =
        this.deps.createAudioElement ??
        (() =>
          new Audio() as unknown as {
            srcObject: MediaStream | null;
            play: () => Promise<void>;
            pause: () => void;
          });
      return createElementBridgeOutput(ctx, factory);
    }
    return createWebAudioDirectOutput(ctx);
  }

  private requireCtx(): { ctx: AudioContextLike; master: GainNodeLike } {
    if (!this.ctx || !this.master) throw new Error('AudioEngine: call unlock() first');
    return { ctx: this.ctx, master: this.master };
  }

  private async loadLayerBuffer(url: string, ctx: AudioContextLike): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;
    const buffer = await this.deps.loadBuffer(url, ctx);
    this.bufferCache.set(url, buffer);
    return buffer;
  }

  private layerGain(
    layer: BedLayerId | 'shuffleVoice',
    master: GainNodeLike,
    ctx: AudioContextLike,
  ): GainNodeLike {
    const key = layer === 'shuffleVoice' ? null : layer;
    if (key) {
      const existing = this.layerGains.get(key);
      if (existing) return existing;
    } else if (this.shuffleVoiceGain) {
      return this.shuffleVoiceGain;
    }
    const gain = ctx.createGain();
    gain.gain.value = this.cfg.audio.LAYER_GAIN[layer];
    gain.connect(master);
    if (key) this.layerGains.set(key, gain);
    else this.shuffleVoiceGain = gain;
    return gain;
  }

  /** Starts/stops looping ambient bed layers to exactly match `layers` (spec §9.3). */
  setBed(layers: readonly BedLayerId[]): void {
    const { ctx, master } = this.requireCtx();
    const wanted = new Set(layers);

    for (const [layer, source] of this.layerSources) {
      if (!wanted.has(layer)) {
        source.stop();
        this.layerSources.delete(layer);
      }
    }
    for (const layer of layers) {
      if (this.layerSources.has(layer)) continue;
      void this.startBedLayer(layer, ctx, master);
    }
  }

  private async startBedLayer(
    layer: BedLayerId,
    ctx: AudioContextLike,
    master: GainNodeLike,
  ): Promise<void> {
    const url = layer === 'brownNoise' ? null : BED_LAYER_URLS[layer];
    const buffer = url
      ? await this.loadLayerBuffer(url, ctx)
      : await this.loadLayerBuffer(`synth:${layer}`, ctx);
    // A caller that stopped this layer again while the buffer was loading should not have it restart.
    if (this.layerSources.has(layer)) return;
    const gain = this.layerGain(layer, master, ctx);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    this.layerSources.set(layer, source);
  }

  setMasterVolume(v: number, rampMs: number): void {
    const { ctx, master } = this.requireCtx();
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(v, now + rampMs / MS_PER_S);
  }

  playSfx(id: SfxId): void {
    const { ctx, master } = this.requireCtx();
    const gain = ctx.createGain();
    gain.gain.value = this.cfg.scene.SFX_MAX_GAIN;
    gain.connect(master);
    void this.loadLayerBuffer(SFX_URLS[id], ctx).then((buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.onended = () => {
        gain.disconnect();
      };
      source.start();
    });
  }

  /** Live (non-pre-scheduled) shuffle voice, for use during 'drift' — spec §9.1. */
  startShuffle(): void {
    if (this.shuffleTimerId !== null) return;
    this.scheduleNextShuffleWord();
  }

  stopShuffle(): void {
    if (this.shuffleTimerId === null) return;
    this.clock.clearTimeout(this.shuffleTimerId);
    this.shuffleTimerId = null;
  }

  private scheduleNextShuffleWord(): void {
    const gap = randRange(this.deps.rng, [
      this.cfg.audio.SHUFFLE_GAP_MIN_MS,
      this.cfg.audio.SHUFFLE_GAP_MAX_MS,
    ]);
    this.shuffleTimerId = this.clock.setTimeout(() => {
      this.playNextShuffleWord();
      this.scheduleNextShuffleWord();
    }, gap);
  }

  private playNextShuffleWord(): void {
    if (this.deps.words.length === 0) return;
    const indices = this.deps.words.map((_, i) => i);
    const idx = pickNoRepeat(this.deps.rng, indices, this.shuffleRecent);
    this.shuffleRecent.push(idx);
    if (this.shuffleRecent.length > this.cfg.audio.SHUFFLE_NO_REPEAT) this.shuffleRecent.shift();
    this.playWordNow(idx);
  }

  private playWordNow(index: number): void {
    const { ctx, master } = this.requireCtx();
    const gain = this.layerGain('shuffleVoice', master, ctx);
    void this.loadLayerBuffer(voiceWordUrl(index), ctx).then((buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start();
    });
  }

  /**
   * Pre-schedules the entire listen timeline (plan §1.8): every shuffle
   * word, the master ramp to 0, and looping bed layers' stop() times, all
   * queued against ctx.currentTime up front so nothing depends on JS timers
   * firing while the screen is locked.
   */
  startListen(durationMs: number): void {
    const { ctx, master } = this.requireCtx();
    this.stopShuffle();
    this.clearListenTimers();

    const startTime = ctx.currentTime;
    const endTime = startTime + durationMs / MS_PER_S;

    master.gain.cancelScheduledValues(startTime);
    master.gain.setValueAtTime(master.gain.value, startTime);
    master.gain.linearRampToValueAtTime(0, endTime);

    for (const source of this.layerSources.values()) {
      source.stop(endTime);
    }

    const schedule = planListenShuffleSchedule(
      this.deps.rng,
      this.deps.words.length,
      this.cfg.audio,
      durationMs,
    );
    const gain = this.layerGain('shuffleVoice', master, ctx);
    for (const event of schedule) {
      void this.loadLayerBuffer(voiceWordUrl(event.wordIndex), ctx).then((buffer) => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        source.start(startTime + event.atMs / MS_PER_S);
      });
    }
  }

  private clearListenTimers(): void {
    for (const id of this.listenTimerIds) this.clock.clearTimeout(id);
    this.listenTimerIds = [];
  }

  async stopAll(rampMs: number): Promise<void> {
    if (!this.ctx || !this.master) return;
    this.stopShuffle();
    this.clearListenTimers();
    const { ctx, master } = this.requireCtx();
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + rampMs / MS_PER_S);

    await new Promise<void>((resolve) => {
      this.clock.setTimeout(resolve, rampMs);
    });

    for (const source of this.layerSources.values()) source.stop();
    this.layerSources.clear();
    this.output?.stop();
  }
}
