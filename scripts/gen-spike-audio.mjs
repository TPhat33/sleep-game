#!/usr/bin/env node
// Generates the M0 platform-spike's audio assets (plan §5.A.10). Deterministic
// (seeded), Node-only, no npm dependencies — this script is not compiled, so
// it reimplements the small bits of WAV-writing and noise DSP it needs rather
// than importing the TypeScript modules under src/audio/dsp.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT_DIR = fileURLToPath(new URL('../public/audio/spike/', import.meta.url));
const SAMPLE_RATE = 22_050;
const SEED = 20_260_115; // 2026-01-15, the FakeClock's default start date.

// --- mulberry32, matching src/core/rng.ts's algorithm ---
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function peakNormalize(samples, targetPeak) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak === 0) return samples;
  const gain = targetPeak / peak;
  return samples.map((s) => s * gain);
}

/** Equal-power crossfades the tail toward sample 0 so the loop point is seamless. */
function crossfadeTailToHead(samples, crossfadeSamples) {
  const length = samples.length;
  const target = samples[0];
  for (let i = 0; i < crossfadeSamples; i++) {
    const t = (i + 1) / crossfadeSamples;
    const fadeIn = Math.sin((t * Math.PI) / 2);
    const fadeOut = Math.cos((t * Math.PI) / 2);
    const pos = length - crossfadeSamples + i;
    samples[pos] = samples[pos] * fadeOut + target * fadeIn;
  }
}

function encodeWav16(samples, sampleRate) {
  const bytesPerSample = 2;
  const headerSize = 44;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(headerSize + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(headerSize - 8 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');

  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let offset = headerSize;
  for (const s of samples) {
    const clamped = Math.max(-1, Math.min(1, s));
    const intSample = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
    buffer.writeInt16LE(intSample, offset);
    offset += bytesPerSample;
  }
  return buffer;
}

/** One-pole low-pass: how much of the previous output carries forward. */
function onePoleLowPass(white, coefficient) {
  const out = new Float64Array(white.length);
  let prev = 0;
  for (let i = 0; i < white.length; i++) {
    prev = coefficient * prev + (1 - coefficient) * white[i];
    out[i] = prev;
  }
  return out;
}

function genRainTest() {
  const seconds = 20;
  const length = seconds * SAMPLE_RATE;
  const crossfadeSamples = SAMPLE_RATE; // 1 s
  const rng = mulberry32(SEED);

  // Pink-ish noise: sum three one-pole-filtered white-noise streams with
  // different cutoffs, each contributing a different octave-ish band.
  const white = new Float64Array(length);
  for (let i = 0; i < length; i++) white[i] = rng() * 2 - 1;
  const band1 = onePoleLowPass(white, 0.99);
  const band2 = onePoleLowPass(white, 0.95);
  const band3 = onePoleLowPass(white, 0.85);

  const modFreqHz = 0.05; // one slow swell roughly every 20 s
  const modDepth = 0.3;
  const samples = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const swell = 1 - modDepth + modDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * modFreqHz * t));
    samples[i] = (band1[i] + band2[i] + band3[i]) * swell;
  }

  let normalized = peakNormalize(Array.from(samples), dbToLinear(-12));
  crossfadeTailToHead(normalized, crossfadeSamples);
  normalized = peakNormalize(normalized, dbToLinear(-12));
  return encodeWav16(normalized, SAMPLE_RATE);
}

function genMarker() {
  const totalSeconds = 0.35;
  const attackSeconds = 0.005;
  const freqHz = 660;
  const targetPeak = dbToLinear(-12);
  const length = Math.round(totalSeconds * SAMPLE_RATE);
  const attackSamples = Math.round(attackSeconds * SAMPLE_RATE);
  const decaySamples = length - attackSamples;
  const decayTimeConstant = 5; // envelope reaches e^-5 (~0.007) by the end of the decay

  const samples = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let envelope;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else {
      const decayT = (i - attackSamples) / decaySamples;
      envelope = Math.exp(-decayTimeConstant * decayT);
    }
    samples[i] = Math.sin(2 * Math.PI * freqHz * t) * envelope * targetPeak;
  }
  return encodeWav16(Array.from(samples), SAMPLE_RATE);
}

mkdirSync(OUT_DIR, { recursive: true });

const rainWav = genRainTest();
const rainPath = path.join(OUT_DIR, 'rain-test.wav');
writeFileSync(rainPath, rainWav);
console.log(`wrote ${rainPath} (${rainWav.length} bytes)`);

const markerWav = genMarker();
const markerPath = path.join(OUT_DIR, 'marker.wav');
writeFileSync(markerPath, markerWav);
console.log(`wrote ${markerPath} (${markerWav.length} bytes)`);
