// The real (non-test) AudioEngineDeps.loadBuffer: fetches and decodes a
// normal asset URL, or synthesizes brown noise in-process for the
// `synth:brownNoise` key AudioEngine.startBedLayer() uses (plan §2.2
// [DEVIATION]: a pre-rendered loop, not an AudioWorklet).
import { renderBrownNoise } from './dsp/brownNoise';
import type { AudioContextLike } from './outputs/AudioOutput';
import type { Rng } from '../core/rng';

const SYNTH_PREFIX = 'synth:';
const SAMPLE_RATE = 44_100;

export function createLoadBuffer(
  rng: Rng,
  brownNoiseLoopSeconds: number,
): (url: string, ctx: AudioContextLike) => Promise<AudioBuffer> {
  return async (url, ctx) => {
    if (url.startsWith(SYNTH_PREFIX)) {
      const samples = renderBrownNoise(SAMPLE_RATE, brownNoiseLoopSeconds, rng);
      const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.getChannelData(0).set(samples);
      return buffer;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`loadBuffer: failed to fetch ${url} (${String(response.status)})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer);
  };
}
