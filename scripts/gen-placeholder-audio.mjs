#!/usr/bin/env node
// Generates placeholder audio for every asset AudioEngine references that
// doesn't have real recorded/produced content yet: the three file-backed
// bed layers, both sfx, and all 150 shuffle-voice words (plan §2.1 Q3:
// "soft filtered-noise bursts ≤1.2s, one per word index"). Deterministic,
// Node-only — same "not compiled, reimplements its own tiny WAV/noise DSP"
// approach as gen-spike-audio.mjs, since this script isn't run through
// the TS build.
//
// [DEVIATION] Real production audio ships as .m4a (plan §2.2: needs
// ffmpeg on the content producer's machine). These placeholders are plain
// WAV instead — AudioContext.decodeAudioData() sniffs the actual file
// bytes, not the extension, so WAV decodes identically; it just avoids
// needing an AAC encoder in this script. src/audio/layers.ts's URLs point
// at .wav to match. Swap both back to .m4a once real assets exist.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22_050;
const SEED = 20_260_115; // 2026-01-15, matching FakeClock's default start date.

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
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
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

function onePoleLowPass(white, coefficient) {
  const out = new Float64Array(white.length);
  let prev = 0;
  for (let i = 0; i < white.length; i++) {
    prev = coefficient * prev + (1 - coefficient) * white[i];
    out[i] = prev;
  }
  return out;
}

function whiteNoise(rng, length) {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** A seamless-loop bed layer: filtered noise with a slow amplitude swell. */
function genBedLoop(seed, seconds, lowPassCoeff, swellHz, swellDepth, targetDb) {
  const length = seconds * SAMPLE_RATE;
  const crossfadeSamples = Math.min(SAMPLE_RATE, Math.floor(length / 4));
  const rng = mulberry32(seed);
  const filtered = onePoleLowPass(whiteNoise(rng, length), lowPassCoeff);

  const samples = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const swell = 1 - swellDepth + swellDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * swellHz * t));
    samples[i] = filtered[i] * swell;
  }

  let normalized = peakNormalize(Array.from(samples), dbToLinear(targetDb));
  crossfadeTailToHead(normalized, crossfadeSamples);
  normalized = peakNormalize(normalized, dbToLinear(targetDb));
  return encodeWav16(normalized, SAMPLE_RATE);
}

/** A loop of a few soft transient "tap" clicks separated by silence. */
function genAsmrTapsLoop(seed, seconds, tapCount) {
  const length = seconds * SAMPLE_RATE;
  const rng = mulberry32(seed);
  const samples = new Float64Array(length);
  const tapLength = Math.round(0.05 * SAMPLE_RATE);

  for (let n = 0; n < tapCount; n++) {
    const start = Math.floor((rng() * 0.8 + 0.05) * (length - tapLength));
    const burst = onePoleLowPass(whiteNoise(rng, tapLength), 0.6);
    for (let i = 0; i < tapLength; i++) {
      const envelope = Math.exp(-6 * (i / tapLength));
      samples[start + i] += burst[i] * envelope;
    }
  }

  const normalized = peakNormalize(Array.from(samples), dbToLinear(-10));
  return encodeWav16(normalized, SAMPLE_RATE);
}

/** A short, soft filtered-noise burst — one shuffle-voice "word" placeholder (plan §2.1 Q3). */
function genVoiceBurst(seed, durationSeconds) {
  const length = Math.round(durationSeconds * SAMPLE_RATE);
  const attackSamples = Math.round(0.05 * SAMPLE_RATE);
  const rng = mulberry32(seed);
  const filtered = onePoleLowPass(whiteNoise(rng, length), 0.9);

  const samples = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    let envelope;
    if (i < attackSamples) {
      envelope = i / attackSamples;
    } else {
      const decayT = (i - attackSamples) / (length - attackSamples);
      envelope = Math.exp(-3 * decayT);
    }
    samples[i] = filtered[i] * envelope;
  }

  const normalized = peakNormalize(Array.from(samples), dbToLinear(-14));
  return encodeWav16(normalized, SAMPLE_RATE);
}

/** A short ascending two-note chime — matchSuccess sfx placeholder. */
function genMatchSuccessSfx() {
  const notesHz = [660, 880];
  const noteSeconds = 0.12;
  const length = Math.round(notesHz.length * noteSeconds * SAMPLE_RATE);
  const perNote = Math.round(noteSeconds * SAMPLE_RATE);
  const samples = new Float64Array(length);
  notesHz.forEach((freq, n) => {
    for (let i = 0; i < perNote; i++) {
      const t = i / SAMPLE_RATE;
      const envelope = Math.exp(-8 * (i / perNote));
      samples[n * perNote + i] = Math.sin(2 * Math.PI * freq * t) * envelope;
    }
  });
  const normalized = peakNormalize(Array.from(samples), dbToLinear(-10));
  return encodeWav16(normalized, SAMPLE_RATE);
}

/** A soft rising sweep — starRise sfx placeholder. */
function genStarRiseSfx() {
  const seconds = 0.6;
  const length = Math.round(seconds * SAMPLE_RATE);
  const startHz = 440;
  const endHz = 1320;
  const samples = new Float64Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    const freq = startHz + (endHz - startHz) * t;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const envelope = Math.sin(Math.PI * t); // fades in and out
    samples[i] = Math.sin(phase) * envelope;
  }
  const normalized = peakNormalize(Array.from(samples), dbToLinear(-12));
  return encodeWav16(normalized, SAMPLE_RATE);
}

function write(outUrl, buffer) {
  const outPath = fileURLToPath(outUrl);
  writeFileSync(outPath, buffer);
  return outPath;
}

const bedDir = new URL('../public/audio/bed/', import.meta.url);
const sfxDir = new URL('../public/audio/sfx/', import.meta.url);
const voiceDir = new URL('../public/voice/th/', import.meta.url);
mkdirSync(fileURLToPath(bedDir), { recursive: true });
mkdirSync(fileURLToPath(sfxDir), { recursive: true });
mkdirSync(fileURLToPath(voiceDir), { recursive: true });

write(new URL('rain.wav', bedDir), genBedLoop(SEED, 12, 0.97, 0.04, 0.3, -14));
write(new URL('crickets.wav', bedDir), genBedLoop(SEED + 1, 10, 0.4, 0.5, 0.5, -16));
write(new URL('asmr-taps.wav', bedDir), genAsmrTapsLoop(SEED + 2, 6, 4));
write(new URL('match-success.wav', sfxDir), genMatchSuccessSfx());
write(new URL('star-rise.wav', sfxDir), genStarRiseSfx());

const wordsPath = fileURLToPath(new URL('../src/content/words.th.json', import.meta.url));
const words = JSON.parse(readFileSync(wordsPath, 'utf8'));
const VOICE_BURST_SECONDS = 0.7;
words.forEach((_word, index) => {
  write(
    new URL(`${String(index)}.wav`, voiceDir),
    genVoiceBurst(SEED + 100 + index, VOICE_BURST_SECONDS),
  );
});

console.log(`wrote 3 bed loops, 2 sfx, and ${String(words.length)} voice word placeholders.`);
