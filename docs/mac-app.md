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

Only the crash report DSN is still missing. Until it's set, no crash reports are sent, release builds included. Keep it out of git.

| What | Where | Without it |
|---|---|---|
| Crash report DSN | `VITE_CRASH_DSN` in `.env.local` | No crash reports are sent |

## Releases

`.github/workflows/release.yml` builds the signed, notarized universal app and attaches the `.dmg`, the updater bundle and `latest.json` to a GitHub Release on `kevnk/lampcircle`.

- **Release:** run `npm run release -- 0.2.0`, commit, then push the tag `v0.2.0`. The workflow checks the tag against the app's version and publishes the release. Publishing needs Kevin's OK.
- **Dry run:** run the workflow by hand (Actions › Release › Run workflow). It builds into a draft release that installed copies never see, and it refuses a version that's already published. Delete the draft before you push that version's tag.

Repository secrets, by name (Settings › Secrets and variables › Actions):

- `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/lampcircle.key`. Its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. The key's password is empty, so leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset.
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`, plus `APPLE_SIGNING_IDENTITY` if you want to pin it: Developer ID signing and notarization.
- `APTABASE_APP_KEY` (optional): usage counts. Builds without it send none.

`LAMPCIRCLE_FEEDBACK_URL` isn't a secret. The workflow sets it for release builds. A local build reads it from `src-tauri/.cargo/config.toml`: copy the `.example` and set it to `https://lampcircle-feedback.fly.dev`.

**The relay** in `feedback-relay/` files feedback as GitHub issues and serves updates to installed copies. It runs as the Fly app `lampcircle-feedback`, which **isn't deployed yet**, so Check for Updates and Send Feedback fail in release builds until it is. It needs the Fly secret `GITHUB_TOKEN`: a fine-grained token on `kevnk/lampcircle` with Contents: Read and Issues: Read and write. The repo is public, so feedback issues are public too, contact emails included. See `feedback-relay/README.md`.

**Public fallback.** Because the repo is public, GitHub serves the newest `latest.json` without the relay at `https://github.com/kevnk/lampcircle/releases/latest/download/latest.json`. That URL can replace the relay's in `plugins.updater.endpoints` if the relay goes away.

The template's `docs/notarization.md` covers signing and notarization in depth.

## Versions and icons

- `npm run release -- 1.2.0` sets the version in `package.json`, `tauri.conf.json` and `Cargo.toml`. It doesn't tag or push.
- `sh scripts/app-icon.sh` remakes the app icons from `docs/brand/logo.png`.
