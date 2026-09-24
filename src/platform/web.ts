// Web (browser / PWA) Platform implementation. No brightness control exists
// on the web platform — see plan §4.4's implementation notes table.

import type { Unsubscribe } from '../core/events';
import type {
  BackgroundAudioControl,
  BrightnessControl,
  LifecycleSource,
  LifecycleState,
  NowPlayingMeta,
  Platform,
  PlatformInfo,
  PlatformOptions,
  RemoteCommand,
  WakeLockControl,
} from './Platform';

interface WakeLockSentinelLike {
  released: boolean;
  addEventListener(type: 'release', fn: () => void): void;
  release(): Promise<void>;
}

interface NavigatorWithWakeLock {
  wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

export interface MediaMetadataInit {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: { src: string }[];
}

interface MediaMetadataLike {
  new (init?: MediaMetadataInit): unknown;
}

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: string, handler: (() => void) | null): void;
}

function hasWakeLock(nav: Navigator): nav is Navigator & NavigatorWithWakeLock {
  return 'wakeLock' in nav;
}

function getMediaSession(): MediaSessionLike | null {
  return (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession ?? null;
}

function getMediaMetadataCtor(): MediaMetadataLike | null {
  const w = globalThis as unknown as { MediaMetadata?: MediaMetadataLike };
  return w.MediaMetadata ?? null;
}

/** Builds a metadata init object without `exactOptionalPropertyTypes`-violating `undefined` values. */
export function metadataInitFrom(meta: NowPlayingMeta): MediaMetadataInit {
  return {
    title: meta.title,
    ...(meta.artist !== undefined ? { artist: meta.artist } : {}),
    ...(meta.album !== undefined ? { album: meta.album } : {}),
    ...(meta.artworkUrl !== undefined ? { artwork: [{ src: meta.artworkUrl }] } : {}),
  };
}

function isStandalonePwa(): boolean {
  const standaloneMql =
    typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)').matches : false;
  const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;
  return standaloneMql || iosStandalone;
}

function createInfo(): PlatformInfo {
  return {
    kind: 'web',
    isNative: false,
    isStandalonePwa: isStandalonePwa(),
    userAgent: navigator.userAgent,
  };
}

function createBrightness(): BrightnessControl {
  return {
    supported: false,
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    restore: () => Promise.resolve(),
  };
}

function createWakeLock(log: (msg: string) => void): WakeLockControl {
  const supported = hasWakeLock(navigator);
  let sentinel: WakeLockSentinelLike | null = null;
  let wanted = false;

  async function requestLock(): Promise<boolean> {
    if (!supported) return false;
    try {
      sentinel = await (navigator as Navigator & NavigatorWithWakeLock).wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        log('wakeLock: released');
        sentinel = null;
      });
      return true;
    } catch (err) {
      log(`wakeLock: request failed: ${String(err)}`);
      sentinel = null;
      return false;
    }
  }

  if (supported) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wanted && sentinel === null) {
        void requestLock();
      }
    });
  }

  return {
    get supported() {
      return supported;
    },
    get held() {
      return sentinel !== null && !sentinel.released;
    },
    async acquire(): Promise<boolean> {
      wanted = true;
      return requestLock();
    },
    async release(): Promise<void> {
      wanted = false;
      if (sentinel) {
        await sentinel.release();
        sentinel = null;
      }
    },
  };
}

function createBackgroundAudio(log: (msg: string) => void): BackgroundAudioControl {
  const session = getMediaSession();
  const supported = session !== null;
  const mode = supported ? 'web-media-session' : 'none';
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
    mode,
    activate(meta: NowPlayingMeta): Promise<void> {
      if (session) {
        const Ctor = getMediaMetadataCtor();
        if (Ctor) {
          session.metadata = new Ctor(metadataInitFrom(meta));
        }
        session.playbackState = 'playing';
        registerHandlersOnce();
      }
      if (navigator.audioSession) {
        navigator.audioSession.type = 'playback';
      }
      log(`backgroundAudio: activate (mode=${mode})`);
      return Promise.resolve();
    },
    setState(state: 'playing' | 'paused'): Promise<void> {
      if (session) session.playbackState = state;
      return Promise.resolve();
    },
    deactivate(): Promise<void> {
      if (session) session.playbackState = 'none';
      log('backgroundAudio: deactivate');
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

function createLifecycle(): LifecycleSource {
  const listeners = new Set<(state: LifecycleState) => void>();
  let state: LifecycleState = document.visibilityState === 'visible' ? 'active' : 'background';

  function setState(next: LifecycleState): void {
    if (next === state) return;
    state = next;
    for (const fn of listeners) fn(state);
  }

  document.addEventListener('visibilitychange', () => {
    setState(document.visibilityState === 'visible' ? 'active' : 'background');
  });
  document.addEventListener('pagehide', () => {
    setState('background');
  });
  document.addEventListener('pageshow', () => {
    setState('active');
  });

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
  };
}

export function createWebPlatform(opts?: PlatformOptions): Platform {
  const log = opts?.log ?? (() => undefined);
  const brightness = createBrightness();
  const wakeLock = createWakeLock(log);
  const backgroundAudio = createBackgroundAudio(log);
  const lifecycle = createLifecycle();
  let disposed = false;

  return {
    info: createInfo(),
    brightness,
    wakeLock,
    backgroundAudio,
    lifecycle,
    onBackButton(): Unsubscribe {
      return () => undefined;
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await brightness.restore();
      await wakeLock.release();
      await backgroundAudio.deactivate();
    },
  };
}
