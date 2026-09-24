// Guards the native-project patches from plan §5.A.14 against a future
// `cap add`/`cap sync` regenerating the platform folders and silently
// dropping them. Skips (with a clear message, not a failure) if a platform
// folder is absent, since the sandbox that authored this file may not be
// the one that generated android/ or ios/.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const INFO_PLIST = path.join(REPO_ROOT, 'ios/App/App/Info.plist');
const APP_DELEGATE = path.join(REPO_ROOT, 'ios/App/App/AppDelegate.swift');
const ANDROID_MANIFEST = path.join(REPO_ROOT, 'android/app/src/main/AndroidManifest.xml');

describe('iOS native patches', () => {
  it.skipIf(!existsSync(INFO_PLIST))('Info.plist declares UIBackgroundModes: audio', () => {
    const text = readFileSync(INFO_PLIST, 'utf-8');
    expect(text).toContain('<key>UIBackgroundModes</key>');
    expect(text).toMatch(/<key>UIBackgroundModes<\/key>\s*<array>\s*<string>audio<\/string>/);
  });

  it.skipIf(!existsSync(APP_DELEGATE))(
    'AppDelegate.swift sets the AVAudioSession .playback category',
    () => {
      const text = readFileSync(APP_DELEGATE, 'utf-8');
      expect(text).toContain('import AVFoundation');
      expect(text).toContain('AVAudioSession.sharedInstance().setCategory(.playback');
    },
  );

  if (!existsSync(INFO_PLIST) || !existsSync(APP_DELEGATE)) {
    it.skip('ios/ is absent in this environment — run `npx cap add ios` and reapply the plan §5.A.14 patch', () =>
      undefined);
  }
});

describe('Android native patches', () => {
  it.skipIf(!existsSync(ANDROID_MANIFEST))(
    'AndroidManifest.xml declares FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    () => {
      const text = readFileSync(ANDROID_MANIFEST, 'utf-8');
      expect(text).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK');
    },
  );

  it.skipIf(!existsSync(ANDROID_MANIFEST))(
    'AndroidManifest.xml does not request the notifications permission',
    () => {
      const text = readFileSync(ANDROID_MANIFEST, 'utf-8');
      expect(text).not.toContain('android.permission.POST_NOTIFICATIONS');
    },
  );

  if (!existsSync(ANDROID_MANIFEST)) {
    it.skip('android/ is absent in this environment — run `npx cap add android` and reapply the plan §5.A.14 patch', () =>
      undefined);
  }
});
