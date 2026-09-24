# Device testing guide

This is the human half of M0 (plan §5.B) and a reusable checklist for every
milestone after it. The sandbox that wrote the code cannot run it on a real
phone — that's this document's job.

## What the sandbox already validated (and didn't)

The implementer's sandbox has no iOS/Android device or simulator, so it
could only validate what's possible without one:

- `npm run verify` (typecheck, lint, format, unit tests, `vite build`) is
  green, including `tests/unit/platform/**` (mocked Capacitor plugin calls)
  and `tests/unit/native/native-config.test.ts` (reads the patched
  `Info.plist`/`AppDelegate.swift`/`AndroidManifest.xml` as text).
- `npx cap add ios`, `npx cap add android` and `npx cap sync` all succeeded
  on Linux (Capacitor 8's Swift Package Manager default doesn't need a Mac
  just to generate the Xcode project) — both native projects are committed
  with the plan §5.A.14 patches already applied.
- The Playwright `mobile-chromium` e2e project passed against `vite
preview` in headless Chromium: Home renders, the spike page's Unlock
  button brings the AudioContext to `running`, the A1 preset starts
  playback with a clean log, and the log persists across a reload.
- The Android Gradle build itself (`cd android && ./gradlew assembleDebug`,
  the plan's optional 30-minute-time-boxed check) was **not attempted**:
  the sandbox has JDK 21 but no Android SDK, and installing one means
  downloading it, which wasn't worth the time budget for an optional,
  skippable check. If you have Android Studio open already, running it
  once is a good extra sanity check before the on-device tests below.
- Nothing here proves any of A1–C1 below. Headless Chromium's Screen Wake
  Lock and Media Session behavior (and whether it even has them) has no
  relationship to Safari/WebView behavior on a real, screen-lockable
  device — that's the entire reason this document exists.

---

## Prerequisites

- **iOS**: a Mac with a current Xcode, an Apple ID with a signing team (a
  free personal team is enough for on-device testing), and an iOS 16.4+
  device.
- **Android**: Android Studio with JDK 21, USB debugging enabled on an
  Android 10+ (API 29+) device, and Android System WebView 120+.
- Both platforms: the repo checked out, `npm ci` run once.
- A way to serve `dist/` over **HTTPS** for the PWA variants — wake lock and
  `navigator.audioSession` both require a secure context. The quickest
  option with no account needed:
  ```
  npm run build && npm run preview
  npx cloudflared tunnel --url http://localhost:4173
  ```
  Any static HTTPS host works too (Netlify, Vercel, GitHub Pages, …).

## Device preconditions for every audio test

- battery ≥ 60% and **unplugged**
- Low Power Mode / Battery Saver **off** (repeat the winning strategy's A1
  once more with it **on**)
- media volume 50%, no headphones (repeat once with Bluetooth headphones if
  available)
- iOS: silent switch **on** (this is exactly what verifies `.playback`
  ignores it)
- **Auto-Lock / Screen timeout = 30 seconds**
- Do Not Disturb on, so notifications don't confound the test

## Building the four variants

| Variant               | How                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **iOS PWA**           | `npm run build && npm run preview`, tunnel it over HTTPS (see above), open in Safari, Share → **Add to Home Screen**, then launch from the home-screen icon. **Test the home-screen app, not the Safari tab** — they behave differently. |
| **iOS Capacitor**     | On a Mac with Xcode: `npm ci && npm run cap:sync && npm run cap:ios`. Set a signing team in Xcode and run on the device. If `ios/` isn't present in your checkout, run `npx cap add ios` first and reapply the patch below.              |
| **Android PWA**       | Same HTTPS URL in Chrome, ⋮ → **Add to Home screen** / **Install app**, launch from the icon.                                                                                                                                            |
| **Android Capacitor** | Android Studio with JDK 21: `npm ci && npm run cap:sync && npm run cap:android`, run on a USB-debugging device.                                                                                                                          |

For each device, record on the spike page's Info panel: build ID, platform
kind, user agent (which includes the WebView/Safari version).

### If you ever need to regenerate the native projects

```
npm run build
npx cap add ios       # or: npx cap add android
```

Then reapply the plan §5.A.14 patches (also checked by
`tests/unit/native/native-config.test.ts`, which fails loudly if they're
missing once the platform folder exists):

- **iOS** — `ios/App/App/Info.plist`: add
  ```xml
  <key>UIBackgroundModes</key>
  <array>
    <string>audio</string>
  </array>
  ```
  `ios/App/App/AppDelegate.swift`: `import AVFoundation`, and in
  `application(_:didFinishLaunchingWithOptions:)`:
  ```swift
  do {
      try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
  } catch {
      print("AVAudioSession category error: \(error)")
  }
  ```
- **Android** — `android/app/src/main/AndroidManifest.xml`: add
  ```xml
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
  ```
  (required on API 34+ alongside the media-session plugin's own
  `FOREGROUND_SERVICE` permission). Do **not** add `POST_NOTIFICATIONS`.

---

## Using the spike page

Open `/spike.html` (a link from the Home screen in dev builds, or navigate
directly). Top to bottom:

1. **Info** — confirms the build and platform, and which capabilities the
   browser/WebView reports as supported.
2. **Audio lab** — tap **Unlock audio** first (must be a real tap: audio
   contexts only unlock inside a user gesture). Pick a **Strategy**, toggle
   **Layers**, then **Play**. Or just tap **Start preset**, which sets up
   the full A1 configuration in one tap.
3. **Continuity monitor** — after backgrounding and returning, shows how
   much audio-thread time advanced versus wall-clock time. Below 100%
   roughly means real audible gaps.
4. **JS heartbeat** — shows the largest gap between 5-second beats. A large
   gap while the screen was locked means the WebView froze JS — expected on
   iOS, and exactly why plan §1.8 pre-schedules everything on the audio
   thread instead of relying on JS timers.
5. **Brightness** / **Wake lock** — exercise `Platform.brightness` /
   `Platform.wakeLock` directly.
6. **Log** — a persistent, timestamped event log. **Export log** downloads a
   text file; if downloads are blocked in a WebView, the log is also
   copyable and survives a reload (backed by `localStorage`), so you can
   read it after returning to the app.

### Reading and exporting the log

- **Copy log** puts the whole log on the clipboard.
- **Export log** downloads `spike-log-<buildId>-<timestamp>.txt`.
- The log persists across a reload or the app being killed and reopened —
  check it even if you forgot to export before backgrounding.
- Paste failing runs (and one passing run per variant) into
  `docs/m0-findings.md` under the matching test row, inside a collapsible
  `<details>` block.

---

## M0 test procedures (fill in `docs/m0-findings.md` as you go)

Run **A1–A5 for each of the four variants**. For A1, try strategies in the
order `webaudio-direct` → `element-bridge` → `element-files` (baseline).
Once a strategy passes A1 on a variant, run A2–A5 with that same strategy.

- **A1 — 30-minute locked playback (the acceptance test).** Unlock audio,
  enable brown noise (buffer) + rain loop + marker chime every 60s, turn on
  MediaSession and Activate background audio, leave wake lock released
  (or just tap **Start preset**). Tap Play, lock the screen, put the phone
  face down. Check by ear at 5, 15, 30 and 35 minutes — the chime should
  sound once a minute. At 35 minutes, unlock, read the Continuity report,
  export the log. Record: pass/fail, the minute it stopped (if it did),
  continuity %, largest JS gap, and whether lock-screen controls appeared.
- **A2 — ramp while locked.** Tap a fade-to-silence button, lock
  immediately. Record whether it audibly fades to silence by the expected
  time or stops abruptly. For `element-files`, also note whether
  "element.volume settable?" reads `false` (expected on iOS).
- **A3 — pre-scheduled events while locked.** Tap **Schedule blips**, mute
  the bed layers, lock. Record whether blips continue at 10/20/40 minutes.
  This is the load-bearing test for the Listen-mode pre-scheduling design.
- **A4 — app switch.** While playing, switch to another app for 2 minutes,
  then return. Record whether audio continued and the UI state is
  consistent.
- **A5 — interruption (optional).** While locked and playing, trigger an
  alarm or receive a call; record whether audio resumes on its own, after
  unlocking, or not at all.
- **A6 — battery and heat.** One 60-minute locked run per OS, Capacitor
  build, winning strategy. Record battery % start/end and whether the
  device feels warm.
- **B1 — brightness (Capacitor only).** Set system brightness ~60%, read it
  back. Set min (0.02), record the read-back and whether it's visibly dim.
  Restore, confirm it returns to ~60%. Set min then background the app —
  brightness should restore automatically; return and confirm the target
  re-applies. Set min then swipe-kill the app — record what happens (iOS
  may stay dim; that's a known risk, record it honestly). Repeat with the
  slider at 0.0 to see if it's unreadably dark.
- **B2 — brightness on PWA.** Confirm it reports unsupported. Nothing else
  to check.
- **C1 — wake lock (all variants).** With 30s auto-lock: Acquire, wait 2
  minutes untouched, confirm the screen stayed on. Release, confirm it
  locks within ~40s. Acquire again, background for 10s, return, confirm it
  shows re-acquired.

Fill the decision rubric in `docs/m0-findings.md` once the tables are
complete.

---

## Reusable per-milestone device checklist (spec §16)

Repeat this short checklist on at least one real iOS and one real Android
device at the end of every milestone that touches audio, brightness, or
battery behavior:

- [ ] Audio keeps playing (and, if applicable, fading/ramping) while the
      screen is locked for the milestone's relevant duration.
- [ ] Screen brightness behaves as designed (dims, restores, survives
      backgrounding).
- [ ] Battery drain over 60 minutes of the milestone's primary use case is
      reasonable (record the %).
- [ ] Device doesn't get noticeably hot.
- [ ] No unexpected native permission prompts appear (especially no
      notification prompt).
