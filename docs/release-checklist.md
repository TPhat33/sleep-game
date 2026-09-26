# Release checklist (M5)

What's done in code, and what's left for a human before an actual store
submission. Spec §12 M5 / plan §6 M5.

## Done

- **Spike excluded from release builds.** `npm run build` (VITE_INCLUDE_SPIKE
  unset) never bundles `spike.html` or its assets. `npm run check:no-spike`
  fails the build if that regresses; wired into `npm run verify`. Set
  `VITE_INCLUDE_SPIKE=1` only for an internal/QA build that needs the M0
  diagnostic page (e2e's Playwright config does this, since
  `tests/e2e/smoke.spec.ts` still exercises it).
- **"สถิติของฉัน" (my stats) page** — `src/ui/screens/Stats.vue`, computed
  from the `sessions` store only via `src/core/sessionStats.ts`.
- **Opt-in JSON export** — `Settings.vue`'s "ส่งออกข้อมูล" button, gated
  behind the `analyticsOptIn` toggle. `src/store/exportData.ts` builds the
  payload (settings + progress + sessions only — the `jar` store is never
  touched, enforced by both a unit test and an e2e test). Delivered via
  `Platform.shareFile()`: a Blob download on web, the native share sheet
  (`@capacitor/filesystem` + `@capacitor/share`) on iOS/Android. No network
  call either way — spec §0 still holds.
- **Placeholder icons** (M0) — `public/icons/icon-{192,512}.png`, a solid
  `#0B0806` square with an amber dot (`scripts/gen-icons.mjs`).

## Left for a human (product-owner or store-submission steps)

None of these block further engineering work; they're either real design
assets nobody has produced yet, or steps that need an Apple/Google
developer account this environment doesn't have.

1. **Final `appId`.** `capacitor.config.ts` still has the M0 placeholder
   `app.fireflypond.dev`. Needs the product owner's real reverse-domain id
   before any store upload — changing it after real users have installed
   the placeholder id is not possible, so get this right first.
2. **Thai display name via native localization.** The spec's Thai title
   (บึงหิ่งห้อย) needs `strings.xml` (Android) / `InfoPlist.strings` (iOS)
   entries, not just `capacitor.config.ts`'s `appName`. Requires editing
   the generated native projects directly — do this together with step 3
   below, in one native-project pass, rather than separately.
3. **Real icon/splash art via `@capacitor/assets`.** The placeholder PNG
   from M0 is a functional stand-in, not app-store-ready art. Once real
   1024×1024 source art exists, run `npx capacitor-assets generate` to
   populate every iOS/Android resolution, then `npx cap sync`.
4. **`npx cap sync`** after steps 2-3 (and after this milestone's
   `@capacitor/filesystem`/`@capacitor/share` additions, if the native
   projects haven't picked them up yet) — regenerates native project
   files from `capacitor.config.ts` and installed plugins. Needs Xcode
   (iOS) / Android Studio (Android) to verify the native build still
   compiles; this environment has neither, so treat it like M0's device
   testing — build and smoke-test on a real machine before trusting it.
5. **TestFlight + Play internal testing builds.** Needs Apple
   Developer/Google Play Console accounts, signing certificates, and an
   actual device or simulator/emulator run — see `docs/device-testing.md`
   for the manual QA pass to run against each build.
