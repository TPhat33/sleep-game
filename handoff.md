# Handoff — Hushglow

Status snapshot for whoever (human or agent) picks this project up next,
written 2026-09-27 at the end of a cloud Claude Code session. If you're an
agent: read this whole file before touching code, then check
`docs/implementation-plan.md` for the full spec/plan this was built against.

## What this project is

A sleep-onset relaxation game (formerly "Firefly Pond", renamed to
**Hushglow**). TypeScript + Vite + Vue 3 (`<script setup>`) + PixiJS +
Capacitor, IndexedDB via `idb`, Vitest + Playwright. Design pillars: no
visible score/timer during play, dark/warm palette only (spec §14 forbids
hue 170°-260° and luminance > 0.35 anywhere on screen), everything runs
fully offline/local, jar contents (bedtime worries) never leave the device.

Milestones M0–M5 (see `docs/implementation-plan.md`) are all implemented:
onboarding, the settle/jar screen, the pond play loop (PixiJS scene),
listen-only mode, drowsiness estimation + pacing, night-wake handling, sky/
journal/stats screens, settings, opt-in JSON export, and the spec §14
luminance/hue compliance test suite.

## Repo / branch state right now

- Remote: `TPhat33/sleep-game` on GitHub.
- Two branches exist, **both currently identical**, both at commit
  `4d98305` ("Localize game to English and rename to Hushglow"):
  - `claude/opus-design-sonnet-impl-h6jtgt` — the original working branch,
    still the repo's GitHub-configured HEAD/default branch as of this
    writing.
  - `main` — created and pushed this session specifically so there'd be a
    conventionally-named branch to work from. **It is not yet set as the
    GitHub default branch** — nobody has done Settings → Branches →
    Default branch yet (no available tool could do it remotely; it needs a
    human on github.com).
- Working tree is clean, nothing uncommitted.
- `npm run verify` (typecheck + lint + format:check + unit tests + build +
  no-spike check) and the full Playwright e2e suite were green on the head
  commit before this session ended.

If you're starting fresh locally: `git clone`, then `git checkout main`
(or the long branch name — same content), `npm install`, `npm run verify`.

## What just happened (most recent work, in order)

1. M1–M5 implementation completed across ~29 tracked tasks (game logic,
   scene, UI, audio, storage, tests) — all in Thai originally, per the
   original spec.
2. User asked to localize the entire game to English, including renaming
   it. Candidate names were proposed; user picked **Hushglow**.
3. Full localization pass (tasks #30–#35, all completed):
   - Renamed the game everywhere: `capacitor.config.ts` (`appId` is now
     `app.hushglow.dev` — **still a placeholder**, see below),
     `package.json`, `index.html`, PWA manifest, spike page, IndexedDB
     name/type (`DB_NAME` / `HushglowDB` in `src/store/db.ts`), the
     `NOW_PLAYING_META` title in `SessionRuntime.ts`, the Vite CSP plugin
     name.
   - Dropped Thai-specific naming/markers now that the game is
     single-language: `DreamDef`/`ConstellationDef`/`VisitorDef.nameTh` →
     `.name`; `src/content/words.th.json` → `src/content/words.json`;
     `public/voice/th/*.wav` → `public/voice/*.wav` (flattened, no
     language subfolder); `voiceWordUrl()` in `src/audio/layers.ts`
     updated to match; `--font-thai` CSS var → `--font-primary` (font
     value changed to `'IBM Plex Sans'` — no font files were ever actually
     self-hosted, so this is a preference change with no real asset
     impact).
   - Translated all content JSON (`dreams.json` 30 items,
     `constellations.json` 6 items, `visitors.json` 8 items, `words.json`
     150 concrete nouns) from Thai to English.
   - Translated every Vue screen/component: Onboarding, Home, Settle,
     Pond, Listen, Sky, Journal, Settings, MorningSurvey, Stats,
     GentleExitPrompt.
   - Updated every unit test and e2e test (`tests/e2e/session.spec.ts`,
     `tests/e2e/luminance.spec.ts`, `tests/e2e/smoke.spec.ts`, plus several
     `tests/unit/**`) to match the new English strings/selectors.
   - Verified: `tsc --noEmit`, `eslint .`, `vitest run` (314/314), and
     `playwright test --project=mobile-chromium` (24/24) all green. The
     `mobile-webkit` Playwright project could not run in the cloud sandbox
     (no WebKit browser binary installed there — an environment
     limitation, not a code issue); worth re-running on a machine that has
     it.
   - Swept the whole `src/` and `tests/` trees for leftover Thai text —
     only developer-facing code comments quoting the original Thai spec
     remain (e.g. in `src/core/config.ts`, `src/scene/stream.ts`,
     `src/core/sessionStats.ts`), which is intentional: they're not
     user-facing and document *why* a constant has the value it has.
4. Committed as `4d98305`, pushed to `claude/opus-design-sonnet-impl-h6jtgt`.
5. User asked to "merge into main". Repo had **no `main` branch at all**
   (the only branch was `claude/opus-design-sonnet-impl-h6jtgt`, which was
   also GitHub's configured default/HEAD branch). Created `main` from that
   branch's tip and pushed it — so right now there's nothing to actually
   merge, `main` and the working branch are the same commit.

## What's left

Nothing is blocked on more engineering in a sandbox — everything below
needs either a human decision, a physical device, a developer account, or
commissioned art:

1. **Set `main` as the GitHub default branch.** Settings → Branches →
   Default branch, on github.com. No tool available in the cloud session
   could do this remotely.
2. **Decide whether to keep both branches or delete
   `claude/opus-design-sonnet-impl-h6jtgt`** once `main` is default and
   confirmed working — they're identical right now, so this is just
   housekeeping.
3. **Final `appId`.** `capacitor.config.ts` has `app.hushglow.dev` — this
   was picked to match the new name but **has not been confirmed as the
   real reverse-domain id** to ship with. Changing it after real users
   install a build is not possible, so get sign-off before any store
   upload.
4. **`npx cap sync` + real native build.** `android/app/src/main/assets/public/*`
   and `ios/App/App/public/*` are stale copies from the very first M0 sync
   — they predate all M1–M5 content and the Hushglow rename. They need a
   fresh `npx cap sync` and a real Xcode/Android Studio build to verify;
   this sandbox has neither toolchain.
5. **Real icon/splash art.** Current icons (`public/icons/icon-{192,512}.png`)
   are M0 placeholders (solid dark square + amber dot). Once real
   1024×1024 source art exists, run `npx capacitor-assets generate`, then
   `npx cap sync` again.
6. **Real audio content.** Bed-layer sounds and the 150 whispered-word
   voice clips (`public/voice/*.wav`) are currently generator-produced
   placeholders (`scripts/gen-placeholder-audio.mjs`), not recorded/mixed
   final audio.
7. **Real dream sprite art.** `src/content/dreams.json` references sprite
   paths (`/dreams/<id>.svg`) — check what's actually in `public/dreams/`
   before assuming these are final art vs. placeholders.
8. **TestFlight / Play Store submission.** Needs Apple Developer / Google
   Play Console accounts and signing — see `docs/device-testing.md` for
   the manual QA pass to run against each build before submitting.
9. **`docs/release-checklist.md` is stale** — it still says "Thai display
   name via native localization" and references the old `ส่งออกข้อมูล`
   button text and `app.fireflypond.dev` placeholder id. Worth a pass to
   bring it in line with the English-only Hushglow state (or just fold
   its still-relevant points into this file and delete it) once appId is
   finalized.

## Where to look for more detail

- `docs/implementation-plan.md` — the original milestone-by-milestone
  spec/plan (in Thai + English mixed) everything was built against.
- `docs/release-checklist.md` — pre-localization release notes (see
  staleness note above).
- `docs/device-testing.md` — manual QA script for real-device testing.
- `docs/m0-findings.md` — platform spike findings from early on.
