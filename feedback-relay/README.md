# Feedback relay

**Help › Send Feedback…** (⌘⇧F) in the app posts a note to this relay, and the relay files it as an issue on `kevnk/lampcircle` labelled `feedback`. The relay also serves the app's updates: installed copies ask it, not GitHub, for the newest release. The app itself never holds a GitHub token; only the relay does, as a secret.

**`kevnk/lampcircle` is public, so every feedback issue is public too.** That's why the relay ignores any `email` field (Lamp Circle 0.1.0 still sends one) and replaces each email address in the note with `[email removed]`, in the issue's title and body alike.

It is two files with no dependencies (`worker.js` for feedback, `updates.js` for updates), written for Cloudflare Workers; `server.mjs` runs the same code on Fly.

## Deploy

The app expects the Fly app `lampcircle-feedback`. Both `plugins.updater.endpoints` in `src-tauri/tauri.conf.json` and `LAMPCIRCLE_FEEDBACK_URL` in `.github/workflows/release.yml` point at `https://lampcircle-feedback.fly.dev`. A Cloudflare deploy gets a different URL, so change both if you deploy there instead.

### Fly.io

```bash
cd feedback-relay
fly launch --no-deploy  # Creates the app; say no to postgres/redis
fly secrets set GITHUB_TOKEN=github_pat_your_token_here
fly deploy
```

The app scales to zero when idle and wakes on the first request.

### Cloudflare Workers

```bash
cd feedback-relay
npx wrangler login
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
```

### The token

The token is a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) scoped to `kevnk/lampcircle` alone, with **Issues: Read and write** and **Contents: Read** (releases count as contents). Nothing else. Issues are filed under the account that made the token.

### The app's side

Release builds get the relay's URL from `.github/workflows/release.yml`. For a local build, put it in `src-tauri/.cargo/config.toml` as `LAMPCIRCLE_FEEDBACK_URL` (copy `config.toml.example`) and rebuild. Without it, Send Feedback says feedback isn't set up in this build.

## Updates

Three `GET` routes read the newest published release (drafts and pre-releases left out) with the token:

| Route | Answer |
| --- | --- |
| `/updates/latest.json` | The release's `latest.json` (the manifest `tauri-action` attaches), with each download `url` pointed at this relay. `204` when nothing is published yet, which the app reads as "up to date". |
| `/updates/download/<asset id>/<name>` | `302` to GitHub's short-lived signed link for that asset, so the bytes never pass through the relay. |
| `/updates/dmg` | `302` to the newest `.dmg`, a stable link for a first install. |

The release lookup is remembered for a minute, so a burst of update checks costs one lookup, plus one manifest fetch per check. The app's updater endpoint is `plugins.updater.endpoints` in `src-tauri/tauri.conf.json`; it passes `version`, `target` and `arch`, which the relay ignores (the updater compares versions itself and verifies the bundle's signature against the public key in the same file).

Because the repository is public, GitHub serves the same manifest without the relay at `https://github.com/kevnk/lampcircle/releases/latest/download/latest.json`. That URL can stand in for the relay's in `plugins.updater.endpoints` if the relay ever goes away.

Try it:

```bash
curl -i "$LAMPCIRCLE_FEEDBACK_URL/updates/latest.json"
curl -I "$LAMPCIRCLE_FEEDBACK_URL/updates/dmg"
```

## What feedback accepts

`POST` with a JSON body:

```json
{
  "message": "The pad cuts out when…",
  "attachment": { "name": "shot.png", "mime": "image/png", "data": "<base64>" },
  "app": { "version": "0.1.0", "os": "macos", "arch": "aarch64" }
}
```

`attachment` and `app` are optional. The note becomes the issue body (quoted) and its first line the title, with every email address in it swapped for `[email removed]` first. An `email` field is ignored: the relay doesn't check it, store it or post it. Notes over 5000 characters are refused with a plain-text reason the app shows as is.

A screenshot (`attachment`, PNG/JPEG/GIF/WebP, up to 5 MB, base64 in `data` without a `data:` prefix) is committed to a `feedback-attachments` branch of its own, created from the default branch the first time one is needed, and embedded in the issue by its raw URL. Lamp Circle's app sends no screenshots, and committing one needs **Contents: Read and write** on the token. If the upload fails, the note is still filed, just without the picture.

Try it (this files a real, public issue):

```bash
curl -X POST "$LAMPCIRCLE_FEEDBACK_URL" -H 'Content-Type: application/json' -d '{"message":"Test from curl"}'
```

## Test

```bash
node --test
```

## Limits

Anyone who finds the URL can file issues. The relay refuses anything but a small JSON note, and each note and each update check costs a GitHub API call against the token's rate limit. If that becomes a problem on Cloudflare, add a [rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) on the worker's route in the dashboard, which needs no code change.
