# The Mac app

Lampcircle also runs as a Mac app, built with Tauri 2 from the TF Mac app template (`~/Sites/_misc/truefrontier/tf-mac-app`). It is the same React app in a native window. The app does its own YouTube downloads, so nothing else needs to be running.

The web app still works as before (`npm run dev`), for tablets on the same network and for the e2e suite.

## Run and build

You need Rust (`rustup`), Node 22 or later, and `brew install yt-dlp ffmpeg`.

```bash
npm run tauri dev                          # a dev window on port 1420, with hot reload
npm run tauri build -- --debug --bundles app   # a local Lampcircle.app, unsigned
npm run tauri build                        # release .app and .dmg (signing needs the steps below)
```

Checks:

```bash
cd src-tauri && cargo test && cargo clippy   # Rust: the download queue, settings, sessions, diagnostics
npm test && npm run e2e && npm run build    # the web app, unchanged
```

`cargo test` runs the download queue against `scripts/fake-yt-dlp.mjs`, the same fake that e2e uses.

## How it differs from the web app

| Part | Web app | Mac app |
|---|---|---|
| YouTube downloads | `server/index.js` on port 3001 | `src-tauri/src/downloads.rs`, the same queue and yt-dlp flags |
| Downloaded files | `library/` in this folder | `~/Library/Application Support/app.truefrontier.lampcircle/library` |
| Songs, maps, pads, sets | Your browser's IndexedDB | The app's own IndexedDB, under `~/Library/WebKit/app.truefrontier.lampcircle` |
| Saving a `.djw` | A browser download, or a folder you pick in Chrome | The Mac Save dialog |
| Dropping audio files | Works | Works. Tauri's own drop handling is off (`dragDropEnabled: false`) so the page gets the files |

`src/platform/` is the seam. `platform.helper` and `platform.saveText` pick the browser or the Mac version. Code that only the Mac app runs uses `desktop`, and only `src/desktop/` touches it. Keep `server/index.js` and `downloads.rs` in step when either changes.

**Moving your library from Chrome.** The app starts empty, since it has its own IndexedDB. In the web app in Chrome, open Library and choose More › Export library. That saves one `.lampcircle` file with every song, pad, set and recording.

In the Mac app, choose More › Import library and pick that file. Import only adds what the app doesn't have yet, so importing twice is safe. Export is only in the web app for now.

**yt-dlp and ffmpeg come from Homebrew.** An app opened from Finder gets a bare PATH, so the app adds `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin` for yt-dlp. That is also how yt-dlp finds ffmpeg and a JavaScript runtime. Without yt-dlp, a download says how to install it. `YT_DLP_PATH` points at a different yt-dlp.

## What the app adds

These come from the template:

- **Settings** (⌘,): light or dark, reopen the last page or start at the Library, open at login, usage counts, crash reports, update check, and diagnostics export.
- **Reopen the last page.** The app saves the page's address in `last-session.json`. Perform reopens as its set, so opening the app never starts the music.
- **Menus.** Lampcircle, Edit (so ⌘C and ⌘V work in text fields), Window and Help. Help has Keyboard Shortcuts (⌘/) and Send Feedback (⌘⇧F).
- **⌘W hides the window** instead of closing it, and the music keeps playing. Click the Dock icon to bring it back. ⌘Q quits.
- **One copy at a time.** Opening Lampcircle again brings the open window forward.
- **Playback while hidden.** `backgroundThrottling: "disabled"` keeps Perform's timers running when the window is covered or hidden.
- **Diagnostics export.** A ZIP of the app's logs and settings, with secrets taken out. Nothing is uploaded.

The template's shortcut-remapping stub is left out, since Lampcircle's keys live in the page, not the menus.

## Still placeholders

Each of these needs a real value before a public release. None of them belongs in git.

| What | Where | Without it |
|---|---|---|
| Updater public key and endpoint | `plugins.updater` in `src-tauri/tauri.conf.json` | Check for Updates fails in a release build |
| Feedback relay URL | `LAMPCIRCLE_FEEDBACK_URL` in `src-tauri/.cargo/config.toml` (copy the `.example`) | Send Feedback says it isn't set up |
| Aptabase key | `APTABASE_APP_KEY` at build time | No usage counts are sent |
| Crash report DSN | `VITE_CRASH_DSN` in `.env.local` | No crash reports are sent |
| Apple Developer ID | Signing and notarization | macOS warns that the app is from an unknown developer |

The release steps (notarization, updater signing, the inert GitHub workflow) are in the template's `docs/notarization.md`. Publishing a release needs Kevin's OK.

## Versions and icons

- `npm run release -- 1.2.0` sets the version in `package.json`, `tauri.conf.json` and `Cargo.toml`. It doesn't tag or push.
- `sh scripts/app-icon.sh` remakes the app icons from `docs/brand/logo.png`.
