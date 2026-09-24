import { describe, expect, it } from 'vitest';

import { encodeWav16 } from '@/audio/dsp/wav';

function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('encodeWav16', () => {
  it('writes correct RIFF/fmt/data header fields', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const sampleRate = 22_050;
    const buffer = encodeWav16(samples, sampleRate);
    const view = new DataView(buffer);

    expect(readAscii(view, 0, 4)).toBe('RIFF');
    const dataSize = samples.length * 2;
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(readAscii(view, 8, 4)).toBe('WAVE');

    expect(readAscii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM format
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(28, true)).toBe(sampleRate * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample

    expect(readAscii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(dataSize);
    expect(buffer.byteLength).toBe(44 + dataSize);
  });

  it('round-trips sample data through 16-bit PCM', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25, -0.75]);
    const buffer = encodeWav16(samples, 44_100);
    const view = new DataView(buffer);

    for (let i = 0; i < samples.length; i++) {
      const decoded =
        view.getInt16(44 + i * 2, true) / (view.getInt16(44 + i * 2, true) < 0 ? 0x8000 : 0x7fff);
      expect(decoded).toBeCloseTo(samples[i]!, 3);
    }
  });

  it('clamps out-of-range samples to [-1, 1]', () => {
    const samples = new Float32Array([2, -2]);
    const buffer = encodeWav16(samples, 22_050);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
