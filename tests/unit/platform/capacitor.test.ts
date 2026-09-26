import { beforeEach, describe, expect, it, vi } from 'vitest';

interface BrightnessResult {
  brightness: number;
}
interface PluginHandle {
  remove: () => Promise<void>;
}

const getBrightness = vi.fn<() => Promise<BrightnessResult>>();
const setBrightness = vi.fn<(opts: BrightnessResult) => Promise<void>>();
vi.mock('@capacitor-community/screen-brightness', () => ({
  ScreenBrightness: { getBrightness, setBrightness },
}));

const keepAwake = vi.fn<() => Promise<void>>();
const allowSleep = vi.fn<() => Promise<void>>();
const isSupported = vi.fn<() => Promise<{ isSupported: boolean }>>();
vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: { keepAwake, allowSleep, isSupported },
}));

const setMetadata = vi.fn<(opts: Record<string, unknown>) => Promise<void>>();
const setPlaybackState = vi.fn<(opts: { playbackState: string }) => Promise<void>>();
const setActionHandler =
  vi.fn<(opts: { action: string }, handler: (() => void) | null) => Promise<void>>();
vi.mock('@capgo/capacitor-media-session', () => ({
  MediaSession: { setMetadata, setPlaybackState, setActionHandler },
}));

const appGetState = vi.fn<() => Promise<{ isActive: boolean }>>();
const appAddListener =
  vi.fn<(eventName: string, listener: (...a: never[]) => void) => Promise<PluginHandle>>();
vi.mock('@capacitor/app', () => ({
  App: { getState: appGetState, addListener: appAddListener },
}));

const getPlatform = vi.fn<() => string>();
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform, isNativePlatform: () => true },
}));

const writeFile = vi.fn<(opts: { path: string; data: string }) => Promise<{ uri: string }>>();
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}));

const share = vi.fn<(opts: { url?: string; title?: string }) => Promise<void>>();
vi.mock('@capacitor/share', () => ({
  Share: { share },
}));

const { createCapacitorPlatform } = await import('@/platform/capacitor');

interface AppStateChangeCall {
  0: 'appStateChange';
  1: (state: { isActive: boolean }) => void;
}

function lastAppStateChangeListener(): (state: { isActive: boolean }) => void {
  const call = appAddListener.mock.calls.find((c) => c[0] === 'appStateChange') as
    AppStateChangeCall | undefined;
  if (!call) throw new Error('appStateChange listener was never registered');
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  getBrightness.mockResolvedValue({ brightness: 0.6 });
  setBrightness.mockResolvedValue(undefined);
  keepAwake.mockResolvedValue(undefined);
  allowSleep.mockResolvedValue(undefined);
  isSupported.mockResolvedValue({ isSupported: true });
  setMetadata.mockResolvedValue(undefined);
  setPlaybackState.mockResolvedValue(undefined);
  setActionHandler.mockResolvedValue(undefined);
  appGetState.mockResolvedValue({ isActive: true });
  appAddListener.mockImplementation(() =>
    Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) }),
  );
  writeFile.mockResolvedValue({ uri: 'file:///cache/export.json' });
  share.mockResolvedValue(undefined);
});

describe('createCapacitorPlatform: brightness (iOS)', () => {
  it('captures the original level on first set() and restores that exact value', async () => {
    getPlatform.mockReturnValue('ios');
    const platform = await createCapacitorPlatform();

    getBrightness.mockResolvedValue({ brightness: 0.6 });
    await platform.brightness.set(0.02);
    expect(setBrightness).toHaveBeenCalledWith({ brightness: 0.02 });

    await platform.brightness.restore();
    expect(setBrightness).toHaveBeenLastCalledWith({ brightness: 0.6 });
  });

  it('re-applying background then active restores then re-applies the target', async () => {
    getPlatform.mockReturnValue('ios');
    const platform = await createCapacitorPlatform();
    const onChange = lastAppStateChangeListener();

    getBrightness.mockResolvedValue({ brightness: 0.7 });
    await platform.brightness.set(0.02);
    setBrightness.mockClear();

    onChange({ isActive: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(setBrightness).toHaveBeenCalledWith({ brightness: 0.7 });

    setBrightness.mockClear();
    onChange({ isActive: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(setBrightness).toHaveBeenCalledWith({ brightness: 0.02 });
  });
});

describe('createCapacitorPlatform: brightness (Android)', () => {
  it('restores with -1', async () => {
    getPlatform.mockReturnValue('android');
    const platform = await createCapacitorPlatform();

    getBrightness.mockResolvedValue({ brightness: 0.4 });
    await platform.brightness.set(0.02);
    await platform.brightness.restore();
    expect(setBrightness).toHaveBeenLastCalledWith({ brightness: -1 });
  });
});

describe('createCapacitorPlatform: brightness restore()', () => {
  it('called twice only issues one plugin call the second time is a no-op', async () => {
    getPlatform.mockReturnValue('android');
    const platform = await createCapacitorPlatform();
    await platform.brightness.set(0.02);
    await platform.brightness.restore();
    const callsAfterFirstRestore = setBrightness.mock.calls.length;
    await platform.brightness.restore();
    expect(setBrightness.mock.calls.length).toBe(callsAfterFirstRestore);
  });
});

describe('createCapacitorPlatform: dispose (Android)', () => {
  it('restores brightness, releases the wake lock, and deactivates background audio', async () => {
    getPlatform.mockReturnValue('android');
    const platform = await createCapacitorPlatform();
    await platform.brightness.set(0.02);
    await platform.wakeLock.acquire();

    await platform.dispose();

    expect(setBrightness).toHaveBeenLastCalledWith({ brightness: -1 });
    expect(allowSleep).toHaveBeenCalledTimes(1);
    expect(setPlaybackState).toHaveBeenLastCalledWith({ playbackState: 'none' });
  });
});

describe('createCapacitorPlatform: remote commands (Android)', () => {
  it('forwards play/pause/stop from the plugin to onRemoteCommand', async () => {
    getPlatform.mockReturnValue('android');
    const platform = await createCapacitorPlatform();
    const received: string[] = [];
    platform.backgroundAudio.onRemoteCommand((cmd) => received.push(cmd));

    await platform.backgroundAudio.activate({ title: 'Firefly Pond' });

    const playHandler = setActionHandler.mock.calls.find((c) => c[0].action === 'play')?.[1];
    const pauseHandler = setActionHandler.mock.calls.find((c) => c[0].action === 'pause')?.[1];
    const stopHandler = setActionHandler.mock.calls.find((c) => c[0].action === 'stop')?.[1];

    playHandler?.();
    pauseHandler?.();
    stopHandler?.();

    expect(received).toEqual(['play', 'pause', 'stop']);
  });
});

describe('createCapacitorPlatform: shareFile', () => {
  it('writes the file to the cache directory, then shares its uri', async () => {
    getPlatform.mockReturnValue('ios');
    const platform = await createCapacitorPlatform();

    await platform.shareFile('firefly-pond-export.json', '{"sessions":[]}');

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'firefly-pond-export.json',
        data: '{"sessions":[]}',
        directory: 'CACHE',
        encoding: 'utf8',
      }),
    );
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'file:///cache/export.json' }),
    );
  });

  it('logs rather than throws when the native calls fail', async () => {
    getPlatform.mockReturnValue('android');
    writeFile.mockRejectedValue(new Error('disk full'));
    const log = vi.fn();
    const platform = await createCapacitorPlatform({ log });

    await expect(platform.shareFile('x.json', '{}')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('shareFile'));
    expect(share).not.toHaveBeenCalled();
  });
});
