// Capacitor (iOS/Android) Platform implementation. This is the only module
// (besides web.ts) allowed to import Capacitor packages — spec §0.

import { KeepAwake } from '@capacitor-community/keep-awake';
import { ScreenBrightness } from '@capacitor-community/screen-brightness';
import { MediaSession } from '@capgo/capacitor-media-session';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

import type { Unsubscribe } from '../core/events';
import type {
  BackgroundAudioControl,
  BrightnessControl,
  LifecycleSource,
  LifecycleState,
  NowPlayingMeta,
  Platform,
  PlatformInfo,
  PlatformKind,
  PlatformOptions,
  RemoteCommand,
  WakeLockControl,
} from './Platform';
import type { MediaMetadataInit } from './web';
import { metadataInitFrom } from './web';

/** Android's "unchanged" sentinel for ScreenBrightness.getBrightness(). */
const ANDROID_UNCHANGED_BRIGHTNESS = -1;

function nativeKind(): 'ios' | 'android' {
  const raw = Capacitor.getPlatform();
  return raw === 'ios' ? 'ios' : 'android';
}

function createInfo(kind: PlatformKind): PlatformInfo {
  return {
    kind,
    isNative: true,
    isStandalonePwa: false,
    userAgent: navigator.userAgent,
  };
}

function createBrightness(
  kind: 'ios' | 'android',
  lifecycle: LifecycleSource,
  log: (msg: string) => void,
): BrightnessControl {
  let original: number | null = null;
  let target: number | null = null;

  async function readRaw(): Promise<number | null> {
    try {
      const { brightness } = await ScreenBrightness.getBrightness();
      if (kind === 'android' && brightness === ANDROID_UNCHANGED_BRIGHTNESS) return null;
      return brightness;
    } catch (err) {
      log(`brightness: get failed: ${String(err)}`);
      return null;
    }
  }

  /** The platform-specific "put brightness back" call — does not touch `target`. */
  async function applyRestore(): Promise<void> {
    try {
      if (kind === 'android') {
        await ScreenBrightness.setBrightness({ brightness: ANDROID_UNCHANGED_BRIGHTNESS });
      } else if (original !== null) {
        await ScreenBrightness.setBrightness({ brightness: original });
      }
    } catch (err) {
      log(`brightness: restore failed: ${String(err)}`);
    }
  }

  lifecycle.onChange((state) => {
    if (state === 'background') {
      void applyRestore();
    } else if (target !== null) {
      void ScreenBrightness.setBrightness({ brightness: target }).catch((err: unknown) => {
        log(`brightness: re-apply on foreground failed: ${String(err)}`);
      });
    }
  });

  return {
    supported: true,
    get(): Promise<number | null> {
      return readRaw();
    },
    async set(level: number): Promise<void> {
      const clamped = Math.min(1, Math.max(0, level));
      if (target === null) {
        original = await readRaw();
      }
      target = clamped;
      try {
        await ScreenBrightness.setBrightness({ brightness: clamped });
      } catch (err) {
        log(`brightness: set failed: ${String(err)}`);
      }
    },
    async restore(): Promise<void> {
      if (target === null) return;
      await applyRestore();
      target = null;
      original = null;
    },
  };
}

function createWakeLock(log: (msg: string) => void): WakeLockControl {
  let supported = false;
  let held = false;
  const readySupport = KeepAwake.isSupported()
    .then((r) => {
      supported = r.isSupported;
    })
    .catch(() => {
      supported = false;
    });

  return {
    get supported() {
      return supported;
    },
    get held() {
      return held;
    },
    async acquire(): Promise<boolean> {
      await readySupport;
      if (!supported) return false;
      try {
        await KeepAwake.keepAwake();
        held = true;
        return true;
      } catch (err) {
        log(`wakeLock: acquire failed: ${String(err)}`);
        held = false;
        return false;
      }
    },
    async release(): Promise<void> {
      if (!held) return;
      try {
        await KeepAwake.allowSleep();
      } catch (err) {
        log(`wakeLock: release failed: ${String(err)}`);
      } finally {
        held = false;
      }
    },
  };
}

interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: string, handler: (() => void) | null): void;
}
interface MediaMetadataLike {
  new (init?: MediaMetadataInit): unknown;
}

function getMediaSession(): MediaSessionLike | null {
  return (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession ?? null;
}

function iosBackgroundAudio(log: (msg: string) => void): BackgroundAudioControl {
  // WKWebView exposes navigator.mediaSession too; the native category comes
  // from the AppDelegate patch (plan §5.A.14), not from this module.
  const session = getMediaSession();
  const remoteListeners = new Set<(cmd: RemoteCommand) => void>();
  let handlersRegistered = false;

  function registerHandlersOnce(): void {
    if (!session || handlersRegistered) return;
    handlersRegistered = true;
    const forward = (cmd: RemoteCommand) => () => {
      for (const fn of remoteListeners) fn(cmd);
    };
    session.setActionHandler('play', forward('play'));
    session.setActionHandler('pause', forward('pause'));
    session.setActionHandler('stop', forward('stop'));
  }

  return {
    mode: session ? 'web-media-session' : 'none',
    activate(meta: NowPlayingMeta): Promise<void> {
      if (session) {
        const w = globalThis as unknown as { MediaMetadata?: MediaMetadataLike };
        if (w.MediaMetadata) {
          session.metadata = new w.MediaMetadata(metadataInitFrom(meta));
        }
        session.playbackState = 'playing';
        registerHandlersOnce();
      }
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      log('backgroundAudio(ios): activate');
      return Promise.resolve();
    },
    setState(state: 'playing' | 'paused'): Promise<void> {
      if (session) session.playbackState = state;
      return Promise.resolve();
    },
    deactivate(): Promise<void> {
      if (session) session.playbackState = 'none';
      log('backgroundAudio(ios): deactivate');
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

function androidBackgroundAudio(log: (msg: string) => void): BackgroundAudioControl {
  const remoteListeners = new Set<(cmd: RemoteCommand) => void>();
  let handlersRegistered = false;

  function registerHandlersOnce(): void {
    if (handlersRegistered) return;
    handlersRegistered = true;
    const forward = (cmd: RemoteCommand) => () => {
      for (const fn of remoteListeners) fn(cmd);
    };
    void MediaSession.setActionHandler({ action: 'play' }, forward('play'));
    void MediaSession.setActionHandler({ action: 'pause' }, forward('pause'));
    void MediaSession.setActionHandler({ action: 'stop' }, forward('stop'));
  }

  return {
    mode: 'native-session',
    async activate(meta: NowPlayingMeta): Promise<void> {
      await MediaSession.setMetadata(metadataInitFrom(meta));
      // Starts the mediaPlayback foreground service — see the Android manifest patch (plan §5.A.14).
      await MediaSession.setPlaybackState({ playbackState: 'playing' });
      registerHandlersOnce();
      log('backgroundAudio(android): activate (foreground service)');
    },
    async setState(state: 'playing' | 'paused'): Promise<void> {
      await MediaSession.setPlaybackState({ playbackState: state });
    },
    async deactivate(): Promise<void> {
      await MediaSession.setPlaybackState({ playbackState: 'none' });
      log('backgroundAudio(android): deactivate (foreground service released)');
    },
    onRemoteCommand(fn: (cmd: RemoteCommand) => void): Unsubscribe {
      remoteListeners.add(fn);
      return () => {
        remoteListeners.delete(fn);
      };
    },
  };
}

function createShareFile(log: (msg: string) => void): Platform['shareFile'] {
  return async (name: string, text: string): Promise<void> => {
    try {
      const { uri } = await Filesystem.writeFile({
        path: name,
        data: text,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({ url: uri, title: name });
    } catch (err) {
      log(`shareFile: failed: ${String(err)}`);
    }
  };
}

interface LifecycleWithDispose {
  lifecycle: LifecycleSource;
  dispose: () => Promise<void>;
}

async function createLifecycle(): Promise<LifecycleWithDispose> {
  const listeners = new Set<(state: LifecycleState) => void>();
  const initial = await App.getState();
  let state: LifecycleState = initial.isActive ? 'active' : 'background';

  const handle = await App.addListener('appStateChange', ({ isActive }) => {
    const next: LifecycleState = isActive ? 'active' : 'background';
    if (next === state) return;
    state = next;
    for (const fn of listeners) fn(state);
  });

  return {
    lifecycle: {
      get state() {
        return state;
      },
      onChange(fn: (state: LifecycleState) => void): Unsubscribe {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
    },
    dispose: () => handle.remove(),
  };
}

export async function createCapacitorPlatform(opts?: PlatformOptions): Promise<Platform> {
  const log = opts?.log ?? (() => undefined);
  const kind = nativeKind();
  const { lifecycle, dispose: disposeLifecycle } = await createLifecycle();
  const brightness = createBrightness(kind, lifecycle, log);
  const wakeLock = createWakeLock(log);
  const backgroundAudio = kind === 'ios' ? iosBackgroundAudio(log) : androidBackgroundAudio(log);
  const shareFile = createShareFile(log);

  const backButtonListeners = new Set<() => void>();
  const backButtonHandle = await App.addListener('backButton', () => {
    for (const fn of backButtonListeners) fn();
  });

  let disposed = false;

  return {
    info: createInfo(kind),
    brightness,
    wakeLock,
    backgroundAudio,
    lifecycle,
    shareFile,
    onBackButton(fn: () => void): Unsubscribe {
      backButtonListeners.add(fn);
      return () => {
        backButtonListeners.delete(fn);
      };
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await brightness.restore();
      await wakeLock.release();
      await backgroundAudio.deactivate();
      await disposeLifecycle();
      await backButtonHandle.remove();
    },
  };
}
