# Lamp Circle

Live song maps for leading worship in a small room. Add a recording, tap its beat, mark its sections, shape how each section loops and lands, then build a set and perform it. Section pads change on the beat, and a live pad from a real pad recording carries you between songs.

## Run it

You need Node 22 or later, plus [yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg for YouTube downloads (`brew install yt-dlp ffmpeg`).

```bash
npm install
npm run dev
```

Open http://localhost:43123. `npm run dev` starts the web app and the download helper on port 3001. Downloads land in `library/`. Songs, maps, pads and sets stay in the browser's IndexedDB.

## Mac app

Lampcircle also runs as a Mac app that does its own downloads. With Rust installed, `npm run tauri dev` opens it, and `npm run tauri build` builds it. See [docs/mac-app.md](docs/mac-app.md).

## The flow

1. **Library.** Paste a YouTube link, or add or drop an audio file. On the Pads tab, **Get all 12 keys** downloads the Worship Pads album *Spontaneous, Vol. 4* from YouTube. Any pad link or playlist works too; the key comes from the title, as in "A# Pad".
2. **Tap and sections.** Press Space on every beat and Shift+Space on beat 1. Taps snap onto the beat when you are close. After 8 taps, "Map the rest from the song" follows the recording for the rest of the song. Then press 1 to 8 while the song plays to mark sections at the nearest bar. The app finds each section's key.
3. **Refine.** Set each section's pickup (singers coming in early), its live repeats, where a jump to another section lands, and the loop-seam fades. Audition the loop.
4. **Export.** Four checks must pass. **Save & add to set** writes a `.djw` map, which never contains the audio.
5. **Sets.** Order the songs. Each gap gets a live pad with a way into the next key.
6. **Perform.** Number keys queue sections, H holds, Esc cancels, and Space pauses. When a song ends, the pad keeps playing until you bring in the next song on the bar.

## Checks

```bash
npm test      # pure logic: beat grid, sections, keys, pads, plans, .djw, scheduling
npm run e2e   # every screen in headless Chrome, with a fake yt-dlp and generated test audio
npm run build
```

The e2e run saves screenshots to `docs/v2/screens/`, in whichever mode the system uses. The design is `docs/v2/DJ Worship Wireframes.pdf`, the plan is `docs/v2/PLAN.md`, and the decision log is `docs/v2/decisions.tsv`.

## Brand

The logo, colors, type and light and dark modes all come from the logo file. The rules are in [docs/brand/README.md](docs/brand/README.md).
