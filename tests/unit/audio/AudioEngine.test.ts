import { describe, expect, it } from 'vitest';

import { AudioEngine } from '@/audio/AudioEngine';
import { CONFIG } from '@/core/config';
import { FakeClock } from '@/core/clock';
import { seededRng } from '@/core/rng';
import { FakeAudioContext, fakeLoadBuffer, flushAsync } from '../../helpers/FakeAudioContext';

const WORDS = Array.from({ length: 150 }, (_, i) => `word${String(i)}`);

function createEngine(clock: FakeClock) {
  let ctx: FakeAudioContext | null = null;
  const engine = new AudioEngine(
    clock,
    { audio: CONFIG.audio, scene: CONFIG.scene },
    {
      rng: seededRng(1),
      createContext: () => {
        ctx = new FakeAudioContext(clock);
        return ctx;
      },
      loadBuffer: fakeLoadBuffer,
      outputKind: 'webaudio-direct',
      words: WORDS,
    },
  );
  return { engine, getCtx: () => ctx! };
}

describe('AudioEngine: unlock', () => {
  it('creates the context, attaches the output, and resumes it', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    expect(getCtx().state).toBe('running');
    expect(getCtx().destination).toBeDefined();
  });

  it('throws from other methods before unlock()', () => {
    const clock = new FakeClock(0);
    const { engine } = createEngine(clock);
    expect(() => {
      engine.setMasterVolume(0.5, 100);
    }).toThrow();
  });
});

describe('AudioEngine: setBed', () => {
  it('starts a looping source per requested layer and stops removed ones', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();

    engine.setBed(['rain', 'crickets']);
    await flushAsync();
    expect(getCtx().createdSources).toHaveLength(2);
    expect(getCtx().createdSources.every((s) => s.loop)).toBe(true);

    engine.setBed(['rain']);
    await flushAsync();
    const stopped = getCtx().createdSources.filter((s) => s.stopCalls.length > 0);
    expect(stopped).toHaveLength(1);
  });

  it('does not create duplicate sources for a layer already playing', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    engine.setBed(['rain']);
    await flushAsync();
    engine.setBed(['rain']);
    await flushAsync();
    expect(getCtx().createdSources).toHaveLength(1);
  });
});

describe('AudioEngine: setMasterVolume', () => {
  it('ramps the master gain from its current value to the target over rampMs', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    engine.setMasterVolume(0.2, 2000);
    const master = getCtx().createdGains[0]!;
    expect(master.gain.linearRampCalls.at(-1)).toMatchObject({ value: 0.2, time: 2 }); // 2000ms -> 2s
  });
});

describe('AudioEngine: playSfx', () => {
  it('plays a one-shot buffer at SFX_MAX_GAIN', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    engine.playSfx('matchSuccess');
    await flushAsync();
    const sfxGain = getCtx().createdGains.find((g) => g.gain.value === CONFIG.scene.SFX_MAX_GAIN);
    expect(sfxGain).toBeDefined();
    expect(getCtx().createdSources.some((s) => s.startCalls.length === 1)).toBe(true);
  });
});

describe('AudioEngine: startShuffle/stopShuffle', () => {
  it('schedules words with gaps in [SHUFFLE_GAP_MIN_MS, SHUFFLE_GAP_MAX_MS] until stopped', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    engine.startShuffle();

    clock.advance(CONFIG.audio.SHUFFLE_GAP_MAX_MS * 5);
    await flushAsync();
    const wordSources = getCtx().createdSources.filter((s) => s.startCalls.length > 0);
    expect(wordSources.length).toBeGreaterThan(0);

    const countAfterFirstBurst = wordSources.length;
    engine.stopShuffle();
    clock.advance(CONFIG.audio.SHUFFLE_GAP_MAX_MS * 5);
    await flushAsync();
    const countAfterStop = getCtx().createdSources.filter((s) => s.startCalls.length > 0).length;
    expect(countAfterStop).toBe(countAfterFirstBurst);
  });
});

describe('AudioEngine: startListen (pre-scheduled timeline, plan §1.8)', () => {
  it('schedules the master ramp to 0 exactly at the listen duration', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    const durationMs = 30 * 60_000;
    engine.startListen(durationMs);

    const master = getCtx().createdGains[0]!;
    const finalRamp = master.gain.linearRampCalls.at(-1)!;
    expect(finalRamp.value).toBe(0);
    expect(finalRamp.time).toBeCloseTo(durationMs / 1000, 6);
  });

  it('schedules stop() for any already-playing bed layers at the listen end time', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    engine.setBed(['rain']);
    await flushAsync();

    const durationMs = 20 * 60_000;
    engine.startListen(durationMs);

    const rainSource = getCtx().createdSources.find((s) => s.loop)!;
    expect(rainSource.stopCalls).toContain(durationMs / 1000);
  });

  it('schedules no word starts in the final LISTEN_TAIL_MS, and the last word starts before the tail', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    const durationMs = 30 * 60_000;
    engine.startListen(durationMs);
    await flushAsync();

    const tailStartS = (durationMs - CONFIG.audio.LISTEN_TAIL_MS) / 1000;
    const wordStarts = getCtx()
      .createdSources.filter((s) => s.startCalls.length > 0 && !s.loop)
      .flatMap((s) => s.startCalls);
    expect(wordStarts.length).toBeGreaterThan(0);
    for (const start of wordStarts) {
      expect(start).toBeLessThan(tailStartS);
    }
  });

  it('a second startListen() call replaces the first schedule', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    engine.startListen(30 * 60_000);
    const firstMasterRamps = getCtx().createdGains[0]!.gain.linearRampCalls.length;

    engine.startListen(10 * 60_000);
    const master = getCtx().createdGains[0]!;
    expect(master.gain.linearRampCalls.length).toBeGreaterThan(firstMasterRamps);
    expect(master.gain.linearRampCalls.at(-1)?.time).toBeCloseTo(600, 6);
  });
});

describe('AudioEngine: stopAll', () => {
  it('ramps to silence over rampMs, then stops all sources', async () => {
    const clock = new FakeClock(0);
    const { engine, getCtx } = createEngine(clock);
    await engine.unlock();
    engine.setBed(['rain']);
    await flushAsync();

    const stopPromise = engine.stopAll(1000);
    const master = getCtx().createdGains[0]!;
    expect(master.gain.linearRampCalls.at(-1)).toMatchObject({ value: 0, time: 1 });

    clock.advance(1000);
    await stopPromise;

    const rainSource = getCtx().createdSources.find((s) => s.loop)!;
    expect(rainSource.stopCalls.length).toBeGreaterThan(0);
  });
});

describe('AudioEngine: caches buffers by URL', () => {
  it('does not call loadBuffer twice for the same layer across multiple setBed calls', async () => {
    const clock = new FakeClock(0);
    let loadCount = 0;
    const engine = new AudioEngine(
      clock,
      { audio: CONFIG.audio, scene: CONFIG.scene },
      {
        rng: seededRng(1),
        createContext: () => new FakeAudioContext(clock),
        loadBuffer: () => {
          loadCount++;
          return fakeLoadBuffer();
        },
        outputKind: 'webaudio-direct',
        words: WORDS,
      },
    );
    await engine.unlock();
    engine.setBed(['rain']);
    await flushAsync();
    engine.setBed([]);
    await flushAsync();
    engine.setBed(['rain']);
    await flushAsync();
    expect(loadCount).toBe(1);
  });
});

describe('AudioEngine: determinism', () => {
  it('the same seed produces the same listen word schedule', async () => {
    async function run(): Promise<number[]> {
      const clock = new FakeClock(0);
      const { engine, getCtx } = createEngine2(clock);
      await engine.unlock();
      engine.startListen(20 * 60_000);
      await flushAsync();
      return getCtx()
        .createdSources.filter((s) => !s.loop)
        .map((s) => s.startCalls[0]!);
    }
    function createEngine2(clock: FakeClock) {
      let ctx: FakeAudioContext | null = null;
      const engine = new AudioEngine(
        clock,
        { audio: CONFIG.audio, scene: CONFIG.scene },
        {
          rng: seededRng(99),
          createContext: () => {
            ctx = new FakeAudioContext(clock);
            return ctx;
          },
          loadBuffer: fakeLoadBuffer,
          outputKind: 'webaudio-direct',
          words: WORDS,
        },
      );
      return { engine, getCtx: () => ctx! };
    }
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });
});
