import { describe, expect, it, vi } from 'vitest';

import { AudioEngine } from '@/audio/AudioEngine';
import { SessionRuntime } from '@/app/SessionRuntime';
import { FakeClock } from '@/core/clock';
import { CONFIG } from '@/core/config';
import { EventBus } from '@/core/events';
import type { AppEvents } from '@/core/events';
import { seededRng } from '@/core/rng';
import type { SessionSummary } from '@/core/types';
import { FakeAudioContext, fakeLoadBuffer } from '../../helpers/FakeAudioContext';
import { FakePlatform } from '../../helpers/FakePlatform';

const WORDS = Array.from({ length: 10 }, (_, i) => `word${String(i)}`);

interface FakeSessionsRepoCall {
  method: string;
  args: unknown[];
}

function createFakeSessionsRepo() {
  const calls: FakeSessionsRepoCall[] = [];
  return {
    calls,
    writeProvisional(session: {
      id: string;
      startedAt: number;
      nightWake: boolean;
      backgroundedAt: number;
    }): Promise<void> {
      calls.push({ method: 'writeProvisional', args: [session] });
      return Promise.resolve();
    },
    finalize(summary: SessionSummary): Promise<void> {
      calls.push({ method: 'finalize', args: [summary] });
      return Promise.resolve();
    },
    deleteProvisional(id: string): Promise<void> {
      calls.push({ method: 'deleteProvisional', args: [id] });
      return Promise.resolve();
    },
  };
}

function createRig() {
  const clock = new FakeClock(0);
  const bus = new EventBus<AppEvents>({
    onError: (err) => {
      throw err;
    },
  });
  const platform = new FakePlatform('web');
  let ctx: FakeAudioContext | null = null;
  const audioEngine = new AudioEngine(
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
  const sessions = createFakeSessionsRepo();
  const runtime = new SessionRuntime({
    bus,
    platform,
    audioEngine,
    sessions,
    cfg: { pacing: CONFIG.pacing, audio: CONFIG.audio },
  });
  return { clock, bus, platform, audioEngine, sessions, runtime, getCtx: () => ctx };
}

function baseSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: 's1',
    startedAt: 0,
    endedAt: 1000,
    endReason: 'user_exit',
    nightWake: false,
    phaseDurationsMs: {},
    minutesToFade: null,
    peakDrowsiness: 0,
    listenUsed: false,
    gentleExitShown: false,
    starsEarned: 0,
    ...overrides,
  };
}

describe('SessionRuntime: per-phase platform policy (plan §1.9)', () => {
  it('acquires the wake lock on entering settle', () => {
    const { bus, platform } = createRig();
    bus.emit('phase:changed', { at: 0, from: 'home', to: 'settle', reason: 'start' });
    expect(platform.calls).toContainEqual({ method: 'wakeLock.acquire', args: [] });
  });

  it('does not touch wake lock or brightness entering play/drift', () => {
    const { bus, platform } = createRig();
    bus.emit('phase:changed', { at: 0, from: 'settle', to: 'play', reason: 'settle_skipped' });
    bus.emit('phase:changed', { at: 0, from: 'play', to: 'drift', reason: 'play_max' });
    expect(platform.calls.some((c) => c.method.startsWith('wakeLock'))).toBe(false);
    expect(platform.calls.some((c) => c.method.startsWith('brightness'))).toBe(false);
  });

  it('on fade: sets FADE_BRIGHTNESS_TARGET and ramps the audio master to 0 over FADE_AUDIO_MS', async () => {
    const { bus, platform, audioEngine, getCtx } = createRig();
    await audioEngine.unlock();
    bus.emit('phase:changed', { at: 0, from: 'play', to: 'fade', reason: 'idle' });
    expect(platform.calls).toContainEqual({
      method: 'brightness.set',
      args: [CONFIG.pacing.FADE_BRIGHTNESS_TARGET],
    });
    const ctx = getCtx();
    expect(ctx).not.toBeNull();
    const master = ctx?.createdGains[0];
    expect(master?.gain.linearRampCalls).toContainEqual({
      value: 0,
      time: CONFIG.pacing.FADE_AUDIO_MS / 1000,
    });
  });

  it('on listen: releases wake lock, sets BRIGHTNESS_MIN, activates background audio, and pre-schedules the listen timeline', async () => {
    const { bus, platform, audioEngine, getCtx } = createRig();
    await audioEngine.unlock();
    bus.emit('phase:changed', {
      at: 0,
      from: 'play',
      to: 'listen',
      reason: 'listen_button',
      listenDurationMs: 60_000,
    });
    expect(platform.calls).toContainEqual({ method: 'wakeLock.release', args: [] });
    expect(platform.calls).toContainEqual({
      method: 'brightness.set',
      args: [CONFIG.pacing.BRIGHTNESS_MIN],
    });
    expect(platform.calls.some((c) => c.method === 'backgroundAudio.activate')).toBe(true);
    const ctx = getCtx();
    const master = ctx?.createdGains[0];
    expect(master?.gain.linearRampCalls).toContainEqual({ value: 0, time: 60 });
  });
});

describe('SessionRuntime: background grace persistence', () => {
  it('writes a provisional session record when backgrounded during a graced phase', () => {
    const { bus, sessions } = createRig();
    bus.emit('session:started', { at: 0, sessionId: 's1', nightWake: false });
    bus.emit('phase:changed', { at: 0, from: 'home', to: 'settle', reason: 'start' });
    bus.emit('app:lifecycle', { at: 5_000, state: 'background' });
    expect(sessions.calls).toContainEqual({
      method: 'writeProvisional',
      args: [{ id: 's1', startedAt: 0, nightWake: false, backgroundedAt: 5_000 }],
    });
  });

  it('does not write a provisional record when backgrounded during listen', async () => {
    const { bus, sessions, audioEngine } = createRig();
    await audioEngine.unlock();
    bus.emit('session:started', { at: 0, sessionId: 's1', nightWake: false });
    bus.emit('phase:changed', {
      at: 0,
      from: 'play',
      to: 'listen',
      reason: 'listen_button',
      listenDurationMs: 60_000,
    });
    bus.emit('app:lifecycle', { at: 5_000, state: 'background' });
    expect(sessions.calls.some((c) => c.method === 'writeProvisional')).toBe(false);
  });

  it('deletes the provisional record when the app returns to the foreground within grace', () => {
    const { bus, sessions } = createRig();
    bus.emit('session:started', { at: 0, sessionId: 's1', nightWake: false });
    bus.emit('phase:changed', { at: 0, from: 'home', to: 'settle', reason: 'start' });
    bus.emit('app:lifecycle', { at: 5_000, state: 'background' });
    bus.emit('app:lifecycle', { at: 6_000, state: 'active' });
    expect(sessions.calls).toContainEqual({ method: 'deleteProvisional', args: ['s1'] });
  });

  it('does not delete a provisional record twice if session:ended already cleared it', () => {
    const { bus, sessions } = createRig();
    bus.emit('session:started', { at: 0, sessionId: 's1', nightWake: false });
    bus.emit('phase:changed', { at: 0, from: 'home', to: 'settle', reason: 'start' });
    bus.emit('app:lifecycle', { at: 5_000, state: 'background' });
    // Simulate reconcile() having ended the session (grace exceeded) before
    // the director clears backgroundedAt and emits app:lifecycle('active') —
    // the real dispatch order documented in SessionDirector.appLifecycle().
    bus.emit('phase:changed', {
      at: 20_000,
      from: 'settle',
      to: 'ended',
      reason: 'app_background',
    });
    bus.emit('session:ended', {
      at: 20_000,
      summary: baseSummary({ endReason: 'app_background' }),
    });
    sessions.calls.length = 0;
    bus.emit('app:lifecycle', { at: 20_001, state: 'active' });
    expect(sessions.calls.some((c) => c.method === 'deleteProvisional')).toBe(false);
  });
});

describe('SessionRuntime: session end', () => {
  it('finalizes the summary, releases wake lock and brightness, stops audio, and deactivates background audio', async () => {
    const { bus, clock, platform, sessions, audioEngine } = createRig();
    await audioEngine.unlock();
    const stopAllSpy = vi.spyOn(audioEngine, 'stopAll');
    bus.emit('session:ended', { at: 1000, summary: baseSummary({ endReason: 'user_exit' }) });
    await vi.waitFor(() => {
      expect(sessions.calls.some((c) => c.method === 'finalize')).toBe(true);
    });
    expect(platform.calls).toContainEqual({ method: 'wakeLock.release', args: [] });
    expect(platform.calls).toContainEqual({ method: 'brightness.restore', args: [] });
    await vi.waitFor(() => {
      expect(stopAllSpy).toHaveBeenCalledWith(CONFIG.audio.STOP_ON_BACKGROUND_RAMP_MS);
    });
    // stopAll()'s own ramp wait is a clock.setTimeout(), so the FakeClock
    // must be advanced for its promise to resolve before deactivate() runs.
    clock.advance(CONFIG.audio.STOP_ON_BACKGROUND_RAMP_MS);
    await vi.waitFor(() => {
      expect(platform.calls.some((c) => c.method === 'backgroundAudio.deactivate')).toBe(true);
    });
  });

  it('uses a 0ms stop ramp for fade and listen_timer, since both already faded audio out themselves', async () => {
    const { bus, audioEngine } = createRig();
    await audioEngine.unlock();
    const stopAllSpy = vi.spyOn(audioEngine, 'stopAll');

    bus.emit('session:ended', { at: 1000, summary: baseSummary({ endReason: 'fade' }) });
    await vi.waitFor(() => {
      expect(stopAllSpy).toHaveBeenCalledWith(0);
    });

    stopAllSpy.mockClear();
    bus.emit('session:ended', { at: 1000, summary: baseSummary({ endReason: 'listen_timer' }) });
    await vi.waitFor(() => {
      expect(stopAllSpy).toHaveBeenCalledWith(0);
    });
  });

  it('uses STOP_ON_BACKGROUND_RAMP_MS for an abrupt app_background end', async () => {
    const { bus, audioEngine } = createRig();
    await audioEngine.unlock();
    const stopAllSpy = vi.spyOn(audioEngine, 'stopAll');
    bus.emit('session:ended', { at: 1000, summary: baseSummary({ endReason: 'app_background' }) });
    await vi.waitFor(() => {
      expect(stopAllSpy).toHaveBeenCalledWith(CONFIG.audio.STOP_ON_BACKGROUND_RAMP_MS);
    });
  });

  it('deactivates background audio only after stopAll resolves', async () => {
    const { bus, platform, audioEngine } = createRig();
    await audioEngine.unlock();
    let resolveStop: () => void = () => undefined;
    vi.spyOn(audioEngine, 'stopAll').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve;
        }),
    );

    bus.emit('session:ended', { at: 1000, summary: baseSummary({}) });
    await Promise.resolve();
    await Promise.resolve();
    expect(platform.calls.some((c) => c.method === 'backgroundAudio.deactivate')).toBe(false);

    resolveStop();
    await vi.waitFor(() => {
      expect(platform.calls.some((c) => c.method === 'backgroundAudio.deactivate')).toBe(true);
    });
  });
});

describe('SessionRuntime: dispose', () => {
  it('stops reacting to bus events after dispose()', () => {
    const { bus, platform, runtime } = createRig();
    runtime.dispose();
    bus.emit('phase:changed', { at: 0, from: 'home', to: 'settle', reason: 'start' });
    expect(platform.calls).toHaveLength(0);
  });
});
