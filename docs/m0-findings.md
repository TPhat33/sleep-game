# M0 findings — Platform spike

**Status: template — awaiting device QA.**
**Decision: PENDING (device QA)**

This is the record of M0's device half (plan §5.B). See
`docs/device-testing.md` for how to produce each build and run each test.
M0 is sandbox-complete (§5.A is done — `npm run verify` and the
mobile-chromium e2e project are green, `npx cap sync` succeeds, both native
projects are committed with their patches applied) but **not formally
closed** until this document is filled in and signed off.

---

## Device matrix

| #           | Device model | OS version | Browser / WebView version | Build ID | Date | Tester |
| ----------- | ------------ | ---------- | ------------------------- | -------- | ---- | ------ |
| 1 (iOS)     |              |            |                           |          |      |        |
| 2 (Android) |              |            |                           |          |      |        |

---

## A1 — 30-minute locked playback (device × strategy)

Strategy order: `webaudio-direct` → `element-bridge` → `element-files` (baseline).
Stop once a strategy passes for a given variant; record every strategy you
actually tried, including failed ones.

| Variant           | Strategy | Pass/Fail | Minute stopped | Continuity % | Largest JS gap | Lock-screen controls shown? |
| ----------------- | -------- | --------- | -------------- | ------------ | -------------- | --------------------------- |
| iOS PWA           |          |           |                |              |                |                             |
| iOS Capacitor     |          |           |                |              |                |                             |
| Android PWA       |          |           |                |              |                |                             |
| Android Capacitor |          |           |                |              |                |                             |

<details>
<summary>A1 logs</summary>

Paste the exported spike log for every failed cell and for one passed cell
per variant.

</details>

## A2 — Ramp while locked

| Variant           | Pass/Fail | Notes | element.volume settable? (element-files only) |
| ----------------- | --------- | ----- | --------------------------------------------- |
| iOS PWA           |           |       |                                               |
| iOS Capacitor     |           |       |                                               |
| Android PWA       |           |       |                                               |
| Android Capacitor |           |       |                                               |

## A3 — Pre-scheduled events while locked (blips)

| Variant           | Continued at 10 min? | 20 min? | 40 min? | Notes |
| ----------------- | -------------------- | ------- | ------- | ----- |
| iOS PWA           |                      |         |         |       |
| iOS Capacitor     |                      |         |         |       |
| Android PWA       |                      |         |         |       |
| Android Capacitor |                      |         |         |       |

## A4 — App switch (2 min, then return)

| Variant           | Audio continued? | State consistent on return? | Notes |
| ----------------- | ---------------- | --------------------------- | ----- |
| iOS PWA           |                  |                             |       |
| iOS Capacitor     |                  |                             |       |
| Android PWA       |                  |                             |       |
| Android Capacitor |                  |                             |       |

## A5 — Interruption (optional)

| Variant           | Resumed automatically? | Resumed after unlock? | ctx state history | Notes |
| ----------------- | ---------------------- | --------------------- | ----------------- | ----- |
| iOS PWA           |                        |                       |                   |       |
| iOS Capacitor     |                        |                       |                   |       |
| Android PWA       |                        |                       |                   |       |
| Android Capacitor |                        |                       |                   |       |

## A6 — Battery and heat (one run per OS, winning strategy, Capacitor build)

| OS      | Strategy | Battery start % | Battery end % | Felt warm/hot? |
| ------- | -------- | --------------- | ------------- | -------------- |
| iOS     |          |                 |               |                |
| Android |          |                 |               |                |

## B1 — Brightness (Capacitor only)

| Step                                                    | iOS | Android |
| ------------------------------------------------------- | --- | ------- |
| System brightness before (~60%)                         |     |         |
| Set min (0.02) — read-back                              |     |         |
| Visibly dim?                                            |     |         |
| Restore — read-back (~60%?)                             |     |         |
| Set min, background app — system brightness outside app |     |         |
| Return to app — was min re-applied?                     |     |         |
| Set min, swipe-kill app — brightness afterward          |     |         |
| Set 0.0 — unreadably dark?                              |     |         |

## B2 — Brightness on PWA

| Variant     | Reports unsupported? |
| ----------- | -------------------- |
| iOS PWA     |                      |
| Android PWA |                      |

## C1 — Wake lock (all four variants, 30s auto-lock)

| Variant           | Screen stayed on for 2 min after Acquire? | Locked within ~40s after Release? | Re-acquired shown after background+return? |
| ----------------- | ----------------------------------------- | --------------------------------- | ------------------------------------------ |
| iOS PWA           |                                           |                                   |                                            |
| iOS Capacitor     |                                           |                                   |                                            |
| Android PWA       |                                           |                                   |                                            |
| Android Capacitor |                                           |                                   |                                            |

---

## Decisions (plan §5.D rubric)

- **PWA-only vs Capacitor-first:**
  _(Capacitor-first is the expected default — plan §2.1 Q1 — unless A1/A2 pass
  on both PWA variants **and** the product owner accepts overlay-only dimming
  in place of native brightness.)_
- **`CONFIG.audio.OUTPUT_STRATEGY` per platform** (web / ios / android):
- **Does iOS need a native audio plugin** (`@capgo/capacitor-native-audio`)?
  _(Only if neither Web Audio strategy passes A1 and A3 on iOS Capacitor —
  if so, this triggers an M1 re-plan; do not start M1's AudioEngine output
  code until that re-plan exists.)_
- **`CONFIG.pacing.BRIGHTNESS_MIN`:** keep 0.02, or change to: ______
- **iOS brightness-after-kill mitigation needed?**

## Surprises and follow-ups

_(free text)_
