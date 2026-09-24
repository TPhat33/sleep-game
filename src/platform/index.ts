import { Capacitor } from '@capacitor/core';

import type { Platform, PlatformOptions } from './Platform';

function forcedWeb(opts?: PlatformOptions): boolean {
  if (opts?.force === 'web') return true;
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('platform') === 'web';
}

/**
 * Selects the Platform implementation at runtime. The dynamic imports keep
 * native-plugin JS out of the PWA's critical path and keep the two
 * implementations swappable (plan §1.4).
 */
export async function createPlatform(opts?: PlatformOptions): Promise<Platform> {
  if (!forcedWeb(opts) && Capacitor.isNativePlatform()) {
    const { createCapacitorPlatform } = await import('./capacitor');
    return createCapacitorPlatform(opts);
  }
  const { createWebPlatform } = await import('./web');
  return createWebPlatform(opts);
}

export type {
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
