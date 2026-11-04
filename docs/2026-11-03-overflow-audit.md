# Dependency and accessibility audit, 2026-11-03

Branch `overflow/lampcircleaudit`, cut from `origin/main` at `dcc21c5`. Written by an unattended overflow run. Nothing here was merged, deployed or released.

## Bottom line

- **npm:** 5 of the 7 advisories are fixed with in-range upgrades, including the one critical (`shell-quote`). The 2 left (vite and its esbuild) need vite 6, a major version. Do that next: `vite.config.ts` sets `server.host: true`, so the dev server is open to the whole local network.
- **Rust:** rustls moved from 0.23.45 to 0.23.46, a patch, which clears its 4 advisories. The `zip` advisories need a major bump. The `glib` one only applies to Linux builds.
- **Accessibility:** 13 fixes, all small, all invisible except one pill color in Sets. The open items are design calls, listed below with suggested fixes.
- **Checks:** every check that passed before still passes. See the table below.

## Checks, before and after

These are the repo's own checks, from `README.md` and `docs/mac-app.md`. There is no separate lint script. `npm run build` runs `tsc`, which is the type check.

| Check | Before (`dcc21c5`) | After (this branch) |
|---|---|---|
| `npm test` | pass, 425 checks | pass, 425 checks |
| `npm run build` (tsc + vite) | pass | pass |
| `npm run e2e` | pass, 237 checks | pass, 237 checks (after the deps commit and again after the a11y commit) |
| `cd feedback-relay && npm test` | pass, 21 tests | pass, 21 tests (no changes there) |
| `cd src-tauri && cargo test` | pass, 25 tests | pass, 25 tests (with rustls 0.23.46) |
| `cd src-tauri && cargo clippy` | clean, no warnings | clean, no warnings |
| `npm audit` | 7 (1 critical, 3 high, 3 moderate) | 2 (1 high, 1 moderate) |

e2e ran on its own ports (`E2E_WEB_PORT=43977 E2E_HELPER_PORT=3977`) so it couldn't collide with another session. The screenshots it rewrites in `docs/v2/screens/` were restored afterward and are not part of this branch.

## Dependencies

### npm advisories

| Package | Severity | Advisory | How it gets in | Status |
|---|---|---|---|---|
| shell-quote 1.10.0 | critical | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) `quote()` injection | concurrently (`npm run dev` only) | **Fixed**: 1.12.0 |
| body-parser 1.20.8 | high | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) DoS via compressed body | express, in `server/index.js` (binds 127.0.0.1) | **Fixed**: 1.20.9 |
| source-map-js 1.2.1 | high | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) event-loop DoS | postcss (build time) | **Fixed**: 1.2.2 |
| qs 6.16.0 | moderate | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) `stringify` DoS | express | **Fixed**: 6.16.2 |
| postcss-selector-parser 6.1.4 | moderate | [GHSA-rj75-hqrm-r3gf](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) quadratic parsing | tailwindcss (build time) | **Fixed**: 6.1.5 |
| vite 5.4.21 | high | 8 advisories: [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) files outside `fs.allow`, [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) path traversal, [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) cross-origin script, plus 4 in launch-editor and a Windows-only `fs.deny` bypass | direct (dev server) | **Open**: needs vite 6.4.5 |
| esbuild 0.21.5 | moderate | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) any site can read dev server responses | vite | **Open**: goes away with vite 6 |

The vite and esbuild advisories only touch the dev server, not the built app or the Mac app. They still matter here because `vite.config.ts` sets `host: true`: `npm run dev` listens on every network interface, so anyone on the same Wi-Fi (a church network, say) can reach it. The smallest fix is `vite@^6.4.5`. `@vitejs/plugin-react` 4.7.0 already supports vite 6. **Tried, not committed:** with vite 6.4.5 installed over this branch (`npm install --no-save vite@6.4.5`), `npm run build`, `npm test` (425) and `npm run e2e` (237) all passed with no config changes. Making it real is `npm install -D vite@^6.4.5` plus a look at the Mac app's `npm run tauri dev`, which this run didn't try. Until then, `host: true` could become an opt-in (for example `host: process.env.LAN === '1'`), if tablets on the LAN aren't needed every time.

### Upgrades applied (patch and minor only)

| Package | From | To | Kind |
|---|---|---|---|
| @sentry/browser | 10.74.0 | 10.78.0 | minor (exact pin kept). Loaded only when crash reports are on and the build has a DSN (`src/lib/crashReporting.ts`) |
| autoprefixer | 10.6.1 | 10.6.2 | patch (exact pin kept) |
| postcss | 8.5.28 | 8.5.32 | patch (exact pin kept) |
| tailwindcss | 3.4.17 | 3.4.19 | patch (exact pin kept) |
| idb | 8.0.3 | 8.0.4 | patch (lockfile only, the range is `^8.0.0`) |
| shell-quote, qs, body-parser, source-map-js, postcss-selector-parser | | | transitive, from `npm audit fix` |
| nanoid | 3.3.19 | 3.3.20 | transitive, came with postcss |

The built CSS was byte for byte the same before and after these upgrades (same hash, `index-BG55bRcZ.css`).

### Left alone on purpose

| Package | Now | Latest | Why not |
|---|---|---|---|
| vite | 5.4.21 | 8.3.5 (6.4.5 fixes the advisories) | Major. See above: do 6.4.5 next. |
| @tauri-apps/api, @tauri-apps/cli | 2.12.4 | 2.12.4 | Already latest. They must match the Rust `tauri` crate. |
| lucide-react | 0.447.0 | 1.67.0 (0.577.0 in 0.x) | Each 0.x minor can rename icons, and `^0.447.0` already blocks them. |
| react, react-dom, @types/react* | 18.3 | 19.3 | Major. |
| express | 4.22.3 | 5.3.0 | Major. 4.22.3 is the latest 4.x. |
| concurrently | 8.2.2 | 10.0.6 | Major. The shell-quote fix landed without it. |
| tailwindcss | 3.4.19 | 4.3.4 | Major. Config format changes. |
| typescript | 5.9.3 | 7.0.2 | Major. 5.9.3 is the latest 5.x. |
| @vitejs/plugin-react | 4.7.0 | 6.2.1 | Major. 4.7.0 is fine through vite 7. |
| @sentry/browser | 10.78.0 | 11.10.0 | Major. |
| yaml | 2.9.1 | 2.9.1 | Already latest. |

`feedback-relay/` has no npm dependencies.

### Rust (`src-tauri/Cargo.lock`)

There's no `cargo audit` on this machine, so the 571 locked crates were checked against GitHub's advisory database with read-only `gh api` GET requests.

| Crate | Locked | Advisories | How it gets in | Status |
|---|---|---|---|---|
| rustls | 0.23.45 | [GHSA-c8m5-c952-6cm4](https://github.com/advisories/GHSA-c8m5-c952-6cm4) (medium) plus 3 low ones | reqwest (feedback, updates, analytics) | **Fixed**: 0.23.46, a one-crate lockfile change |
| zip | 4.6.1 | [GHSA-m665-v7pm-7grj](https://github.com/advisories/GHSA-m665-v7pm-7grj) (critical), [GHSA-q7v9-x93c-xqv3](https://github.com/advisories/GHSA-q7v9-x93c-xqv3) (high), [GHSA-8hxf-qr8p-62x4](https://github.com/advisories/GHSA-8hxf-qr8p-62x4) (medium) | direct (`zip = "4"`), and tauri-plugin-updater 2.11.0 | **Open.** All 3 are about reading archives. The app's own code only writes zips (`diagnostics.rs`). The updater on macOS unpacks a signed `.tar.gz`. Low real risk. Fixing it means `zip = "9"` in `Cargo.toml` plus tauri-plugin-updater 2.14.1, which uses zip 9.3. |
| glib | 0.18.5 | [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g) (medium) | gtk, Linux targets only | **Not reachable.** The app ships for macOS and iOS. |

A full `cargo update` would move 123 crates, including tauri-plugin-dialog 2.7.3 to 2.8.4 and tauri-plugin-updater 2.11.0 to 2.14.1. It wasn't done here, because the iOS app and signed release builds can't be checked unattended, and the dialog plugin's behavior is a known trap (see the `ask` and `askText` notes in `src/ui.tsx`). It's worth doing in a session that can build and try both apps.

## Accessibility

The app was already in good shape. Icon buttons carry `aria-label`s, decorative icons are `aria-hidden`, form fields have labels, the shells have `<main>` and `<nav aria-label="Main">`, the only images (the logo) have alt text, and a global `:focus-visible` ring meets contrast in both modes. Three read-only scouts checked every `.tsx` screen. Every finding below was checked against the code before it was fixed.

### Fixed in this branch

| Where | Problem | Fix |
|---|---|---|
| `src/ui.tsx` `MiniStrip` | `aria-label` on a plain `<div>` is ignored, so the section summary was never read | `role="img"`, so "Sections: Intro, Verse 1, …" is read as one item |
| `src/screens/Library.tsx` pad keys row | Same: "Pads in C, D, …" was ignored, and the 12 key pills were read with no have/missing state | `role="img"` |
| `src/ui.tsx` `Menu`, `src/screens/LyricsLane.tsx` | The slide menu button was named "⋯" | New optional `name` prop sets `aria-label`. The slide menu is now "Slide actions" |
| `src/screens/Perform.tsx` (2 places) | `aria-label="Position"` on a `<p>` (not allowed on paragraphs) could hide the bar and beat numbers | Removed it. Visually hidden "Bar" and "beat" words now give the numbers meaning |
| `src/settings.tsx` `WhenItOpens` | The "When Lamp Circle opens" `<select>` had no name: its label is a plain `<span>` | `aria-label` (Mac Settings window and iPhone Settings sheet) |
| `src/desktop/SettingsApp.tsx` | The Settings window had no `<h1>` | The title is now an `<h1>`. Tailwind's reset keeps it looking the same |
| `src/mobile/SettingsSheet.tsx` | "Restore from a backup" is a label around a hidden file input, so keyboard focus showed no ring | The label shows the amber ring when its input has keyboard focus (`has-[:focus-visible]`) |
| `src/screens/Export.tsx` | A failed save showed red text that no screen reader announced | `role="alert"` |
| `src/screens/Export.tsx` | Each failing check had a button named just "Fix" | `aria-label="Fix: <the check's text>"` |
| `src/screens/SongTap.tsx` | "Tap a few beats first…" (when a section key does nothing) wasn't announced. The beat 1 note was a live region mounted together with its text, which screen readers often skip | Both are always-mounted live regions, empty and zero-height until they have text |
| `src/screens/Sets.tsx` | Way-in pads with no recording used `faint` text (3.0 to 3.5:1, and the brand rules keep `faint` for disabled and decorative things), and only a hover title said why | `muted` text (5.1:1 or more, the same as Library's missing keys) plus visually hidden "(no pad yet)" |
| `src/screens/Sets.tsx` | A set with songs had no `<h1>`, only the name field | Visually hidden `<h1>` with the set's name |
| `src/screens/WordsStrip.tsx` | The Current/Next slide buttons were named "Show now: …", which dropped the visible "Next" and "in 4 beats" | Name is now "Next in 4 beats: <lines>. Show now" |
| `src/screens/Refine.tsx` | "pass 1 · bar 9" was a polite live region that changes every bar, so a screen reader would talk over the audition | `aria-live="off"`, like the clock on the Tap screen |
| `src/App.tsx` | "Loading your library…" and "Could not open your library" showed outside any `<main>`, and the error wasn't announced | Both in `<main>`. The error is `role="alert"`, loading is `role="status"` |

### Not fixed: design calls

These change how a control behaves or looks, so they're for Kevin to decide.

1. **Refine's section picker** (`Refine.tsx:64`) is `role="listbox"` with `role="option"` buttons, but has no arrow keys and every option is a Tab stop. Either add arrow keys with a roving `tabIndex`, or make them plain buttons with `aria-pressed`. e2e selects these by `[role=option]` (`scripts/e2e.ts:430`), so the second way needs e2e changes too.
2. **Perform's pad view switch** (`Perform.tsx:917`, Simple/Guided/Advanced) is a `radiogroup` with no arrow keys. Same choice as above.
3. **Tap screen position bar** (`SongTap.tsx:809`) is `role="slider"` with no key handler of its own. The global ←/→ keys (a bar at a time) do move it, but Home, End and Page Up/Down don't.
4. **Shown by color alone:**
   - Tapped versus placed beat ticks (`SongTap.tsx:787`). The help text says "Gray ticks are beats the app placed", which is still color.
   - Fade-in versus fade-out handles on Refine (`Refine.tsx:286-314`): amber versus gray, plus lane position.
   - Lyric slides marked to check (`LyricsLane.tsx:83-86`): amber border and dot, eased by the tooltip and the legend.
   - The tap calibration pad (`TapCalibration.tsx:14`): each tap only flashes. A screen reader gets no count.
   - Perform Simple mode's pad tiles (`Perform.tsx:976`) light the sounding key. "Now sounding" above them says the key in text, so this one is mostly covered.

### Contrast notes

Computed with the WCAG formula from the tokens in `src/index.css`. Text needs 4.5:1, or 3:1 for large text. Control borders and icons need 3:1.

| Pair | Light | Dark | Verdict |
|---|---|---|---|
| `ink` on page, panel, raised, well | 12.9 to 15.1 | 13.1 to 16.7 | pass |
| `muted` on the same | 4.67 to 5.48 | 6.3 to 8.1 | pass |
| `amber` text | 4.93 to 5.79 | 8.4 to 10.7 | pass |
| `danger` text | 4.74 to 5.56 | 6.25 to 7.96 | pass |
| navy on `accent` (primary buttons) | 7.0 | 7.4 | pass |
| section shades (text on each shade) | 5.5 to 13.0 | 5.8 to 13.0 | pass |
| `faint` on the backgrounds | **3.0 to 3.5** | 3.6 to 4.6 | Fine for disabled and decorative uses (WCAG exempts disabled controls) and for the small icons in Sets, which need 3:1. Don't use it for text that carries meaning |
| `edge` (field and button borders) | **1.9 to 2.3** | **2.1 to 2.6** | Below the 3:1 that WCAG 1.4.11 asks of a text field's boundary. Buttons are fine, since their text identifies them |
| `accent` as text on a light background | **1.8 to 2.2** | 7.5 to 9.5 | Not used as text today. Keep amber text on `amber`, as the brand rules say |

Suggested, not applied (colors belong to `docs/brand/README.md`): `--edge: 143 133 117` in light mode and `75 114 150` in dark mode both reach 3:1 on every background. If `faint` ever needs to carry text, `104 107 109` reaches 4.5:1 in light mode.

## How this was checked

- `npm audit --json`, `npm outdated --long`, `npm view` for the latest version in each major line, and `npm audit fix --dry-run` before applying anything.
- `cargo update --dry-run`, `cargo tree -i` for how each flagged crate gets in, and `gh api -X GET /advisories?ecosystem=rust&affects=…` for the Rust advisories.
- Contrast: a short script that reads the color tokens from `src/index.css` and prints WCAG ratios.
- Accessibility: three read-only scouts, then each finding checked by reading the code. No browser screen reader was run. These fixes are checked by type checks, e2e and reading the code, not by VoiceOver.
