// Test double for Platform. Records every call so tests can assert on what
// SessionRuntime (M1+) did, and lets tests flip `supported` flags and push
// lifecycle/remote-command events without touching real browser/Capacitor APIs.
import type { Unsubscribe } from '@/core/events';
import type {
  BackgroundAudioControl,
  BrightnessControl,
  LifecycleSource,
  LifecycleState,
  NowPlayingMeta,
  Platform,
  PlatformInfo,
  PlatformKind,
  RemoteCommand,
  WakeLockControl,
} from '@/platform/Platform';

export interface FakePlatformCall {
  method: string;
  args: unknown[];
}

export class FakePlatform implements Platform {
  readonly calls: FakePlatformCall[] = [];
  readonly sharedFiles: { name: string; text: string }[] = [];
  readonly info: PlatformInfo;
  readonly brightness: BrightnessControl & { setSupported(v: boolean): void };
  readonly wakeLock: WakeLockControl & { setSupported(v: boolean): void };
  readonly backgroundAudio: BackgroundAudioControl;
  readonly lifecycle: LifecycleSource & { emit(state: LifecycleState): void };

  private readonly backButtonListeners = new Set<() => void>();
  private readonly remoteListeners = new Set<(cmd: RemoteCommand) => void>();

  constructor(kind: PlatformKind = 'web') {
    this.info = {
      kind,
      isNative: kind !== 'web',
      isStandalonePwa: false,
      userAgent: 'FakePlatform',
    };
    this.brightness = this.makeBrightness(kind);
    this.wakeLock = this.makeWakeLock();
    this.backgroundAudio = this.makeBackgroundAudio(kind);
    this.lifecycle = this.makeLifecycle();
  }

  shareFile(name: string, text: string): Promise<void> {
    this.calls.push({ method: 'shareFile', args: [name, text] });
    this.sharedFiles.push({ name, text });
    return Promise.resolve();
  }

  onBackButton(fn: () => void): Unsubscribe {
    this.backButtonListeners.add(fn);
    return () => {
      this.backButtonListeners.delete(fn);
    };
  }

  triggerBackButton(): void {
    for (const fn of this.backButtonListeners) fn();
  }

  triggerRemoteCommand(cmd: RemoteCommand): void {
    for (const fn of this.remoteListeners) fn(cmd);
  }

  async dispose(): Promise<void> {
    this.calls.push({ method: 'dispose', args: [] });
    await this.brightness.restore();
    await this.wakeLock.release();
    await this.backgroundAudio.deactivate();
  }

  private makeBrightness(
    kind: PlatformKind,
  ): BrightnessControl & { setSupported(v: boolean): void } {
    let supported = kind !== 'web';
    let level: number | null = null;
    let target: number | null = null;
    const calls = this.calls;
    return {
      get supported() {
        return supported;
      },
      setSupported(v: boolean) {
        supported = v;
      },
      get(): Promise<number | null> {
        calls.push({ method: 'brightness.get', args: [] });
        return Promise.resolve(level);
      },
      set(l: number): Promise<void> {
        calls.push({ method: 'brightness.set', args: [l] });
        if (target === null) target = level;
        level = l;
        return Promise.resolve();
      },
      restore(): Promise<void> {
        calls.push({ method: 'brightness.restore', args: [] });
        if (target !== null) level = target;
        target = null;
        return Promise.resolve();
      },
    };
  }

  private makeWakeLock(): WakeLockControl & { setSupported(v: boolean): void } {
    let supported = true;
    let held = false;
    const calls = this.calls;
    return {
      get supported() {
        return supported;
      },
      setSupported(v: boolean) {
        supported = v;
      },
      get held() {
        return held;
      },
      acquire(): Promise<boolean> {
        calls.push({ method: 'wakeLock.acquire', args: [] });
        held = supported;
        return Promise.resolve(held);
      },
      release(): Promise<void> {
        calls.push({ method: 'wakeLock.release', args: [] });
        held = false;
        return Promise.resolve();
      },
    };
  }

  private makeBackgroundAudio(kind: PlatformKind): BackgroundAudioControl {
    const calls = this.calls;
    const remoteListeners = this.remoteListeners;
    return {
      mode: kind === 'android' ? 'native-session' : 'web-media-session',
      activate(meta: NowPlayingMeta): Promise<void> {
        calls.push({ method: 'backgroundAudio.activate', args: [meta] });
        return Promise.resolve();
      },
      setState(state: 'playing' | 'paused'): Promise<void> {
        calls.push({ method: 'backgroundAudio.setState', args: [state] });
        return Promise.resolve();
      },
      deactivate(): Promise<void> {
        calls.push({ method: 'backgroundAudio.deactivate', args: [] });
        return Promise.resolve();
      },
      onRemoteCommand(fn: (cmd: RemoteCommand) => void): Unsubscribe {
        remoteListeners.add(fn);
        return () => {
          remoteListeners.delete(fn);
        };
      },
    };
  }

  private makeLifecycle(): LifecycleSource & { emit(state: LifecycleState): void } {
    let state: LifecycleState = 'active';
    const listeners = new Set<(state: LifecycleState) => void>();
    return {
      get state() {
        return state;
      },
      onChange(fn: (state: LifecycleState) => void): Unsubscribe {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      emit(next: LifecycleState): void {
        state = next;
        for (const fn of listeners) fn(next);
      },
    };
  }
}
