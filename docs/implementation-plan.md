# บึงหิ่งห้อย (Firefly Pond): Implementation Plan

Architect: Opus 5.5 · Implementer: Sonnet 5 · Source spec: `firefly-pond-spec.md` (v0.1, Thai)
Date: 2026-09-24 · Status: authoritative for M0; directional for M1–M5

This document turns the spec into decisions an implementer can code against without re-deriving anything. Where this plan and the spec disagree, **this plan wins**, and every deviation is marked **[DEVIATION]** with the reason. Anything added that the spec does not cover is marked **[ADDITION]**. Items that genuinely need real devices or real users are marked **[VALIDATE]**.

Section references like "spec §5.1" point to the spec document.

---

## Top decisions at a glance

| # | Decision | Where |
|---|---|---|
| 1 | **Capacitor-first** is the planning assumption. The PWA stays a dev/test target. M0 on-device results confirm or overturn this. | §2.1, §5 |
| 2 | Clock time is **epoch ms** (`Date.now` semantics), not `performance.now`. iOS's monotonic clock stops during device sleep, and a sleep app has to count sleep time. | §1.3 |
| 3 | Listen-mode audio is **pre-scheduled on the Web Audio thread**: shuffle words, tail ramp and stop are all queued at listen start, so nothing depends on JS timers running while the screen is locked. | §1.8 |
| 4 | Audio output goes through an internal `AudioOutput` strategy (`webaudio-direct` or `element-bridge`), so M0's findings change one factory and leave the `AudioEngine` API alone. | §1.8, §4.6 |
| 5 | Plugins: `@capacitor-community/screen-brightness`, `@capacitor-community/keep-awake`, `@capgo/capacitor-media-session` (Android foreground service), `@capacitor/app`. **No** native audio player plugin by default. | §2.2 |
| 6 | Pattern is **commands in, events out**. `SessionDirector` is pure logic (Clock + Bus + Estimator + NightWake). A separate `SessionRuntime` glue layer drives audio, platform and persistence. | §1.2 |
| 7 | An injected `Rng` (seeded in tests) is added alongside `Clock`, and `Math.random` is lint-banned. | §4.2 |
| 8 | ESLint enforces the spec's rules: no raw timers or `Date.now` outside `clock.ts`, no Capacitor imports outside `src/platform/`, and no UI or framework imports in `src/core/`. | §3.5 |
| 9 | No vue-router and no Pinia. Screens are selected from director phase plus a small nav state. Services are provided through `provide/inject`. | §2.2 |
| 10 | TypeScript pinned to **~6.0.3**: TS 7 exists, but typescript-eslint supports only `<6.1`. | §3.1 |
| 11 | Brown noise comes from a **pre-rendered seamless looping buffer** by default, with the AudioWorklet kept as an option. **[DEVIATION]** | §2.2 |
| 12 | Audio assets ship as **AAC `.m4a` only**. No ogg. **[DEVIATION]** | §2.2 |
| 13 | M0 splits into a sandbox half the implementer completes (§5.A) and a device half a human completes (§5.B). **M0 is not formally closed until §5.B is done.** | §5 |

---

## 1. Architecture overview

### 1.1 Layer diagram

```
┌──────────────────────────────── Vue 3 shell (src/ui) ────────────────────────────────┐
│  App.vue ── picks screen from (director phase + nav state)                           │
│  Home / Settle / Pond(hosts Pixi canvas) / Listen / Sky / Journal / Settings / ...   │
│  composables: useServices(), useBusEvent(), usePhase()                               │
└───────────────▲───────────────────────────────────────────────┬──────────────────────┘
                │ bus events (read-only)                         │ commands (method calls)
┌───────────────┴───────────── src/app (composition + glue) ─────▼──────────────────────┐
│  bootstrap.ts   builds: RealClock, systemRng, Platform, EventBus, DB, AudioEngine,    │
│                 DrowsinessEstimator, NightWakeDetector, PacingController,             │
│                 SessionDirector, SessionRuntime                                       │
│  SessionRuntime subscribes to bus → calls AudioEngine / Platform / repositories       │
│                 per-frame: pacing = PacingController.update(director.snapshot)        │
└──────┬───────────────────┬──────────────────────┬──────────────────────┬─────────────┘
       │                   │                      │                      │
┌──────▼──────┐   ┌────────▼────────┐   ┌─────────▼────────┐   ┌─────────▼─────────┐
│ src/core    │   │ src/scene       │   │ src/audio        │   │ src/platform      │
│ (pure TS,   │   │ model/ (pure)   │   │ AudioEngine      │   │ Platform iface    │
│  no DOM,    │   │ entities/ (Pixi)│   │ outputs/         │   │ web.ts            │
│  no Vue)    │   │ PondScene       │   │ dsp/ (pure)      │   │ capacitor.ts      │
│ Clock, Rng, │   └─────────────────┘   └──────────────────┘   │ index.ts (select) │
│ EventBus,   │                                                 └───────────────────┘
│ config,     │   ┌─────────────────┐
│ Director,   │   │ src/store       │  idb, schema v1, migrations, repositories
│ Estimator,  │   └─────────────────┘
│ Pacing,     │
│ NightWake,  │
│ moon        │
└─────────────┘
```

Dependency rule (lint-enforced): `core` imports nothing from `ui`, `scene`, `audio`, `platform`, `store`, `vue`, `pixi.js` or `@capacitor/*`. `scene`, `audio` and `store` may import `core`. Only `src/app` and `src/ui` import everything.

### 1.2 Key design principles

1. **Commands in, events out.** `SessionDirector` takes inputs only as method calls (`start()`, `tap()`, `requestListen()`, …) and publishes every state change as a typed bus event. Tests call methods and assert on emitted events, with no mocking of collaborators.
2. **Pure core, impure edges.** Everything in `src/core` is deterministic given `(Clock, Rng, config, inputs)`. Platform, audio, DOM and IndexedDB side effects live in `src/app/SessionRuntime.ts`, `src/audio` and `src/platform`.
3. **One composition root.** `src/app/bootstrap.ts` is the only place that calls `new RealClock()`, `createPlatform()`, `openAppDb()` or `new AudioContext()`. Every other module receives dependencies through its constructor.
4. **Pull for per-frame values, push for discrete changes.** The scene pulls `PacingOutput` each frame. Audio and platform react to `phase:changed` events and set ramps once per transition, never per frame.
5. **Deadlines are re-checked, never trusted.** JS timers are best-effort while backgrounded (iOS freezes WKWebView JS), so any deadline that matters (listen end, fade complete, background grace) is re-evaluated against `clock.now()` whenever the app becomes active (`SessionDirector.reconcile()`).

### 1.3 Clock design (and why epoch ms)

- `Clock.now()` returns **epoch milliseconds** (`Date.now()` in `RealClock`). **[DEVIATION from typical game practice; the spec does not specify which.]**
  - Reason: on iOS, `performance.now()` is backed by a monotonic clock that **does not advance while the device sleeps**. A 60-minute listen session that spends time with the device asleep would otherwise under-count. Wall time is the right base for "minutes to fade", night-wake windows and listen timers.
  - Risk: a manual clock change mid-session. Mitigation: Director and Estimator clamp any negative delta to 0. Accepted.
- Timers (`setTimeout`/`setInterval`) are part of `Clock`, so `FakeClock` can drive them deterministically.
- Local-time logic (night hours, morning survey, reveal hours) uses `new Date(clock.now()).getHours()` through one helper, `localHour(epochMs)` in `src/core/time.ts`. Constructing a `Date` from a given ms value is allowed. Reading the current time any way other than through the Clock is not.
- Tests run with `TZ=Asia/Bangkok` (set at the top of `vitest.config.ts`; Thailand has no DST, so night-hour tests stay deterministic).
- Rendering animation (Pixi) uses the Pixi ticker's `deltaMS` for smoothness. **Gameplay timing** (spawns, breath-cue phase, reaction times, tap timestamps) always comes from `clock.now()`.

### 1.4 Platform abstraction and runtime selection

- `src/platform/Platform.ts` defines one `Platform` object made of four capability groups: `brightness`, `wakeLock`, `backgroundAudio`, `lifecycle` (plus `info`, `onBackButton`, `dispose`). Full signatures are in §4.4.
- `src/platform/index.ts` exports `createPlatform(opts?)`. It checks `Capacitor.isNativePlatform()` and then **dynamically imports** `./capacitor` or `./web`. The dynamic import keeps native-plugin JS out of the PWA's critical path and keeps implementations swappable. The URL override `?platform=web` forces the web implementation, so a web-only fallback can be tested inside the native shell.
- Each capability group exposes a `supported` flag. Callers never branch on `info.kind`; they branch on `supported`. For example, the web implementation reports `brightness.supported === false`, and `SessionRuntime` then relies only on `dimAlpha`.
- Both implementations own their restore duties. `dispose()` restores brightness, releases the wake lock and deactivates the background audio session, and it is idempotent. The Capacitor implementation also restores brightness automatically when the app goes to the background (iOS sets **system** brightness, which otherwise stays dimmed after the user leaves; see §2.2).
- Tests use `tests/helpers/FakePlatform.ts`, which records every call in an array and lets tests flip `supported` flags and emit lifecycle changes.

### 1.5 Config structure

- `src/core/config.ts` exports:
  - `interface Config`: explicit types, **not** `typeof CONFIG`. The spec's `as const` would give literal types (`0.6` rather than `number`), which makes test overrides impossible. **[DEVIATION]**
  - `type SessionConfig = Config['session']` and similar aliases, one per slice (`DrowsinessConfig`, `PacingConfig`, `SceneConfig`, `AudioConfig`, `NightWakeConfig`, `MetaConfig`, `PlatformConfig`).
  - `export const CONFIG: DeepReadonly<Config>` with the spec's values (§13) plus the additions below, frozen with `deepFreeze` at module load.
  - `export function makeConfig(overrides?: DeepPartial<Config>): DeepReadonly<Config>` deep-merges onto `CONFIG`. Tests use it; production code never does.
- Each module receives **only its slice** (or a `Pick<Config, …>` of the slices it needs) through its constructor. No module imports `CONFIG` directly except `src/app/bootstrap.ts` and `src/spike/*`.
- Keep the spec's UPPER_SNAKE key names so keys can be traced back to the spec.
- Tuples are typed `readonly [number, number]` (`RESPAWN_DELAY_MS`) and lists `readonly number[]` (`LISTEN_OPTIONS_MIN`).

**[ADDITION] Keys missing from spec §13** (add these to `config.ts` with these defaults):

```ts
session: {
  // ...spec keys...
  GENTLE_EXIT_CONFIRM_WINDOWS: 2,        // spec §5.2 "ต่อเนื่อง 2 รอบ"
  LISTEN_DEFAULT_MIN: 60,                // default listen timer before settings exist
  LISTEN_EXTEND_MS: 15 * 60_000,         // "ต่อเวลา" button in listen controls
  LISTEN_CONTROLS_VISIBLE_MS: 5_000,     // spec M1 "แสดงปุ่ม ... 5 วินาที แล้วดับ"
  LISTEN_HOLD_WAKE_LOCK: false,          // listen lets the OS lock the screen (see §1.9)
  APP_BACKGROUND_GRACE_MS: 10_000,       // Control Center / notification pull must not end a session
},
drowsiness: {
  // ...spec keys...
  BASELINE_SUBWINDOW_MS: 30_000,         // spec §6.1 "sub-window 30 วินาที"
  Z_CLAMP: 3,                            // spec §6.1 clamp(z, -3, 3)
},
pacing: {
  // ...spec keys...
  FADE_BRIGHTNESS_TARGET: 0.02,          // fade also drops native brightness (spec only says listen) [ADDITION]
},
scene: {
  // ...spec keys...
  FPS_PLAY: 30,
  FPS_DRIFT: 20,
  FIREFLY_COUNT: [8, 12],
  BOAT_CAPACITY: 3,
  MAX_DEVICE_PIXEL_RATIO: 2,
},
audio: {
  // ...spec keys...
  SHUFFLE_NO_REPEAT: 30,                 // spec §9.2 "ไม่ซ้ำภายใน 30 คำล่าสุด"
  LISTEN_TAIL_GAP_MULT: 1.5,             // spec §9.2
  STOP_ON_BACKGROUND_RAMP_MS: 2_000,
  BROWN_NOISE_LOOP_S: 30,
  OUTPUT_STRATEGY: { web: 'webaudio-direct', ios: 'webaudio-direct', android: 'webaudio-direct' },
                                         // updated from M0 findings; type AudioOutputKind
  LAYER_GAIN: { rain: 0.6, crickets: 0.4, brownNoise: 0.5, asmrTaps: 0.3, shuffleVoice: 0.35, breathCue: 0.2 },
},
meta: {
  // ...spec keys...
  MORNING_SURVEY_START_HOUR: 5,          // spec §11 "05:00–12:00"
  MORNING_SURVEY_END_HOUR: 12,
  SYNODIC_MONTH_DAYS: 29.530588,
},
```

### 1.6 Typed event bus

- `src/core/events.ts` contains a generic `EventBus<M extends object>` and the app's `AppEvents` map.
- Constrain with `M extends object`, **not** `Record<string, unknown>`. An `interface` has no index signature and would fail the `Record` constraint.
- Dispatch is **synchronous**, in subscription order. A listener that throws is isolated: the error goes to the `onError` callback (default `console.error`) and the other listeners still run. Tests construct the bus with `onError: (e) => { throw e; }`.
- Every payload is an object that includes `at: number` (clock time), which makes event logs and debug overlays trivial.
- No wildcards and no string-typed events. Adding an event means adding a key to `AppEvents`.
- Vue side: `useBusEvent(bus, 'phase:changed', fn)` subscribes and unsubscribes on unmount.

### 1.7 Vue shell hosting PixiJS

- **No vue-router.** `App.vue` renders `<component :is="screenFor(phase, nav)">`. The app is a state machine, URLs are meaningless inside Capacitor, and the Android back button goes through `platform.onBackButton` (`@capacitor/app`) and maps to director commands or nav pops.
- **No Pinia.** Services are created in `bootstrap.ts` and supplied with `app.provide(ServicesKey, services)`. Reactive UI state is small: `phase` comes from a `shallowRef` updated by `phase:changed`, and nav comes from a `ref`.
- **Pixi mount pattern (Pond.vue, M2):**
  1. `const host = ref<HTMLDivElement>()`. The Pixi objects live in plain `let` variables, **never** in `ref`/`reactive` (Vue proxies wreck Pixi performance). Use `markRaw` if anything must be stored reactively.
  2. `onMounted(async () => { const app = new Application(); await app.init({ resizeTo: host.value, background: '#0B0806', antialias: false, autoDensity: true, resolution: Math.min(devicePixelRatio, cfg.MAX_DEVICE_PIXEL_RATIO), preference: 'webgl' }); if (disposed) { app.destroy(true); return; } host.value.appendChild(app.canvas); app.ticker.maxFPS = cfg.FPS_PLAY; scene = new PondScene(app, deps); })`
  3. `onBeforeUnmount(() => { disposed = true; scene?.destroy(); app?.destroy(true, { children: true, texture: true }); })`. The `disposed` flag handles unmount before `init` resolves.
  4. Prefer `'webgl'` over WebGPU: WebView support for WebGPU is inconsistent, and the scene is simple.
- Vue overlays (listen-offer chip, gentle-exit prompt, debug overlay) are absolutely-positioned DOM siblings above the canvas. Pixi never renders UI text.

### 1.8 Audio architecture (constrains M0 → M1)

The hardest platform risk is **audio continuing, fading and speaking words while the screen is locked and JS is frozen**. The architecture avoids that risk rather than hoping it doesn't occur:

1. **Single Web Audio graph** for mixing: layer gains → `master` GainNode → `AudioOutput`. Ramps use `AudioParam.linearRampToValueAtTime`, which runs on the audio thread with no JS involvement.
2. **Pre-scheduling:** `startListen(durationMs)` computes the whole listen timeline up front: every shuffle word start time (gaps drawn from the injected `Rng`, the ×1.5 stretch applied during the tail, and nothing scheduled in the final `LISTEN_TAIL_MS` window), the master ramp to 0, and the source `stop()` times. It then queues all of them against `AudioContext.currentTime`. A 90-minute session is about 500 `AudioBufferSourceNode.start(when)` calls against about 150 shared decoded buffers, which is cheap. JS timers are used only for UI.
3. **`AudioOutput` strategies** (internal to `src/audio/outputs/`):
   - `webaudio-direct`: `master → ctx.destination`. Default.
   - `element-bridge`: `master → MediaStreamAudioDestinationNode → <audio>.srcObject`, played by an `HTMLAudioElement`. On some platforms, a playing media element keeps the audio session alive in the background where a bare AudioContext is suspended.
   - The strategy is chosen per platform from `CONFIG.audio.OUTPUT_STRATEGY` and the M0 findings. The `AudioEngine` public API (spec §9.3) is identical under either strategy.
4. **Rejected as the primary path: `element-files`** (a separate `<audio loop>` per layer). iOS ignores `HTMLMediaElement.volume` (it is always 1), so fades and tail ramps are impossible there. It is tested in the M0 spike **only as a baseline** for diagnosis.
5. If M0 shows that neither `webaudio-direct` nor `element-bridge` survives a 30-minute lock on **iOS Capacitor**, the fallback is `@capgo/capacitor-native-audio` for bed layers, which requires an M1 re-plan. Do not pre-build it.
6. `AudioContext` is created with `{ latencyHint: 'playback' }` (larger buffers, better battery) inside `unlock()`, after the first user gesture.

### 1.9 Session lifecycle policy (platform side effects per phase)

`SessionRuntime` applies this table on each `phase:changed`. **[ADDITION]** The spec only partly defines it (spec §5.4, M3 fade).

| Phase | Wake lock | Native brightness | Background audio session | If app goes to background |
|---|---|---|---|---|
| home | released | restore | inactive | nothing |
| settle | **held** | untouched | inactive | after `APP_BACKGROUND_GRACE_MS` → `ended(app_background)` |
| play | **held** | untouched | inactive | after grace → `ended(app_background)`, scene paused immediately |
| drift | **held** | untouched | inactive | after grace → `ended(app_background)` |
| fade | **held** until ended | `FADE_BRIGHTNESS_TARGET` | inactive | → `ended(fade)` immediately (they fell asleep) |
| listen | **released** (`LISTEN_HOLD_WAKE_LOCK=false`) | `BRIGHTNESS_MIN` | **active** | continue; nothing changes |
| ended | released | restore | deactivate after `stopAll` resolves | — |

- **Grace handling:** on background, the Director records `backgroundedAt` and the runtime writes a *provisional* `SessionSummary` (`app_background`, `endedAt = backgroundedAt`). If the app returns within the grace period, the session continues and the provisional summary is deleted. Otherwise `reconcile()` finalizes it. If the app is killed, the provisional record is already correct.
- **Listen releases the wake lock** so the OS can turn the screen off, which saves battery and heat. The black, minimum-brightness screen covers the seconds before the OS auto-locks. **[VALIDATE]** with real users: some may expect the screen to stay on.

---

## 2. Resolved open questions

### 2.1 Spec §18 open questions

| # | Question | Decision (default to build against) | Needs validation? |
|---|---|---|---|
| 1 | iOS: native audio plugin, or `HTMLAudioElement` + Media Session? | **Neither as primary.** Use Capacitor iOS with `UIBackgroundModes=audio`, `AVAudioSession` category `.playback` set in `AppDelegate`, plus `navigator.audioSession.type = 'playback'` from JS, plus a **Web Audio graph with pre-scheduled listen timeline** (§1.8). Fallback order: `element-bridge` output, then `@capgo/capacitor-native-audio`. `navigator.mediaSession` metadata is set for lock-screen display on every platform. | **[VALIDATE] M0 on device, the central M0 question.** |
| 2 | Drowsiness weights and thresholds | **Keep the spec values unchanged.** I prototyped the §6.1 algorithm against synthetic fixtures (Appendix A). With the fixture parameters in Appendix A, all five §6.3 expectations hold across 5–10 seeds. Caveat: `alertSteady` peaks around 0.27 against the 0.30 bound, so there is little margin. M3 adds `?debug=1` and local-only per-session sample logs so the values can be tuned later. | **[VALIDATE] real users, post-beta.** Tests pin fixture behavior, not real-world truth. |
| 3 | Whisper voice: record in-house or hire a voice artist? | **Engineering does not block on this.** Recommend a hired Thai voice artist for consistency across about 150 words and future additions. In-house recording is fine for beta. Until real files exist, M1 uses **generated placeholder clips** (`scripts/gen-placeholder-voice.mjs`: soft filtered-noise bursts ≤1.2 s, one per word index) so gap and tail logic can be heard and tested. Recording spec for the artist: 48 kHz mono, ≤1.5 s, 30 ms fade-in / 80 ms fade-out, loudness-normalized to −30 LUFS integrated with −6 dBFS true peak, exported as AAC 96 kbps `.m4a`, file name `/voice/th/<index>.m4a` where index is the position in `words.th.json`. | Product-owner decision; not blocking. |
| 4 | Tablet landscape: boats at the side or the bottom? | **Bottom, in both orientations.** Keeps one motor habit and one layout code path. The stream bezier (`stream.ts`) is defined in normalized 0..1 coordinates and fit to the viewport's aspect ratio, so landscape simply gets a longer, flatter stream. Phones lock to portrait at runtime (`@capacitor/screen-orientation` when the shortest side is < 600 dp, added in M2). Tablets rotate freely. | **[VALIDATE]** light usability check on one tablet in M2. |

### 2.2 Implicit questions

| Topic | Decision | Rationale |
|---|---|---|
| **Brightness plugin** | `@capacitor-community/screen-brightness@^8.0.0` | Maintained and supports Capacitor 8. API: `setBrightness({brightness})` / `getBrightness()`. **Behavior difference:** iOS sets **system** brightness (`UIScreen.main.brightness`), which persists after the app leaves. Android sets the **window** brightness, and `-1` restores the user setting. Our Capacitor Platform must capture the original on iOS and restore on background, `dispose` and `ended`. |
| **Wake lock plugin** | `@capacitor-community/keep-awake@^8.0.1` (`keepAwake`/`allowSleep`/`isKeptAwake`). Web uses the Screen Wake Lock API, re-acquired on `visibilitychange → visible` while wanted. **No NoSleep.js-style video hack.** | The hack wastes battery and is fragile. If the web API is absent, report `supported=false`. |
| **Background audio (Android)** | `@capgo/capacitor-media-session@^8.0.32`. `setPlaybackState({playbackState:'playing'})` starts a `mediaPlayback` foreground service; `'none'` releases it when the app stops. | It is the maintained Capacitor 8 successor to the unmaintained `@jofr/capacitor-media-session` (last release 2024, Capacitor 6 only). Android needs a foreground service to survive Doze for 30+ minutes. |
| **Background audio (iOS)** | No plugin. Native patch: Info.plist `UIBackgroundModes: [audio]` and `AppDelegate` `AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)`. JS: `navigator.audioSession.type = 'playback'` when available (WebKit 16.4+). | `.playback` also ignores the silent switch, which is the right behavior for a sleep app. |
| **Lifecycle** | `@capacitor/app@^8.1.1` (`appStateChange`, `backButton`) on native. `visibilitychange`, `pagehide` and `pageshow` on web. | Standard. |
| **No Android notification permission** | Do **not** request `POST_NOTIFICATIONS`. The foreground service runs without it, and on Android 13+ its notification is simply hidden from the shade. | Spec pillar 5 (no push notifications). Avoids a permission prompt that looks like one. |
| **Brown noise** | **[DEVIATION]** The default is a pure function that pre-renders a `BROWN_NOISE_LOOP_S`-second seamless loop (leaky-integrated white noise, DC-blocked, equal-power crossfade at the seam) into an `AudioBuffer`, looped by `AudioBufferSourceNode`. The AudioWorklet version (loaded with Vite `?worker&url`) is implemented only in the spike, for comparison. Drop ScriptProcessor. | It costs nearly zero CPU (battery). It has no worklet-loading edge cases in WebViews. The same samples can be WAV-encoded for the spike's element baseline. A 30 s loop of noise has no audible repetition. |
| **Audio file format** | **[DEVIATION]** AAC in `.m4a` only. No ogg. | AAC plays on iOS WebKit, Android WebView and Chrome. Two formats would double the asset pipeline for no gain. Encoding needs ffmpeg on the content-producer's machine, not in CI. |
| **IndexedDB** | `idb@^8`. One `openAppDb(name = 'firefly-pond')` in `src/store/db.ts` with a typed `DBSchema`. Migrations are an ordered array `MIGRATIONS: Array<(db, tx) => void>`, where index `i` upgrades `i → i+1`. `upgrade(db, oldV, newV, tx)` runs `MIGRATIONS.slice(oldV, newV)`. **Create all five v1 stores in M1** (even those unused until M4) so no pre-release migration is needed. Tests use `fake-indexeddb/auto`. Repositories (`src/store/repositories.ts`) are the only code touching `db`, and they take `Clock` for timestamps and retention purges. | Keeps the schema stable across milestones. Migrations are testable as plain functions. |
| **Session IDs** | `crypto.randomUUID()` wrapped in an injected `ids: () => string` | Deterministic in tests. |
| **Randomness** | **[ADDITION]** `Rng` interface injected like `Clock`. `seededRng(seed)` is mulberry32. `Math.random` is lint-banned outside `rng.ts`. | Spawn choice, respawn delay, shuffle gaps, word choice and visitor chance must all be reproducible in tests. |
| **State management / routing** | No Pinia, no vue-router (§1.7). | Small app driven by a state machine. |
| **Pixi renderer** | WebGL preference, `maxFPS` 30 in play and 20 in drift, DPR capped at 2. | Spec §8 performance. |
| **Fonts** | Self-host **IBM Plex Sans Thai Looped** (OFL), weights 300/400, as `.woff2` in `public/fonts/`, 18 px minimum. Never load from a CDN. | A soft, highly legible looped Thai face. Self-hosting keeps the app offline and sends no third-party requests. **[VALIDATE]** visually in M2; swapping the font is a CSS-only change. |
| **Privacy guard** | A build-only Content-Security-Policy `<meta>` (injected by a tiny Vite plugin with `apply: 'build'`, so dev HMR still works): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'`. | Spec §0 says no data leaves the device. CSP makes an accidental network call fail loudly. `'self'` covers `capacitor://localhost` (iOS) and `https://localhost` (Android). |
| **Minimum OS targets** | iOS 16.4+, Android 10+ (API 29) with Android System WebView 120+. All APIs are feature-detected, with no hard OS checks. | 16.4 is the first iOS with Screen Wake Lock and `navigator.audioSession` (partial). |
| **App identity** | `appId: 'app.fireflypond.dev'` (placeholder) and `appName: 'Firefly Pond'`. The Thai display name `บึงหิ่งห้อย` is added through native localization in M5. | The final bundle ID must be the product owner's reverse domain before store upload. A non-ASCII `appName` risks tooling friction in generated project files. |
| **PWA service worker** | **None in M0.** A static `public/manifest.webmanifest` (`display: standalone`, theme and background `#0B0806`, icons) plus the Apple meta tags is enough for Add to Home Screen testing. Add `vite-plugin-pwa` only if M0 selects PWA-only. | Offline support doesn't matter to the audio test. Keeps M0 lean. |
| **Home → listen by user choice** | **[ADDITION to spec §5.1]** Add a transition `home → listen` via a "ฟังอย่างเดียว" (listen only) button on Home, reason `listen_only`. | M1 builds Listen mode before Play exists, so listen needs an entry point. Being able to just listen is also a reasonable feature. **Product-owner sign-off needed.** If rejected, keep it behind `?debug=1`. |

---

## 3. Project scaffolding plan

### 3.1 `package.json`

Versions are the current majors on npm as of 2026-09-24. Use caret ranges except TypeScript, and commit `package-lock.json`. Node 22 LTS (`.nvmrc`: `22`, `"engines": { "node": ">=22.12" }`, required by Vite 8 and Capacitor CLI 8).

**dependencies**

| Package | Range | Why |
|---|---|---|
| `vue` | `^3.5.43` | UI shell (spec) |
| `pixi.js` | `^8.21.0` | Scene (spec). Installed in M0 so the toolchain is settled once; first used in M2. |
| `idb` | `^8.0.3` | IndexedDB (spec) |
| `@capacitor/core` | `^8.5.2` | Native bridge |
| `@capacitor/app` | `^8.1.1` | Lifecycle and back button |
| `@capacitor/ios`, `@capacitor/android` | `^8.5.2` | Native platforms |
| `@capacitor-community/screen-brightness` | `^8.0.0` | Brightness |
| `@capacitor-community/keep-awake` | `^8.0.1` | Wake lock |
| `@capgo/capacitor-media-session` | `^8.0.32` | Android background-audio foreground service and lock-screen metadata |

**devDependencies**

| Package | Range | Why |
|---|---|---|
| `typescript` | **`~6.0.3`** | Pinned: `typescript-eslint@8.70` requires `<6.1.0`. **Do not use TS 7.** |
| `vue-tsc` | `^3.3.11` | Type-checks `.vue` files |
| `vite` | `^8.3.0` | Build |
| `@vitejs/plugin-vue` | `^6.0.9` | SFCs |
| `@capacitor/cli` | `^8.5.2` | `cap add/sync/open` |
| `vitest`, `@vitest/coverage-v8` | `^5.0.1` | Unit tests |
| `jsdom` | `^30.1.1` | DOM environment for component and web-platform tests, opted in per file |
| `@vue/test-utils` | `^2.5.1` | Component tests |
| `fake-indexeddb` | `^6.2.5` | Store tests (M1+). Install now. |
| `@playwright/test` | `^1.63.0` | E2E |
| `eslint` | `^10.11.0` | Lint |
| `@eslint/js` | `^10.0.1` | Base rules |
| `typescript-eslint` | `^8.70.1` | TS rules, type-aware |
| `eslint-plugin-vue` | `^10.11.1` | Vue rules (bundles `vue-eslint-parser`) |
| `eslint-config-prettier` | `^10.1.8` | Disables conflicting stylistic rules |
| `globals` | `^17.12.0` | Browser and node globals for flat config |
| `prettier` | `^3.9.9` | Format |
| `@types/node` | `^22` | Match the Node 22 runtime, for config files and scripts |

Do not add zod, lodash, pinia, vue-router, howler, tone.js or any analytics or crash SDK.

### 3.2 npm scripts

```jsonc
{
  "dev": "vite",
  "dev:host": "vite --host",
  "build": "vue-tsc --build && vite build",
  "preview": "vite preview --host --port 4173 --strictPort",
  "typecheck": "vue-tsc --build",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test",
  "gen:spike-audio": "node scripts/gen-spike-audio.mjs",
  "cap:sync": "npm run build && cap sync",
  "cap:ios": "cap open ios",
  "cap:android": "cap open android",
  "verify": "npm run typecheck && npm run lint && npm run format:check && npm run test && vite build"
}
```

### 3.3 TypeScript configuration

Follow create-vue's project-references layout:

- `tsconfig.json`: `{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.test.json" }, { "path": "./tsconfig.node.json" }] }`
- `tsconfig.app.json`: `include: ["src/**/*.ts", "src/**/*.vue", "src/env.d.ts"]`, `types: ["vite/client"]`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`
- `tsconfig.test.json`: extends app, `include: ["src/**/*", "tests/**/*"]`, `types: ["vite/client", "node"]`
- `tsconfig.node.json`: `include: ["vite.config.ts", "vitest.config.ts", "playwright.config.ts", "eslint.config.ts", "capacitor.config.ts", "scripts/**/*"]`, `types: ["node"]`
- Always set `types` explicitly in every tsconfig. TS 6 changed ambient-types defaults, and being explicit makes the result version-proof.

Shared `compilerOptions` (put these in a `tsconfig.base.json` and extend it):

```jsonc
{
  "target": "ES2022",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "useUnknownInCatchVariables": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true,
  "resolveJsonModule": true,
  "skipLibCheck": true,
  "noEmit": true,
  "tsBuildInfoFile": "./node_modules/.tmp/<name>.tsbuildinfo"
}
```

`exactOptionalPropertyTypes` stays **on**, because `TapEvent`'s optional fields make the absent-versus-`undefined` distinction meaningful. If a third-party type conflicts, fix it locally with a typed adapter and never turn the flag off. No `enum`s (lint-banned); use string-literal unions.

### 3.4 Vite, Vitest and Playwright config

**`vite.config.ts`**
- `base: './'` makes paths relative, so the same `dist/` works in Capacitor and on any HTTPS subpath. Content JSON keeps the spec's absolute-looking paths (`/dreams/whale.svg`), resolved through `assetUrl(p)` = `import.meta.env.BASE_URL + p.replace(/^\//, '')`.
- Multi-page input: `index.html` (app) and `spike.html` (M0 spike). Use `build.rollupOptions.input`; if Vite 8 logs a deprecation, rename it to `build.rolldownOptions`.
- `build.target: 'es2022'`.
- The CSP-injection plugin (§2.2), `apply: 'build'`.
- `define: { __BUILD_ID__: JSON.stringify(<git short sha or timestamp>) }`, shown on the spike page so device logs can be matched to builds.

**`vitest.config.ts`**
- First line: `process.env.TZ = 'Asia/Bangkok';`
- `mergeConfig(viteConfig, defineConfig({ test: { environment: 'node', include: ['tests/unit/**/*.test.ts'], setupFiles: ['tests/setup.ts'], restoreMocks: true, coverage: { provider: 'v8', include: ['src/core/**', 'src/platform/**', 'src/audio/**', 'src/store/**'], thresholds: { 'src/core/**': { lines: 90, branches: 85 } } } } }))`
- DOM tests opt in with a `// @vitest-environment jsdom` file header.

**`playwright.config.ts`**
- `testDir: 'tests/e2e'`. `webServer: { command: 'npm run build && npm run preview', port: 4173, reuseExistingServer: !process.env.CI }`.
- Projects:
  - `mobile-chromium` (**required**): `browserName: 'chromium'`, `viewport: { width: 390, height: 844 }`, `deviceScaleFactor: 3`, `isMobile: true`, `hasTouch: true`, `launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }`
  - `mobile-webkit` (**best-effort**): `...devices['iPhone 13']` with viewport overridden to 390×844. Run it only if `npx playwright install --with-deps webkit` succeeds in the environment. Linux WebKit is not iOS Safari, so it never substitutes for a device.

### 3.5 ESLint and Prettier

**`eslint.config.ts`** (flat config), in this order:
1. Global ignores: `dist`, `coverage`, `android`, `ios`, `playwright-report`, `test-results`, `public`.
2. `@eslint/js` recommended.
3. `tseslint.configs.strictTypeChecked` with `parserOptions: { projectService: true, extraFileExtensions: ['.vue'] }`.
4. `pluginVue.configs['flat/recommended']` with `languageOptions.parserOptions.parser = tseslint.parser` for `*.vue`.
5. **Project guard rules**:

| Files | Rule | Purpose |
|---|---|---|
| `src/**` except `src/core/clock.ts`, `src/core/rng.ts`, `src/platform/**`, `src/spike/**` | `no-restricted-globals`: `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `requestAnimationFrame`; `no-restricted-properties`: `Date.now`, `performance.now`, `Math.random`, `window.setTimeout`, `window.setInterval`, `globalThis.setTimeout` | Spec §0 Clock rule, plus Rng |
| `src/**` except `src/platform/**` | `no-restricted-imports` patterns: `@capacitor/*`, `@capacitor-community/*`, `@capgo/*` | Spec §0 Platform rule |
| `src/core/**` | `no-restricted-imports`: `vue`, `pixi.js`, `idb`, `**/ui/**`, `**/scene/**`, `**/audio/**`, `**/platform/**`, `**/store/**`, `**/app/**` | Keeps core pure |
| `src/**` except `src/scene/**`, `src/ui/screens/Pond.vue` | `no-restricted-imports`: `pixi.js` | Keeps Pixi contained |
| `src/**` | `no-restricted-syntax`: `TSEnumDeclaration` | No enums |
| `src/core/**`, `src/audio/**` except `src/core/config.ts` | `@typescript-eslint/no-magic-numbers` with `ignore: [-1, 0, 1, 2, 100, 1000, 60000]`, `ignoreArrayIndexes: true`, `ignoreDefaultValues: false` | Spec §0: tunables live in config |
| all TS | `@typescript-eslint/no-floating-promises: error`, `@typescript-eslint/consistent-type-imports: error` | Audio and platform are promise-heavy |
| `tests/**` | Relax the restriction rules and `no-magic-numbers` | Tests may use fixtures and literals |

6. `eslint-config-prettier` last.

**`.prettierrc.json`**: `{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }`. **`.prettierignore`**: same as the ESLint ignores plus `package-lock.json`.

Also add: `.editorconfig` (2 spaces, LF, UTF-8) and a `.gitignore` covering `node_modules`, `dist`, `coverage`, `playwright-report`, `test-results`, `.DS_Store` and `*.local`. Capacitor generates its own ignore files inside `ios/` and `android/`, so commit those folders.

### 3.6 Folder structure

The spec's §3 tree, plus these changes (**[ADDITION]** unless marked):

```
index.html                     # app entry
spike.html                     # [ADDITION] M0 platform spike entry
capacitor.config.ts
ios/  android/                 # generated by `cap add`, then patched (§5.A step 14)
scripts/
  gen-spike-audio.mjs          # [ADDITION] writes public/audio/spike/*.wav (deterministic)
  gen-placeholder-voice.mjs    # [ADDITION] M1
public/
  manifest.webmanifest, icons/, fonts/, audio/, voice/th/, dreams/
docs/
  implementation-plan.md       # this file
  device-testing.md            # [ADDITION] how to build/run on devices + reusable manual QA
  m0-findings.md               # template in M0 (A), filled by human (B)
src/
  main.ts
  env.d.ts                     # __BUILD_ID__, navigator.audioSession typing
  app/                         # [ADDITION] composition root + glue
    bootstrap.ts
    services.ts                # ServicesKey + Services type for provide/inject
    SessionRuntime.ts          # M1+
  core/
    config.ts  clock.ts  rng.ts[ADD]  events.ts  time.ts[ADD]  types.ts[ADD: spec §4 types]
    session/ SessionDirector.ts phases.ts
    drowsiness/ DrowsinessEstimator.ts features.ts
    pacing/ PacingController.ts
    nightwake/ NightWakeDetector.ts
    moon.ts
  scene/
    PondScene.ts  stream.ts  dimOverlay.ts
    model/                     # [ADDITION] pure, Clock+Rng-driven simulation (M2), unit-tested
    entities/ Dream.ts Boat.ts Firefly.ts Star.ts   # Pixi views that render model state
  audio/
    AudioEngine.ts  layers.ts  shuffleVoice.ts  breathCue.ts
    outputs/                   # [ADDITION] AudioOutput strategies
    dsp/                       # [ADDITION] brownNoise.ts, wav.ts: pure, unit-tested (M0)
  ui/ (as spec) + composables/ [ADD] + theme.css [ADD: spec §14 tokens as CSS vars]
  platform/ Platform.ts web.ts capacitor.ts index.ts
  store/ db.ts repositories.ts
  content/ dreams.json words.th.json constellations.json visitors.json
  spike/                       # [ADDITION] M0 only; excluded from release builds in M5
    main.ts SpikeApp.vue audioLab.ts diagLog.ts heartbeat.ts
tests/
  setup.ts
  helpers/ FakePlatform.ts FakeAudioContext.ts(M1) gaussian.ts
  fixtures/ tapStreams.ts
  unit/  (mirrors src/: core/, platform/, audio/, store/, native/)
  e2e/
```

---

## 4. Core interfaces to design first

These are the contracts. Implement them exactly. Doc comments state the semantics the tests will check.

### 4.1 Clock (`src/core/clock.ts`)

```ts
declare const TimerBrand: unique symbol;
export type TimerId = number & { readonly [TimerBrand]: true };

export interface Clock {
  /** Epoch milliseconds (Date.now semantics). The only time source for logic. */
  now(): number;
  setTimeout(cb: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
  setInterval(cb: () => void, ms: number): TimerId;
  clearInterval(id: TimerId): void;
}

export class RealClock implements Clock { /* thin wrappers over globalThis timers + Date.now */ }

/**
 * Deterministic clock for tests.
 * - Timers fire in order of (dueTime, creationSeq). Before each callback, now() == that timer's dueTime.
 * - Timers created during advance() that fall due within the advanced range fire in the same call.
 * - setInterval reschedules at dueTime + ms (no drift). An interval with ms <= 0 throws.
 * - clear* on an unknown or already-fired id is a no-op.
 */
export class FakeClock implements Clock {
  /** Default start: 2026-01-15T22:00:00+07:00 (a night-time start, deliberately). */
  constructor(startEpochMs?: number);
  now(): number;
  setTimeout(cb: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId): void;
  setInterval(cb: () => void, ms: number): TimerId;
  clearInterval(id: TimerId): void;
  /** Advance time by ms, firing due timers in order. */
  advance(ms: number): void;
  /** Advance to an absolute epoch ms (must be >= now()). */
  advanceTo(epochMs: number): void;
  /**
   * Move time forward WITHOUT firing timers (simulates frozen JS while backgrounded).
   * Overdue timers fire on the next advance()/flush(), with now() at the jumped-to time (as real browsers do).
   */
  jump(ms: number): void;
  /** Fire all timers that are already overdue, without moving time. */
  flush(): void;
  pendingTimerCount(): number;
}
```

`src/core/time.ts`: `localHour(epochMs)`, `localDateKey(epochMs)` returning `'YYYY-MM-DD'` (for the `surveys` key), `minutes(ms)`, `clamp`, `lerp`, `easeInOut` (cubic: `t<.5 ? 4t³ : 1-(-2t+2)³/2`), `easeOut`.

### 4.2 Rng (`src/core/rng.ts`)

```ts
export interface Rng { /** Uniform in [0, 1). */ next(): number; }
export function seededRng(seed: number): Rng;           // mulberry32
export const systemRng: Rng;                             // wraps Math.random (the only allowed use)
export function randRange(rng: Rng, [min, max]: readonly [number, number]): number;
export function randInt(rng: Rng, min: number, maxInclusive: number): number;
/** Picks an index not in `recent` (a ring of the last N picks); falls back to any index if all excluded. */
export function pickNoRepeat<T>(rng: Rng, items: readonly T[], recent: readonly number[]): number;
```

### 4.3 Event bus (`src/core/events.ts`)

```ts
export type Unsubscribe = () => void;

export class EventBus<M extends object> {
  constructor(opts?: { onError?: (err: unknown, type: keyof M) => void });
  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): Unsubscribe;
  once<K extends keyof M>(type: K, fn: (payload: M[K]) => void): Unsubscribe;
  emit<K extends keyof M>(type: K, payload: M[K]): void;   // sync, subscription order
  listenerCount(type?: keyof M): number;
  clear(): void;
}

export type TransitionReason =
  | 'start' | 'night_wake' | 'listen_only'                  // from home
  | 'jar_closed' | 'settle_skipped'                         // settle → play
  | 'drowsy' | 'play_max'                                   // play → drift
  | 'listen_button' | 'listen_offer' | 'gentle_exit_listen' // → listen
  | 'idle'                                                  // play/drift → fade
  | 'fade_complete' | 'listen_timer'                        // → ended
  | 'user_exit' | 'app_background';                         // → ended

export interface AppEvents {
  'session:started':    { at: number; sessionId: string; nightWake: boolean };
  'phase:changed':      { at: number; from: Phase; to: Phase; reason: TransitionReason;
                          listenDurationMs?: number };       // present iff to === 'listen'
  'tap:recorded':       { at: number; tap: TapEvent };
  'drowsiness:sample':  { at: number; sample: DrowsinessSample };
  'ui:listenOffer':     { at: number };                      // once per session
  'ui:gentleExit':      { at: number };                      // once per session
  'listen:extended':    { at: number; newEndsAt: number };
  'app:lifecycle':      { at: number; state: LifecycleState };
  'scene:starEarned':   { at: number; golden: boolean };     // M2
  'session:ended':      { at: number; summary: SessionSummary };
}
```

### 4.4 Platform (`src/platform/Platform.ts`)

```ts
export type PlatformKind = 'web' | 'ios' | 'android';
export type LifecycleState = 'active' | 'background';

export interface PlatformInfo {
  readonly kind: PlatformKind;
  readonly isNative: boolean;
  readonly isStandalonePwa: boolean;    // display-mode: standalone || navigator.standalone
  readonly userAgent: string;
}

export interface BrightnessControl {
  readonly supported: boolean;
  /** Current level 0..1, or null if unknown/unsupported. */
  get(): Promise<number | null>;
  /** Clamp to [0,1] and apply. The first call in a "dim span" captures the original level for restore(). Remembers the target. */
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

export interface NowPlayingMeta { title: string; artist?: string; album?: string; artworkUrl?: string }
export type RemoteCommand = 'play' | 'pause' | 'stop';

export interface BackgroundAudioControl {
  /** 'native-session' = Android FGS via plugin; 'web-media-session' = navigator.mediaSession only. */
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
  /** Restore brightness, release wake lock, deactivate background audio, remove listeners. Idempotent. */
  dispose(): Promise<void>;
}

export interface PlatformOptions {
  force?: 'web';                         // also set by ?platform=web
  log?: (msg: string) => void;           // diagnostics sink (the spike wires it into its log)
}
```

`src/platform/index.ts`:
```ts
export async function createPlatform(opts?: PlatformOptions): Promise<Platform> {
  // force web if opts.force === 'web' or URL has ?platform=web
  // else Capacitor.isNativePlatform() ? (await import('./capacitor')).createCapacitorPlatform(opts)
  //                                  : (await import('./web')).createWebPlatform(opts)
}
```

**Implementation notes**

| Capability | `web.ts` | `capacitor.ts` |
|---|---|---|
| brightness | `supported=false`; `get → null`; `set`/`restore` no-ops | `ScreenBrightness`. On first `set` after a restore, capture `original = get()`. `restore`: iOS sets `original`; Android sets `-1`. Subscribe to lifecycle: **background → restore the original but keep the target; active → re-apply the target if one is set.** |
| wakeLock | `navigator.wakeLock.request('screen')`. Track `wanted`. On the sentinel's `release` event set `held=false`. On `visibilitychange → visible` with `wanted`, re-request. `supported = 'wakeLock' in navigator`. | `KeepAwake.keepAwake()` / `allowSleep()`; `supported` from `isSupported()` (cached at creation). |
| backgroundAudio | mode `'web-media-session'` if `'mediaSession' in navigator`, else `'none'`. `activate`: set `navigator.mediaSession.metadata`, `playbackState='playing'`, and `navigator.audioSession.type='playback'` if present. | iOS: same as web (WKWebView exposes mediaSession and audioSession). The native category comes from the AppDelegate patch. Mode is `'web-media-session'`. Android: `MediaSession.setMetadata`, then `setPlaybackState({playbackState:'playing'})`, which starts the FGS. `deactivate` sets `'none'`. Mode is `'native-session'`. Register `setActionHandler` for play/pause/stop and forward them to `onRemoteCommand`. |
| lifecycle | `document.visibilityState` plus `visibilitychange`, `pagehide` (→ background) and `pageshow` (→ active) | `App.addListener('appStateChange', ({isActive}) => …)`. Initial state from `App.getState()`. |
| back button | no-op | `App.addListener('backButton', …)` |

Type `navigator.audioSession` in `src/env.d.ts` (`interface Navigator { audioSession?: { type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record' } }`).

### 4.5 Core types (`src/core/types.ts`)

Copy spec §4 verbatim (`Phase`, `EndReason`, `DreamColor`, `DreamDef`, `TapEvent`, `DrowsinessSample`, `WindowFeatures`, `SessionSummary`). Add:

```ts
export type FeatureKey = 'rtMedian' | 'itiMedian' | 'itiCv' | 'missRate';
export interface FeatureStats { mean: number; std: number }
export type Baseline = Record<FeatureKey, FeatureStats> & { source: 'measured' | 'default' | 'mixed' };
export interface LastSessionInfo { endedAt: number; endReason: EndReason }
```

`WindowFeatures` fields may be undefined when a window lacks data. **[DEVIATION]** Change the spec's `number` to `number | null` for `itiMedian`, `itiCv` and `rtMedian` (see Appendix A for when each is null). `missRate` and `tapCount` are always defined when `tapCount > 0`.

### 4.6 Constructors and wiring (M1–M3 classes, fixed now so M0 doesn't box them in)

```ts
// src/core/drowsiness/DrowsinessEstimator.ts: spec §6.2 API, unchanged
class DrowsinessEstimator {
  constructor(clock: Clock, cfg: DrowsinessConfig);
  startBaseline(): void;            // baseline window starts at clock.now()
  record(e: TapEvent): void;        // e.t must be clock time; out-of-order events are ignored
  tick(): DrowsinessSample | null;  // null until baseline ready
  get score(): number;              // 0 before the first sample
  get isBaselineReady(): boolean;
  get baseline(): Baseline | null;  // [ADDITION] for the debug overlay
  reset(): void;
}

// src/core/nightwake/NightWakeDetector.ts: pure
class NightWakeDetector {
  constructor(clock: Clock, cfg: NightWakeConfig);
  isNightWake(last: LastSessionInfo | null): boolean;   // spec §10 formula, using localHour(clock.now())
  isRevealWindow(): boolean;                            // REVEAL_START_HOUR <= hour < NIGHT_START_HOUR
}

// src/core/pacing/PacingController.ts: no Clock needed (time arrives as input); stateful only for continuity
interface PacingInput {
  phase: Phase;
  now: number;
  phaseEnteredAt: number;
  playElapsedMs: number;            // time spent in 'play' only
  drowsinessScore: number;          // M2 passes 0 (time-only pacing)
  lastTapAt: number | null;
  voicePreference: boolean;         // settings
}
class PacingController {
  constructor(cfg: PacingConfig);
  /** Captures dimAlpha/masterVolume at each phase change, so drift/fade ramps start from where play left off. */
  update(input: PacingInput): PacingOutput;   // PacingOutput per spec §7
  reset(): void;
}

// src/core/session/SessionDirector.ts
interface SessionDirectorDeps {
  clock: Clock;
  bus: EventBus<AppEvents>;
  cfg: Pick<Config, 'session' | 'drowsiness' | 'pacing'>;
  estimator: DrowsinessEstimator;
  nightWake: NightWakeDetector;
  ids: () => string;
}
interface DirectorSnapshot {
  sessionId: string | null;
  phase: Phase;
  phaseEnteredAt: number;
  sessionStartedAt: number | null;
  playElapsedMs: number;            // play phase only (PLAY_MAX_MS, PLAY_CURVE_MS)
  activeElapsedMs: number;          // play + drift (LISTEN_OFFER_MS, GENTLE_EXIT_MS)
  lastTapAt: number | null;
  drowsinessScore: number;
  nightWake: boolean;
  listenEndsAt: number | null;
  listenOfferShown: boolean;
  gentleExitShown: boolean;
  backgroundedAt: number | null;
}
class SessionDirector {
  constructor(deps: SessionDirectorDeps);
  get phase(): Phase;
  snapshot(): DirectorSnapshot;
  // commands
  start(ctx: { lastSession: LastSessionInfo | null; listenDurationMs: number }): void; // home → settle | listen(night_wake)
  startListenOnly(listenDurationMs: number): void;                                     // home → listen (listen_only) [ADDITION]
  completeSettle(how: 'jar_closed' | 'settle_skipped'): void;
  tap(e: Omit<TapEvent, 't'>): void;                     // stamps t = clock.now(); resets idle timer; feeds estimator in play/drift
  starEarned(golden: boolean): void;
  requestListen(reason: 'listen_button' | 'listen_offer', listenDurationMs: number): void;
  gentleExitChoice(choice: 'listen' | 'continue' | 'rest', listenDurationMs: number): void;
  extendListen(ms: number): void;
  exit(): void;                                          // any phase → ended(user_exit)
  appLifecycle(state: LifecycleState): void;             // grace logic per §1.9
  reconcile(): void;                                     // re-check all deadlines vs clock.now()
  dispose(): void;                                       // clears all timers
}
```

**Director timer model:** in play and drift, a `clock.setInterval(WINDOW_STEP_MS)` calls `estimator.tick()`, emits `drowsiness:sample`, then evaluates the drift, gentle-exit and listen-offer rules. One-shot timers are: idle (reset on every tap, `IDLE_TO_FADE_MS`), play-max, listen-offer, fade-complete (`max(FADE_SCREEN_MS, FADE_AUDIO_MS)` after entering fade), listen-end, and background-grace. Every timer callback and `reconcile()` compares against `clock.now()`, never against "the timer fired".

```ts
// src/audio/AudioEngine.ts: spec §9.3 public API unchanged; extra deps in a 4th param [ADDITION]
interface AudioEngineDeps {
  rng: Rng;
  createContext: () => AudioContextLike;       // real: () => new AudioContext({ latencyHint: 'playback' })
  loadBuffer: (url: string, ctx: AudioContextLike) => Promise<AudioBuffer>;
  outputKind: AudioOutputKind;                 // from CONFIG.audio.OUTPUT_STRATEGY[platform.info.kind]
  words: readonly string[];                    // words.th.json
}
class AudioEngine { constructor(clock: Clock, platform: Platform, cfg: AudioConfig, deps: AudioEngineDeps); /* spec API */ }

// src/audio/outputs/AudioOutput.ts
type AudioOutputKind = 'webaudio-direct' | 'element-bridge';
interface AudioOutput {
  readonly kind: AudioOutputKind;
  /** Connect the master node to the actual sink. */
  attach(master: AudioNode): void;
  /** Must be called inside a user gesture the first time (element.play()). */
  start(): Promise<void>;
  stop(): void;
}
```

`AudioContextLike` is the minimal structural subset of `BaseAudioContext` the engine uses (`currentTime`, `state`, `resume`, `createGain`, `createBufferSource`, `createBuffer`, `createMediaStreamDestination`, `destination`, `decodeAudioData`). `tests/helpers/FakeAudioContext.ts` implements it, driven by FakeClock and recording every `start(when)`/`stop(when)`/ramp call so tests can assert the pre-scheduled timeline.

---

## 5. M0: Platform spike, detailed task breakdown

M0's goal is to answer **"can we keep sound going, control brightness and control screen sleep on real iOS and Android, as PWA and as Capacitor?"** and to leave behind production-grade platform code rather than throwaway code.

**Who does what.** The implementer has no device or simulator. The implementer completes part **A** and hands off. A human with devices completes part **B**. M0's spec acceptance criteria are all device criteria, so **M0 is formally closed only when `docs/m0-findings.md` is filled in and signed off.** The implementer may begin M1 after A is done, because §1.8's output abstraction keeps M1 independent of the B outcome. Tell the product owner explicitly that M0 is "sandbox-complete, awaiting device QA".

### 5.A Buildable and verifiable in the sandbox (implementer)

Work in order and commit after each numbered step (small commits make device bisection possible later).

1. **Repo bootstrap.** `.gitignore`, `.editorconfig`, `.nvmrc` (`22`), `package.json` (§3.1–3.2), `npm install`, commit the lockfile.
2. **TypeScript, Vite and HTML.** tsconfigs (§3.3). `vite.config.ts` (§3.4, multi-page plus the CSP plugin). `index.html` and `spike.html` with `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">`, `<meta name="theme-color" content="#0B0806">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=black-translucent`, and `<link rel="manifest">`. `public/manifest.webmanifest` with placeholder icons (a solid `#0B0806` square with an amber dot, generated as PNGs at 192 and 512 px).
3. **Lint and format.** `eslint.config.ts` and Prettier (§3.5). Add one deliberately-violating snippet to a scratch file to confirm each guard rule fires, then delete it.
4. **Core config and types.** `src/core/config.ts` (the spec's §13 values plus the §1.5 additions, `Config` interface, `makeConfig`, `deepFreeze`) and `src/core/types.ts`. Tests: `makeConfig` deep-merges without mutating `CONFIG`; `CONFIG` is frozen; spot-check that every spec §13 value is present and equal.
5. **Clock.** `src/core/clock.ts` and `src/core/time.ts`. Tests (`tests/unit/core/clock.test.ts`) must cover:
   - firing order when due times tie (creation order);
   - `now()` inside a callback equals the due time;
   - timers scheduled inside callbacks within the advance window;
   - interval cadence with no drift over 1,000 iterations;
   - clearing inside a callback, including an interval clearing itself;
   - `jump()` then `flush()` firing overdue timers with `now()` at the jumped time;
   - `advanceTo` with a past time throws;
   - `localHour` under `TZ=Asia/Bangkok`.
6. **Rng.** `src/core/rng.ts`. Tests: seeded determinism (same seed gives the same first 100 values); range `[0,1)` over 10⁵ draws; `pickNoRepeat` never returns a recent index while an alternative exists.
7. **EventBus.** `src/core/events.ts`. Tests: typed emit and subscribe; unsubscribe during dispatch doesn't skip the other listeners; `once`; error isolation and `onError`; `listenerCount`.
8. **Platform.** `Platform.ts`, `web.ts`, `capacitor.ts`, `index.ts` (§4.4).
   - `tests/unit/platform/web.test.ts` (jsdom): stub `navigator.wakeLock` (sentinel with a `release` event), `navigator.mediaSession` and `navigator.audioSession`. Assert re-acquire on visible when wanted; no re-acquire after `release()`; `activate` sets `audioSession.type='playback'` when present and doesn't throw when absent; `brightness.supported === false`.
   - `tests/unit/platform/capacitor.test.ts`: `vi.mock` `@capacitor/core` (`Capacitor.getPlatform` returning `'ios'` and `'android'` in turn), `@capacitor/app`, and the three plugins. Assert: iOS captures the original brightness on the first `set` and restores that exact value; Android restores with `-1`; background triggers restore and active re-applies the target; `restore()` twice makes one plugin call; `dispose()` calls restore, `allowSleep` and `setPlaybackState('none')` (Android); remote play/pause/stop forward to `onRemoteCommand`.
   - `tests/unit/platform/index.test.ts`: selection logic, including the `?platform=web` override.
   - `tests/helpers/FakePlatform.ts`.
9. **Audio DSP (M1 reuses this).** `src/audio/dsp/brownNoise.ts`: `renderBrownNoise(sampleRate, seconds, rng, crossfadeS = 1): Float32Array`, seamlessly loopable, peak normalized to −6 dBFS, DC-blocked. `src/audio/dsp/wav.ts`: `encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer`. Tests:
   - output length;
   - peak ≤ 0.5012 (−6 dBFS);
   - |mean| < 0.01 (no DC);
   - seam continuity: `|x[N-1] − x[0]|` is not larger than the 99th percentile of adjacent-sample differences;
   - WAV header fields (RIFF sizes, format 1, channels 1, sample rate) and a round-trip decode of the sample data.
10. **Spike audio assets.** `scripts/gen-spike-audio.mjs` (Node, no dependencies, seeded) writes and **commits**:
    - `public/audio/spike/rain-test.wav`: 20 s mono 22,050 Hz 16-bit. Pink-ish noise (a sum of 3 one-pole-filtered noises), slow amplitude modulation, and a 1 s crossfaded seam.
    - `public/audio/spike/marker.wav`: 0.35 s, a 660 Hz sine with a 5 ms attack and 300 ms exponential decay, at −12 dBFS. This is the audible "still alive" chime.
11. **Spike page** (`spike.html` → `src/spike/main.ts` → `SpikeApp.vue`). Specification in §5.C. Uses `createPlatform({ log })`, the same Platform code production will use. Raw timers are allowed in `src/spike/**` (lint exemption), but it should still use `RealClock` where convenient.
12. **Minimal app shell.** `src/main.ts` calls `bootstrap()` (creates clock, rng, bus and platform), mounts `App.vue`, and provides services. `App.vue` shows a placeholder Home: `บึงหิ่งห้อย` in amber on `#0B0806`, 18 px or larger, plus a small link "Platform spike →" to `./spike.html` shown when `import.meta.env.DEV || import.meta.env.VITE_INCLUDE_SPIKE === '1'` (set `VITE_INCLUDE_SPIKE=1` in `.env` for M0 so device builds include it). `src/ui/theme.css` defines the spec §14 tokens as CSS custom properties.
13. **Capacitor config.** `capacitor.config.ts`: `appId: 'app.fireflypond.dev'`, `appName: 'Firefly Pond'`, `webDir: 'dist'`, `backgroundColor: '#0B0806'`, `ios: { contentInset: 'never' }`.
14. **Native projects.** Run `npm run build && npx cap add android && npx cap add ios && npx cap sync`.
    - `cap add android` works on Linux without an SDK.
    - `cap add ios` should work on Linux with Capacitor 8's Swift Package Manager default. **If it fails on Linux, do not fight it**: record the exact error in `docs/device-testing.md` and move the iOS patch steps below into the human's checklist.
    - **iOS patch:** in `ios/App/App/Info.plist`, add `<key>UIBackgroundModes</key><array><string>audio</string></array>`. In `ios/App/App/AppDelegate.swift`, add `import AVFoundation`, and in `application(_:didFinishLaunchingWithOptions:)` add `do { try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: []) } catch { print("AVAudioSession category error: \(error)") }`.
    - **Android patch:** in `android/app/src/main/AndroidManifest.xml`, add `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />` (required on Android 14 for a `mediaPlayback` foreground service; the plugin's manifest declares only `FOREGROUND_SERVICE`). Do not add `POST_NOTIFICATIONS`.
    - **Guard test** `tests/unit/native/native-config.test.ts`: read `Info.plist` and `AndroidManifest.xml` as text and assert that the patched entries exist. Skip with a clear message if `ios/` is absent. This stops a future `cap add` regeneration from silently dropping them.
    - Optional, time-boxed to 30 minutes: if a JDK 21 and Android SDK can be installed in the container, run `cd android && ./gradlew assembleDebug` to prove the manifest merge and plugins compile. Skip without guilt if the time runs out.
15. **E2E smoke** (`tests/e2e/smoke.spec.ts`, mobile-chromium):
    - `/` renders the Thai title and has no console errors.
    - `/spike.html` renders. Clicking "Unlock audio" makes the context-state readout show `running`. Clicking "Start preset" leaves no error in the log panel. The brightness panel shows "unsupported (web)". The wake-lock panel shows a status string without throwing (headless Chromium may deny the lock, which is fine).
    - Log persistence: add an entry, reload, and the entry is still there.
16. **CI.** `.github/workflows/ci.yml` on push and PR: `npm ci`, `npm run verify`, `npx playwright install --with-deps chromium`, `npm run test:e2e -- --project=mobile-chromium`.
17. **Docs for the human.**
    - `docs/device-testing.md`: prerequisites; how to produce each of the four builds (§5.B.1); how to read and export the spike log; a reusable per-milestone device checklist (spec §16: audio while locked, brightness, battery per 60 minutes of listen, device temperature).
    - `docs/m0-findings.md`: a **template** with device and build metadata fields, every result table from §5.B pre-drawn with empty cells, the decision rubric (§5.D), and `Decision: PENDING (device QA)`.

**Definition of done for 5.A** (all must pass in the sandbox):
`npm run verify` is green · `npm run test:e2e -- --project=mobile-chromium` is green · `npx cap sync` succeeds · coverage of `src/core/**` is at least 90% lines · native-config guard test passes (or is skipped with a documented reason for iOS) · both docs exist · no `Date.now`, `setTimeout` or `Math.random` outside the allowed files (enforced by lint).

### 5.B Requires a human with real iOS and Android hardware

#### 5.B.1 Setup: the four build variants

| Variant | How |
|---|---|
| **iOS PWA** | `npm run build && npm run preview`, then expose it over HTTPS (wake lock and audioSession require a secure context): `npx cloudflared tunnel --url http://localhost:4173` (no account needed), or deploy `dist/` to any static HTTPS host. Open in Safari, then Share → Add to Home Screen, then launch from the home screen icon. **Test the home-screen app, not the Safari tab.** |
| **iOS Capacitor** | On a Mac with current Xcode: `npm ci && npm run cap:sync && npm run cap:ios`. Set a signing team and run on the device. If `ios/` wasn't generated in the sandbox, first run `npx cap add ios` and apply the §5.A step 14 iOS patch. |
| **Android PWA** | Same HTTPS URL in Chrome, then ⋮ → Add to Home screen / Install app, then launch from the icon. |
| **Android Capacitor** | Android Studio with JDK 21: `npm ci && npm run cap:sync && npm run cap:android`, then run on a USB-debugging device. |

Record for each device: model, OS version, WebView/Safari version (shown on the spike page), and the build ID (shown on the spike page).

**Device preconditions for every audio test:**
- battery ≥ 60% and **unplugged**;
- Low Power Mode / Battery Saver **off** (run one extra A1 with it **on** for the winning strategy);
- media volume 50%, no headphones (repeat once with Bluetooth headphones if available);
- iOS: silent switch **on** (verifies that `.playback` ignores it);
- **Auto-Lock / Screen timeout = 30 seconds**;
- Do Not Disturb on, so notifications don't confound the test.

#### 5.B.2 Test procedures

Run **A1–A5 for each of the four variants**. Run A1 for each audio strategy in the order `webaudio-direct` → `element-bridge` → `element-files` (baseline). When a strategy passes A1 on a variant, run A2–A5 with that strategy.

- **A1: 30-minute locked playback (the acceptance test).**
  1. Open the spike page and tap **Unlock audio**.
  2. Choose a strategy. Enable **brown noise (buffer)**, **rain loop** and **marker chime every 60 s**. Turn on **MediaSession** and **Activate background audio**. Leave **Wake lock** released.
  3. Tap **Play**. Note the wall-clock start. Press the power button to lock. Put the phone face down.
  4. Check by ear at 5, 15, 30 and 35 minutes. The chime should sound once a minute.
  5. At 35 minutes, unlock and open the app. Read the **Continuity report** (audio-thread time versus wall time while hidden, plus the JS heartbeat's largest gap). Tap **Export log**.
  6. Record: pass/fail, the minute audio stopped (if it did), continuity %, largest JS gap, the AudioContext state history, and whether lock-screen now-playing controls appeared.
- **A2: ramp while locked.** Tap **Fade to silence over 10 min** and lock immediately. Record whether the audio audibly fades and is silent by about 10–11 minutes, and whether it stopped abruptly instead. For `element-files`, also record the **"element.volume settable?"** readout (expected: `no` on iOS).
- **A3: pre-scheduled events while locked.** Tap **Schedule blips (every 10 s for 45 min)** with the bed layers muted, then lock. Record whether blips continue at 10, 20 and 40 minutes. This validates the listen-mode pre-scheduling design in §1.8.
- **A4: app switch.** While playing, go to the home screen and open another app for 2 minutes. Record whether audio continued, then return and record whether the state is consistent.
- **A5: interruption (optional but valuable).** While locked and playing, trigger an alarm or have someone call. After it ends, record whether audio resumed by itself, resumed after unlocking, or stayed dead, and the AudioContext states logged (`interrupted`/`suspended`).
- **A6: battery and heat (one run per OS, winning strategy, Capacitor build).** Run a 60-minute locked playback. Record battery % start and end, and whether the device is subjectively warm or hot.
- **B1: brightness (Capacitor variants only).**
  1. Set system brightness to about 60% and note the value shown by **Read brightness**.
  2. Tap **Set min (0.02)**. The screen should dim visibly. Record the read-back value.
  3. Tap **Restore**. It should return to about 60%. Record the value.
  4. Tap **Set min** and press Home (app to background). Record the system brightness outside the app. Expected: restored.
  5. Return to the app. Record whether min was re-applied.
  6. Tap **Set min**, then swipe-kill the app from the app switcher. Record the brightness afterwards. On iOS, the expected risk is that it stays dim; record it honestly.
  7. Repeat step 2 with the slider at 0.0 and record whether the screen becomes unreadably dark. This feeds the `BRIGHTNESS_MIN` choice.
- **B2: brightness on PWA variants.** Confirm the page reports "unsupported". Nothing else.
- **C1: wake lock (all four variants).** With a 30 s auto-lock:
  1. Tap **Acquire**, leave the device untouched for 2 minutes, and record whether the screen stayed on.
  2. Tap **Release**, then record whether the screen locked within about 40 s.
  3. Acquire again, background the app for 10 s, return, and record whether the status says re-acquired.

#### 5.B.3 What goes in `docs/m0-findings.md`

- A **device matrix** (device, OS, browser/WebView version, build ID, date, tester).
- **Result tables:** A1 (variant × strategy), A2–A6 (variant), B1 (iOS/Android), C1 (variant). Each cell holds pass/fail/n.a. plus the key number, such as the minute audio stopped, continuity %, or brightness values.
- **Attached logs:** paste the exported spike log for every failed cell and for one passed cell per variant (collapsible `<details>` blocks).
- **Decisions** (per §5.D): PWA-only or Capacitor-first; `OUTPUT_STRATEGY` per platform; whether iOS needs a native audio plugin; `BRIGHTNESS_MIN` confirmed or changed; any iOS brightness-after-kill mitigation needed.
- **Surprises and follow-ups** as free text.

### 5.C Spike page specification (`spike.html`)

Plain, dark and warm (`#0B0806` background, `#C98A3E` text, buttons at least 48 px tall, 18 px minimum text). English labels are fine because this page is for testers. Sections top to bottom:

1. **Header / info.** Build ID; `platform.info` (kind, isNative, isStandalonePwa); user agent; each capability's `supported`/`mode`; `navigator.audioSession` present (y/n); `mediaSession` present (y/n); `document.visibilityState`.
2. **Audio lab** (`audioLab.ts`):
   - **Unlock audio** button: creates `AudioContext({latencyHint:'playback'})`, runs `resume()`, and starts a silent buffer. This must happen inside the tap handler.
   - **Strategy** radio buttons: `webaudio-direct` | `element-bridge` | `element-files (baseline)`.
   - **Layers** checkboxes: brown noise (`buffer` | `worklet` sub-choice), rain loop (`rain-test.wav`), marker chime every 60 s (Web Audio strategies: scheduled on the audio thread for the next 60 minutes; element-files: a separate `<audio>` retriggered by `setInterval`, deliberately JS-dependent so the difference shows up).
   - **Toggles:** MediaSession metadata on/off; `audioSession.type='playback'` on/off; **Activate background audio** (`platform.backgroundAudio.activate/deactivate`).
   - **Play** / **Stop**; master volume slider.
   - **Fade to silence over [1 | 10 | 30] min**: `master.gain.linearRampToValueAtTime`, or `element.volume` stepping for element-files, which logs whether `volume` reads back what was set.
   - **Schedule blips (every 10 s for 45 min)**: pre-schedules about 270 short oscillator or marker starts on the audio thread.
   - **Live readout** (refreshes about every 500 ms while visible): `ctx.state`, `ctx.currentTime`, element `paused`/`currentTime`, current strategy.
3. **Continuity monitor.** On `hidden`, store `{wall: Date.now(), ctxTime: ctx.currentTime}`. On `visible`, show `hiddenFor`, `audioAdvanced`, and `continuity% = audioAdvanced / hiddenFor`, and log them.
4. **JS heartbeat** (`heartbeat.ts`). Every 5 s, write `Date.now()` to `localStorage['spike.hb']`. On `visible`, compute the largest gap since hidden from the stored history (keep the last 1,000 beats) and show "JS ran while hidden: yes (max gap X s) / no". This shows whether timers run in the background, which decides how much we rely on `reconcile()`.
5. **Brightness panel.** `supported` flag; **Read brightness**; slider 0–1 with **Apply**; **Set min (`CONFIG.pacing.BRIGHTNESS_MIN`)**; **Set 0.5**; **Restore**; **Auto test** (set min, wait 10 s, restore, logging each step and read-back).
6. **Wake-lock panel.** `supported`; `held` live; **Acquire** / **Release**; a note reminding testers to set the OS auto-lock to 30 s.
7. **Lifecycle and event log** (`diagLog.ts`). A ring buffer (last 500 entries) persisted to `localStorage['spike.log']`, so it survives an app kill. Each entry is `HH:MM:SS.mmm [source] message`. Sources: `lifecycle` (platform onChange, visibilitychange, pagehide/pageshow, freeze/resume), `ctx` (statechange including `interrupted`), `element` (play, pause, stalled, suspend, waiting, ended, error), `mediaSession` (remote actions), `wakeLock` (sentinel release), `platform` (the `log` option), `brightness`, `hb`.
   - Buttons: **Copy log** (clipboard), **Export log** (downloads `spike-log-<buildId>-<timestamp>.txt` through a Blob URL; if downloads are blocked in the WebView, fall back to showing the text in a selectable `<textarea>` for manual copy), **Clear log**. No network.
8. **Start preset** button. One tap applies the A1 configuration for the currently selected strategy: brown noise (buffer), rain, markers, MediaSession on, audioSession playback on, background audio activated, wake lock released, then Play. This reduces tester error.

### 5.D Decision rubric (goes into `m0-findings.md`)

- **Capacitor-first** (expected) if **any** of these hold: iOS PWA A1 fails for every strategy; Android PWA A1 fails; or the product owner keeps M1's "minimum brightness" requirement, which a PWA cannot meet because web has no brightness API. Under Capacitor-first, the PWA remains a dev and preview target with no store-quality guarantees.
- **PWA-only** only if A1, A2 and A3 pass on **both** PWA variants **and** the product owner formally accepts overlay-only dimming in place of native brightness.
- **`OUTPUT_STRATEGY` per platform:** the first of `webaudio-direct`, then `element-bridge`, that passes A1, A2 and A3 on that platform's chosen build variant.
- **iOS native audio plugin needed** if neither Web Audio strategy passes A1 and A3 on iOS Capacitor. Adopt `@capgo/capacitor-native-audio` for bed layers, which triggers an M1 re-plan. Do not start M1's AudioEngine output code until that re-plan exists.
- **`BRIGHTNESS_MIN`:** keep 0.02 unless B1 step 7 shows 0.02 is indistinguishable from 0.0 (lower is fine) or unreadable when the listen controls appear (raise it).
- **iOS brightness after kill:** if B1 step 6 shows it stays dim, M1 adds a mitigation: restore on `appStateChange(inactive)` as well as background, and accept kill-from-switcher as a known limitation, documented in Settings help text.

---

## 6. Roadmap notes for M1–M5

These are guardrails, not full plans. Each milestone gets its own planning pass.

### M1: Listen mode
- Build `SessionDirector` with **only** the listen-related rows first (home→listen via `listen_only` and `night_wake`, listen→ended via `listen_timer`/`user_exit`, extend, lifecycle and reconcile). Write the tests for those rows **before** the implementation (spec §0). Add the other rows in M3.
- `AudioEngine` per §1.8 and §4.6: pre-scheduled listen timeline, `FakeAudioContext`-based tests of the timeline (word gaps within `[MIN,MAX]` and ×1.5 in the tail, no repeats within 30, silence in the final `LISTEN_TAIL_MS`, master reaching 0 exactly at the end).
- `src/store/db.ts`: **all five v1 stores**, the migration array, and a **provisional summary** written at listen start with `endReason: 'listen_timer'` and the projected `endedAt`, updated on extend or exit. If JS is frozen at the deadline, the record is already correct.
- `SessionRuntime` implements the §1.9 table for home, listen and ended.
- Listen UI: pure `#000000`, tap reveals dim controls for `LISTEN_CONTROLS_VISIBLE_MS`, layer picker, and 30/60/90 minute options.
- Placeholder voice clips (§2.1 Q3) and a starter `words.th.json` (about 150 words, content-validated by a unit test: unique, non-empty, Thai script only).

### M2: Play core loop
- Split the scene: `scene/model/*` is pure (Clock plus Rng, no Pixi) and holds dream spawning with `NO_REPEAT_WINDOW`, the respawn queue, boats and capacity, star creation, and breath phase. `scene/entities/*` are Pixi views that render model state each frame. **All M2 rules are unit-tested at model level.** Pixi code stays thin.
- `stream.ts` is normalized-coordinate bezier data plus `fitToViewport(w, h)`, with bottom-edge boats in both orientations (§2.1 Q4). Add the runtime portrait lock for phones.
- `PacingController` with `drowsinessScore = 0` (time-only) per M2. Tests cover progress, easing, `spawnIntervalMs`, and dimAlpha continuity across phase changes.
- Content: `dreams.json` (30 items, 10 per color). The content test asserts the counts and that sprites exist under `public/`.
- Start the e2e **luminance test** (spec §14): sample a screenshot grid and assert the relative luminance of every sample is ≤ 0.35. Add a unit test over `theme.css` tokens that asserts no hue falls in 170°–260°.
- 30 fps: `app.ticker.maxFPS`. The performance claim ("mid-range phone") is **[VALIDATE]** on device. Add an FPS readout to the debug overlay now.
- Debug overlay component (`?debug=1`) scaffolded here and filled in during M3.

### M3: Drowsiness, drift and fade
- Write the fixtures (Appendix A) and the estimator and director tests **first**, then the implementation.
- Director: every §5.1 row gets at least one test, plus gentle-exit-shown-once, listen offer, background grace (using `FakeClock.jump`), and `reconcile`.
- 90-minute accelerated simulation test: run the Director and Estimator on each fixture and snapshot `[phase, reason, minute]` paths with `toMatchInlineSnapshot`.
- Fade applies the `FADE_SCREEN_MS` and `FADE_AUDIO_MS` ramps, releases the wake lock, restores then sets brightness per §1.9, and persists the summary. Drift drops to 20 fps.
- Local-only drowsiness sample log per session (in memory, dumped into the debug overlay export), to support the tuning in §2.1 Q2. Not persisted by default.

### M4: Settle, night wake and meta
- Jar: enforce `JAR_MAX_ITEMS` and `JAR_MAX_CHARS`; retention purge on app start through `repositories.purgeOldJars(clock)`. Jar text never enters the export or logs.
- `NightWakeDetector` wired into `start()`. Visitor reveal gated by `isRevealWindow()` and the night-wake flag. Morning survey gated by hours and "had a session last night".
- `moon.ts`: pure phase from date, with tests against known new and full moon dates.
- Onboarding is one question (sleep latency bucket) stored in `settings`.

### M5: Metrics and beta
- The "สถิติของฉัน" (my stats) page is computed from the `sessions` store only.
- Export JSON is opt-in and user-initiated. Add `platform.shareFile(name, text)` to `Platform` (Capacitor: `@capacitor/filesystem` plus `@capacitor/share`; web: Blob download). The export excludes jar contents (enforced by a test). There are still no network calls, and the CSP stays.
- Release hygiene: final `appId`; Thai display name through native localization; icons and splash via `@capacitor/assets`; remove the spike from release builds (`VITE_INCLUDE_SPIKE` unset and a build-time check that `spike.html` is absent from `dist/`); TestFlight and Play internal testing.

### Choices in M0 that deliberately keep later milestones open
- `Platform` capability groups are extensible: M5 adds `shareFile` without touching the existing groups.
- The `AudioOutput` strategy decouples M0's findings from the M1 API.
- Epoch-ms Clock plus `reconcile()` supports listen timers across device sleep (M1) and background grace (M3).
- The DSP functions (brown noise, WAV) built in M0 are reused unchanged in M1.
- The `Rng` injection exists from M0, so M2's spawn logic and M4's visitor chance are testable from day one.

---

## Appendix A: Drowsiness algorithm precision rules and validated fixtures (for M3)

The spec leaves several computation details open, and test outcomes depend on them. Implement exactly this:

1. **Window membership:** tap `t` is in the window when `windowEnd − WINDOW_MS < t ≤ windowEnd`, where `windowEnd = clock.now()` at `tick()`.
2. **ITIs** are the differences between consecutive taps **both inside** the window.
   - `itiMedian` = median of the ITIs (null if there are none).
   - `itiCv` = **population** std ÷ mean of the ITIs (null if there are fewer than 2).
3. **`rtMedian`** = median of `reactionMs` over taps where it is defined (null if there are none). **`missRate`** = count(`hit === false`) ÷ `tapCount`.
4. **Null features contribute 0** to the weighted sum. Weights are **not** renormalized.
5. **`tapCount === 0`:** skip the EMA. `score = max(prevScore, NO_TAP_WINDOW_SCORE)`, and the sample has `raw = NO_TAP_WINDOW_SCORE`.
6. **Baseline:**
   - The window is `[t0, t0 + BASELINE_MS)` from `startBaseline()`. It becomes ready at the first `tick()` where `now ≥ t0 + BASELINE_MS`, and that tick also produces the first sample.
   - Sub-windows are `[t0 + k·BASELINE_SUBWINDOW_MS, …)` for k = 0..3.
   - If the baseline has fewer than `BASELINE_MIN_TAPS` taps, every feature uses `DEFAULT_BASELINE` (`source: 'default'`).
   - Otherwise, for each feature: with 2 or more non-null sub-window values, use their mean and **sample** std (n−1); else use that feature's default (`source: 'mixed'` if any defaults were used).
7. **Scoring:**
   - Before the baseline is ready, `tick()` returns null and `score` stays **0**.
   - The EMA starts from 0.
   - `z_f = (x_f − mean_f) / max(std_f, STD_FLOOR_f)`, clamped to ±`Z_CLAMP`.
   - `raw = 1 / (1 + e^−(Σ w_f z_f − BIAS))`.

**Fixtures** (`tests/fixtures/tapStreams.ts`). Each is a function of `(seed: number)` built on `seededRng` plus Box–Muller gaussians (`tests/helpers/gaussian.ts`).
- ITIs are clamped to ≥ 250 ms and RTs to ≥ 150 ms.
- A tap with `hit=false` has no `reactionMs`.
- **Tests run each fixture for seeds 1–5 and every seed must pass.** No cherry-picking a lucky seed.

| Fixture | Parameters (m = minutes since play start) | Prototype result (Python, same algorithm and spec config) |
|---|---|---|
| `alertSteady` | 25 min. ITI ~ N(2000, 300). RT ~ N(850, 150). **Deterministic** miss on every 12th tap. | max score 0.18–0.27 over 10 seeds; never drifts. **Thin margin to 0.30.** |
| `graduallyDrowsy` | 25 min. k = clamp((m − 6)/14, 0, 1). ITI ~ N(2000+3000k, 350+1300k). RT ~ N(850+1300k, 180+320k). Miss probability 0.08+0.27k (random). | drift at 9.25–10.5 min over 10 seeds (spec: 8–14) |
| `suddenStop` | `alertSteady` until 6:00, then no taps | Last tap ≈ 5:59, so the idle rule reaches fade at ≈ 6:44, before the no-tap window rule could force drift (which would need two ≥ 0.6 samples after 7:00) |
| `noisy` | 25 min. Each ITI 50/50: fast N(1400,150) with RT N(850,200), or slow N(3200,300) with RT N(1100,200). Miss probability 0.10. | max score 0.17–0.42; never drifts |
| `tooFewBaselineTaps` | 10 taps spread over 0–120 s, then `alertSteady` behavior | `baseline.source === 'default'`, no throw, `isBaselineReady === true` after 120 s |

**Test assertion for `noisy`** (the spec's "ไม่สลับ phase ไปมา" / "doesn't flip phases back and forth", made concrete): the phase path is a prefix of `play → drift → fade` with no repeated phase, **and** no `drowsy`-reason drift occurs before `PLAY_MAX_MS`.

If the TypeScript implementation with mulberry32 does not reproduce these outcomes, **do not change config values to make tests pass.** First check the implementation against rules 1–7. If the rules are followed and a fixture still fails, report the numbers to the architect or product owner. That is spec open question 2 surfacing, and it is a product decision.
