// Spec §0: every native call (brightness, wake lock, background audio) goes
// through this interface — never a direct Capacitor/browser API call from
// core, audio, scene or ui. See plan §4.4.

import type { LifecycleState, PlatformKind } from '../core/types';
import type { Unsubscribe } from '../core/events';

export type { LifecycleState, PlatformKind };

export interface PlatformInfo {
  readonly kind: PlatformKind;
  readonly isNative: boolean;
  /** display-mode: standalone, or navigator.standalone on iOS Safari. */
  readonly isStandalonePwa: boolean;
  readonly userAgent: string;
}

export interface BrightnessControl {
  readonly supported: boolean;
  /** Current level 0..1, or null if unknown/unsupported. */
  get(): Promise<number | null>;
  /**
   * Clamp to [0,1] and apply. The first call in a "dim span" captures the
   * original level for restore(). Remembers the target.
   */
  set(level: number): Promise<void>;
  /** Restore the captured original and clear the target. Idempotent; a no-op if set() was never called. */
  restore(): Promise<void>;
}

export interface WakeLockControl {
  readonly supported: boolean;
  readonly held: boolean;
  /** Returns whether the lock is actually held. Web re-acquires on return to foreground while wanted. */
  acquire(): Promise<boolean>;
  /** Idempotent; clears "wanted". */
  release(): Promise<void>;
}

export interface NowPlayingMeta {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
}

export type RemoteCommand = 'play' | 'pause' | 'stop';

export interface BackgroundAudioControl {
  /** 'native-session' = Android foreground service via plugin; 'web-media-session' = navigator.mediaSession only. */
  readonly mode: 'none' | 'web-media-session' | 'native-session';
  /** Call right after long-running audio starts: sets metadata, 'playing' state, audioSession.type='playback'. */
  activate(meta: NowPlayingMeta): Promise<void>;
  setState(state: 'playing' | 'paused'): Promise<void>;
  /** Idempotent. Releases the Android foreground service. */
  deactivate(): Promise<void>;
  onRemoteCommand(fn: (cmd: RemoteCommand) => void): Unsubscribe;
}

export interface LifecycleSource {
  readonly state: LifecycleState;
  onChange(fn: (state: LifecycleState) => void): Unsubscribe;
}

export interface Platform {
  readonly info: PlatformInfo;
  readonly brightness: BrightnessControl;
  readonly wakeLock: WakeLockControl;
  readonly backgroundAudio: BackgroundAudioControl;
  readonly lifecycle: LifecycleSource;
  /** Android hardware back. Web: a no-op that returns a no-op Unsubscribe. */
  onBackButton(fn: () => void): Unsubscribe;
  /**
   * Offers a plain-text file to the OS share sheet (M5 opt-in JSON
   * export, spec §12). `name` is a filename hint, e.g. 'firefly-pond-export.json'.
   * Web: triggers a Blob download. No network call either way (spec §0).
   */
  shareFile(name: string, text: string): Promise<void>;
  /** Restore brightness, release wake lock, deactivate background audio, remove listeners. Idempotent. */
  dispose(): Promise<void>;
}

export interface PlatformOptions {
  /** Also set by a `?platform=web` URL query param. */
  force?: 'web';
  /** Diagnostics sink — the M0 spike page wires this into its log panel. */
  log?: (msg: string) => void;
}
