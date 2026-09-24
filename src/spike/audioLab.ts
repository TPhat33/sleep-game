// The M0 spike's Web Audio test rig (spec §5.C.2-3). Exercises the three
// candidate output strategies from plan §1.8 so a human tester can find out,
// on a real device, which one survives a locked screen. This is diagnostic
// tooling, not the production AudioEngine (that's M1) — raw timers/Math are
// allowed in src/spike/** (see eslint.config.ts).

import { renderBrownNoise } from '../audio/dsp/brownNoise';
import { seededRng } from '../core/rng';
import { diagLog } from './diagLog';

export type Strategy = 'webaudio-direct' | 'element-bridge' | 'element-files';
export type BrownNoiseMode = 'buffer' | 'worklet';
export type LayerId = 'brownNoise' | 'rain' | 'marker';

export interface AudioLabSnapshot {
  ctxState: string;
  ctxCurrentTime: number;
  strategy: Strategy;
  playing: boolean;
  elementPaused: boolean | null;
  elementCurrentTime: number | null;
  elementVolumeReadsBack: boolean | null;
}

const RAIN_URL = './audio/spike/rain-test.wav';
const MARKER_URL = './audio/spike/marker.wav';
const BROWN_NOISE_SECONDS = 30;
const MARKER_PERIOD_S = 60;
const DEFAULT_SCHEDULE_HORIZON_MIN = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

export class AudioLab {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bridgeDestination: MediaStreamAudioDestinationNode | null = null;
  private bridgeElement: HTMLAudioElement | null = null;

  private rainBuffer: AudioBuffer | null = null;
  private markerBuffer: AudioBuffer | null = null;
  private brownNoiseBuffer: AudioBuffer | null = null;

  private rainSource: AudioBufferSourceNode | null = null;
  private brownNoiseSource: AudioBufferSourceNode | null = null;
  private markerTimerIds: ReturnType<typeof setInterval>[] = [];
  private blipTimerIds: ReturnType<typeof setInterval>[] = [];

  private filesRain: HTMLAudioElement | null = null;
  private filesMarker: HTMLAudioElement | null = null;

  private strategy: Strategy = 'webaudio-direct';
  private layers: Record<LayerId, boolean> = { brownNoise: true, rain: true, marker: true };
  private playing = false;
  private elementVolumeReadsBack: boolean | null = null;

  async unlock(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'playback' });
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 1;
      this.master = master;
      ctx.onstatechange = () => {
        diagLog.log('ctx', `statechange: ${ctx.state}`);
      };
    }
    await this.ctx.resume();
    const silent = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = silent;
    src.connect(this.ctx.destination);
    src.start();
    this.connectOutput();
    diagLog.log('ctx', `unlocked, state=${this.ctx.state}`);
  }

  async loadAssets(): Promise<void> {
    if (!this.ctx) throw new Error('call unlock() first');
    const ctx = this.ctx;
    const [rainArrayBuffer, markerArrayBuffer] = await Promise.all([
      fetch(RAIN_URL).then((r) => r.arrayBuffer()),
      fetch(MARKER_URL).then((r) => r.arrayBuffer()),
    ]);
    this.rainBuffer = await ctx.decodeAudioData(rainArrayBuffer);
    this.markerBuffer = await ctx.decodeAudioData(markerArrayBuffer);
    this.brownNoiseBuffer = this.encodeBrownNoiseBuffer(ctx);

    this.filesRain = new Audio(RAIN_URL);
    this.filesRain.loop = true;
    this.filesMarker = new Audio(MARKER_URL);
    this.attachElementDiagnostics(this.filesRain, 'element:rain');
    this.attachElementDiagnostics(this.filesMarker, 'element:marker');

    diagLog.log('ctx', 'assets loaded (rain, marker, brown noise buffer)');
  }

  private encodeBrownNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const samples = renderBrownNoise(ctx.sampleRate, BROWN_NOISE_SECONDS, seededRng(1));
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    channel.set(samples);
    return buffer;
  }

  private attachElementDiagnostics(el: HTMLAudioElement, label: string): void {
    for (const type of [
      'play',
      'pause',
      'stalled',
      'suspend',
      'waiting',
      'ended',
      'error',
    ] as const) {
      el.addEventListener(type, () => {
        diagLog.log('element', `${label}: ${type}`);
      });
    }
  }

  private connectOutput(): void {
    if (!this.ctx || !this.master) return;
    this.master.disconnect();
    if (this.strategy === 'webaudio-direct') {
      this.master.connect(this.ctx.destination);
    } else if (this.strategy === 'element-bridge') {
      this.bridgeDestination = this.ctx.createMediaStreamDestination();
      this.master.connect(this.bridgeDestination);
      this.bridgeElement = new Audio();
      this.bridgeElement.srcObject = this.bridgeDestination.stream;
      this.attachElementDiagnostics(this.bridgeElement, 'element:bridge');
      void this.bridgeElement.play().catch((err: unknown) => {
        diagLog.log('element', `bridge play() failed: ${String(err)}`);
      });
    }
    // 'element-files' does not touch the Web Audio graph at all.
  }

  setStrategy(strategy: Strategy): void {
    this.strategy = strategy;
    diagLog.log('ctx', `strategy: ${strategy}`);
    if (this.ctx) this.connectOutput();
  }

  setBrownNoiseMode(mode: BrownNoiseMode): void {
    diagLog.log('ctx', `brownNoiseMode: ${mode} (worklet is spike-only, not wired to playback)`);
  }

  setLayer(layer: LayerId, enabled: boolean): void {
    this.layers[layer] = enabled;
    if (!this.playing) return;
    if (enabled) this.startLayer(layer);
    else this.stopLayer(layer);
  }

  play(): void {
    if (!this.ctx || !this.master) throw new Error('call unlock() first');
    this.playing = true;
    for (const layer of Object.keys(this.layers) as LayerId[]) {
      if (this.layers[layer]) this.startLayer(layer);
    }
    diagLog.log('ctx', `play (strategy=${this.strategy})`);
  }

  stop(): void {
    this.playing = false;
    for (const layer of Object.keys(this.layers) as LayerId[]) this.stopLayer(layer);
    diagLog.log('ctx', 'stop');
  }

  private startLayer(layer: LayerId): void {
    if (this.strategy === 'element-files') {
      this.startLayerElementFiles(layer);
      return;
    }
    if (!this.ctx || !this.master) return;
    if (layer === 'rain' && this.rainBuffer && !this.rainSource) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.rainBuffer;
      src.loop = true;
      src.connect(this.master);
      src.start();
      this.rainSource = src;
    } else if (layer === 'brownNoise' && this.brownNoiseBuffer && !this.brownNoiseSource) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.brownNoiseBuffer;
      src.loop = true;
      src.connect(this.master);
      src.start();
      this.brownNoiseSource = src;
    } else if (layer === 'marker') {
      this.scheduleMarkerOnAudioThread();
    }
  }

  private stopLayer(layer: LayerId): void {
    if (layer === 'rain') {
      this.rainSource?.stop();
      this.rainSource = null;
      this.filesRain?.pause();
    } else if (layer === 'brownNoise') {
      this.brownNoiseSource?.stop();
      this.brownNoiseSource = null;
    } else {
      for (const id of this.markerTimerIds) clearInterval(id);
      this.markerTimerIds = [];
      this.filesMarker?.pause();
    }
  }

  private startLayerElementFiles(layer: LayerId): void {
    if (layer === 'rain' && this.filesRain) {
      void this.filesRain.play().catch((err: unknown) => {
        diagLog.log('element', `rain play() failed: ${String(err)}`);
      });
    } else if (layer === 'marker' && this.filesMarker) {
      const retrigger = () => {
        if (!this.filesMarker) return;
        this.filesMarker.currentTime = 0;
        void this.filesMarker.play().catch((err: unknown) => {
          diagLog.log('element', `marker play() failed: ${String(err)}`);
        });
      };
      retrigger();
      this.markerTimerIds.push(setInterval(retrigger, MARKER_PERIOD_S * MS_PER_SECOND));
    }
    // brownNoise has no element-files equivalent — Web Audio only.
  }

  /** Pre-schedules marker chimes on the audio thread for the next hour — deliberately not JS-dependent. */
  private scheduleMarkerOnAudioThread(): void {
    if (!this.ctx || !this.master || !this.markerBuffer) return;
    const ctx = this.ctx;
    const count = Math.floor((DEFAULT_SCHEDULE_HORIZON_MIN * SECONDS_PER_MINUTE) / MARKER_PERIOD_S);
    for (let i = 0; i < count; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.markerBuffer;
      src.connect(this.master);
      src.start(ctx.currentTime + i * MARKER_PERIOD_S);
    }
    diagLog.log('ctx', `marker: scheduled ${String(count)} chimes on the audio thread`);
  }

  setMasterVolume(v: number): void {
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(v, this.ctx.currentTime);
    }
    if (this.strategy === 'element-files' && this.filesRain) {
      this.filesRain.volume = v;
      this.elementVolumeReadsBack = this.filesRain.volume === v;
    }
  }

  fadeToSilence(minutes: number): void {
    const seconds = minutes * SECONDS_PER_MINUTE;
    if (this.strategy !== 'element-files' && this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0, now + seconds);
      diagLog.log('ctx', `fade to silence over ${String(minutes)} min (audio-thread ramp)`);
      return;
    }
    if (this.filesRain) {
      const startVolume = this.filesRain.volume;
      const steps = 100;
      const stepMs = (seconds * MS_PER_SECOND) / steps;
      let step = 0;
      const id = setInterval(() => {
        step++;
        const v = Math.max(0, startVolume * (1 - step / steps));
        if (this.filesRain) {
          this.filesRain.volume = v;
          this.elementVolumeReadsBack = this.filesRain.volume === v;
        }
        if (step >= steps) clearInterval(id);
      }, stepMs);
      diagLog.log(
        'ctx',
        `fade to silence over ${String(minutes)} min (JS-driven element.volume steps)`,
      );
    }
  }

  /** Pre-schedules short blips every `everySeconds` for `forMinutes` — validates plan §1.8's pre-scheduling design. */
  scheduleBlips(everySeconds: number, forMinutes: number): void {
    if (this.strategy !== 'element-files' && this.ctx && this.master) {
      const ctx = this.ctx;
      const master = this.master;
      const count = Math.floor((forMinutes * SECONDS_PER_MINUTE) / everySeconds);
      for (let i = 0; i < count; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const BLIP_FREQ_HZ = 880;
        const BLIP_GAIN = 0.15;
        const BLIP_DURATION_S = 0.08;
        osc.frequency.value = BLIP_FREQ_HZ;
        gain.gain.value = BLIP_GAIN;
        osc.connect(gain).connect(master);
        const when = ctx.currentTime + i * everySeconds;
        osc.start(when);
        osc.stop(when + BLIP_DURATION_S);
      }
      diagLog.log(
        'ctx',
        `blips: scheduled ${String(count)} on the audio thread (pre-scheduled, JS-independent)`,
      );
      return;
    }
    // element-files baseline: JS-driven retriggering, deliberately fragile in the background.
    const id = setInterval(() => {
      if (this.filesMarker) {
        this.filesMarker.currentTime = 0;
        void this.filesMarker.play().catch(() => undefined);
      }
    }, everySeconds * MS_PER_SECOND);
    this.blipTimerIds.push(id);
    diagLog.log('ctx', 'blips: scheduled via setInterval (element-files baseline, JS-dependent)');
  }

  getCtxCurrentTime(): number | null {
    return this.ctx?.currentTime ?? null;
  }

  snapshot(): AudioLabSnapshot {
    const primaryElement = this.strategy === 'element-bridge' ? this.bridgeElement : this.filesRain;
    return {
      ctxState: this.ctx?.state ?? 'none',
      ctxCurrentTime: this.ctx?.currentTime ?? 0,
      strategy: this.strategy,
      playing: this.playing,
      elementPaused: primaryElement?.paused ?? null,
      elementCurrentTime: primaryElement?.currentTime ?? null,
      elementVolumeReadsBack: this.elementVolumeReadsBack,
    };
  }
}
