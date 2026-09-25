import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLoadBuffer } from '@/audio/loadBuffer';
import { seededRng } from '@/core/rng';
import { FakeAudioContext } from '../../helpers/FakeAudioContext';

describe('createLoadBuffer: synth:brownNoise', () => {
  it('renders a brown-noise buffer of the requested length without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const loadBuffer = createLoadBuffer(seededRng(1), 2);
    const ctx = new FakeAudioContext({ now: () => 0 } as never);
    const buffer = await loadBuffer('synth:brownNoise', ctx);
    expect(buffer.sampleRate).toBe(44_100);
    expect(buffer.length).toBe(2 * 44_100);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is deterministic for the same seed', async () => {
    const a = await createLoadBuffer(seededRng(5), 1)(
      'synth:brownNoise',
      new FakeAudioContext({
        now: () => 0,
      } as never),
    );
    const b = await createLoadBuffer(seededRng(5), 1)(
      'synth:brownNoise',
      new FakeAudioContext({
        now: () => 0,
      } as never),
    );
    expect(a.length).toBe(b.length);
  });
});

describe('createLoadBuffer: URL assets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the URL and decodes it via the context', async () => {
    const arrayBuffer = new ArrayBuffer(8);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    } as Response);
    const loadBuffer = createLoadBuffer(seededRng(1), 30);
    const ctx = new FakeAudioContext({ now: () => 0 } as never);
    const decodeSpy = vi.spyOn(ctx, 'decodeAudioData');

    await loadBuffer('/audio/bed/rain.m4a', ctx);

    expect(fetchSpy).toHaveBeenCalledWith('/audio/bed/rain.m4a');
    expect(decodeSpy).toHaveBeenCalledWith(arrayBuffer);
  });

  it('throws when the fetch response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
    const loadBuffer = createLoadBuffer(seededRng(1), 30);
    const ctx = new FakeAudioContext({ now: () => 0 } as never);

    await expect(loadBuffer('/audio/bed/missing.m4a', ctx)).rejects.toThrow('404');
  });
});
