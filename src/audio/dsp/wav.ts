// Minimal 16-bit PCM mono WAV encoder — used by the M0 spike audio generator
// script and by tests that need to inspect real WAV bytes.

const BITS_PER_BYTE = 8;
const RIFF_HEADER_SIZE = 44;
const FMT_CHUNK_SIZE = 16;
const PCM_FORMAT = 1;
const MONO_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / BITS_PER_BYTE;
const INT16_MAX = 0x7fff;
const INT16_MIN = 0x8000;

// Byte offsets within the 44-byte RIFF/WAVE/fmt/data header.
const OFFSET_RIFF_ID = 0;
const OFFSET_RIFF_SIZE = 4;
const OFFSET_WAVE_ID = 8;
const OFFSET_FMT_ID = 12;
const OFFSET_FMT_SIZE = 16;
const OFFSET_AUDIO_FORMAT = 20;
const OFFSET_NUM_CHANNELS = 22;
const OFFSET_SAMPLE_RATE = 24;
const OFFSET_BYTE_RATE = 28;
const OFFSET_BLOCK_ALIGN = 32;
const OFFSET_BITS_PER_SAMPLE = 34;
const OFFSET_DATA_ID = 36;
const OFFSET_DATA_SIZE = 40;
/** The "RIFF" fourCC + the size field itself aren't counted in the RIFF chunk size. */
const BYTES_EXCLUDED_FROM_RIFF_SIZE = 8;

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function sampleAt(samples: Float32Array, i: number): number {
  const v = samples[i];
  if (v === undefined) throw new RangeError(`sample index ${String(i)} out of range`);
  return v;
}

export function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataSize = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(RIFF_HEADER_SIZE + dataSize);
  const view = new DataView(buffer);
  const byteRate = sampleRate * MONO_CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = MONO_CHANNELS * BYTES_PER_SAMPLE;

  writeAscii(view, OFFSET_RIFF_ID, 'RIFF');
  view.setUint32(
    OFFSET_RIFF_SIZE,
    RIFF_HEADER_SIZE - BYTES_EXCLUDED_FROM_RIFF_SIZE + dataSize,
    true,
  );
  writeAscii(view, OFFSET_WAVE_ID, 'WAVE');

  writeAscii(view, OFFSET_FMT_ID, 'fmt ');
  view.setUint32(OFFSET_FMT_SIZE, FMT_CHUNK_SIZE, true);
  view.setUint16(OFFSET_AUDIO_FORMAT, PCM_FORMAT, true);
  view.setUint16(OFFSET_NUM_CHANNELS, MONO_CHANNELS, true);
  view.setUint32(OFFSET_SAMPLE_RATE, sampleRate, true);
  view.setUint32(OFFSET_BYTE_RATE, byteRate, true);
  view.setUint16(OFFSET_BLOCK_ALIGN, blockAlign, true);
  view.setUint16(OFFSET_BITS_PER_SAMPLE, BITS_PER_SAMPLE, true);

  writeAscii(view, OFFSET_DATA_ID, 'data');
  view.setUint32(OFFSET_DATA_SIZE, dataSize, true);

  let offset = RIFF_HEADER_SIZE;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, sampleAt(samples, i)));
    const intSample = Math.round(clamped < 0 ? clamped * INT16_MIN : clamped * INT16_MAX);
    view.setInt16(offset, intSample, true);
    offset += BYTES_PER_SAMPLE;
  }

  return buffer;
}
