# v2 rebuild plan

Source of truth: `docs/v2/DJ Worship Wireframes.pdf` (7 pages, 2026-10-20). Baseline: git commit `3c160bb` (v1 spike).

## Definition of done

Every check below passes on the real app, run from a clean checkout:

1. `npm run build` exits 0 (strict `tsc` plus `vite build`).
2. `npm test` passes. It covers the pure logic: tap grid, section marking, key finding, pad fits and routes, set plans, export checks, `.djw` round trip (v2 write, v1 and v2 read), and perform scheduling.
3. `npm run e2e` passes. It starts the dev server and the helper with a fake `yt-dlp`, opens headless Chrome, and walks every screen with real clicks and key presses:
   - Library. A YouTube link queues, shows progress, and lands as a song. A pad link lands as a pad. A local audio file imports. Search filters. The next-step link matches the song's state. The detail card shows the section strip.
   - Tap and sections. Space and Shift+Space taps give the right tempo (within 0.5 BPM). Taps made while the song plays snap onto the nearest clear attack (within 80 ms) and are corrected for speaker latency. "Map the rest from the song" follows the recording from 8 or more taps to cover the song, drift included. Keys 1 to 8 mark sections at the nearest bar. The app finds each section's key and flags a key change. On the track, the Select tool (V) opens a panel for one section: label, start bar, pickup beats, key, play, re-tap, remove. The Cut tool (C) shows the nearest bar inside the hovered section and splits it there.
   - Refine. Repeats, jump rule, and the loop seam save. The seam view shows the end of the pass over the start of the next, with dots for where the fade-out starts and ends and where the fade-in starts and ends (its end is the pickup). The fade-out can end after the loop point, so the old pass rings over the new one. Fades follow an equal-power curve. "Play transition" plays 2 bars into the loop point and 1 bar past it; "Audition loop" plays two passes with a moving playhead; Repeat keeps either going. "Copy settings to all choruses" copies.
   - Export. All 4 checks pass. "Save & add to set" writes a `.djw` that re-imports to the same map.
   - Sets. Add, reorder, plan text, live pads with a way in, the half-time note, and Practice.
   - Perform. Sound comes out (analyser RMS above zero). Bar and beat advance. A queued section lands on its boundary (scheduled landing time equals the boundary within 5 ms). Hold, Cancel, Pause, Go to pad, song end into pad mode, pad changes, and "Start Intro on next bar" into the next song.
4. Screenshots of all 7 screens sit next to the wireframe pages and match layout, copy, and states.
5. A second-opinion review finds no open correctness issue.

## Shape

Data first. Everything else is derived from four stored records.

- `Song`: metadata only. Taps (`{t, one, auto?}` on every beat; `auto` marks beats the app placed by following the recording), beats per bar, fill flag (old songs only), sections (`start` in seconds, type, optional name, optional key override, pickup, fades, repeats, jump rule), `marksEnd`, peaks, chroma, refined and exported stamps.
- `Pad`: title, key, duration.
- `audio`: blob per song or pad id, written once.
- `WorshipSet`: name and ordered song ids. Live pads between songs are derived.

Derived, memoized per song object: beat grid and downbeats from taps, section bars, section keys from chroma, plan text, length, next step, the 4 export checks. Nothing derived is stored, so nothing goes stale. The one exception is mapped beats (`auto` taps): they come from the decoded audio, which only the Tap screen has, so they are stored at the moment you map. A tap always wins over a mapped beat, and turning mapping off removes them.

## Modules

- `src/types.ts`. The records above.
- `src/lib/songMap.ts`. Grid, sections, plans, checks, next step.
- `src/lib/music.ts`. Key names, key finding, pad fits, routes, tempo notes.
- `src/lib/analysis.ts`. FFT, peaks, chroma.
- `src/lib/djw.ts`. `.djw` v2 write, v1 and v2 read.
- `src/lib/db.ts`. IndexedDB v2 with a v1 migration.
- `src/lib/library.ts`. Import audio, pads, `.djw`, and the download queue client.
- `src/lib/performPlan.ts`. Pure scheduling: next boundary, next section, lead times.
- `src/audio/engine.ts`. One AudioContext, buses, decode cache, editor transport, perform session, pads, synth pads.
- `src/screens/*`. Library, Song (tap and sections), Refine, Export, Sets, Perform.
- `server/index.js`. Download queue with progress.

## Order

1. Subtract. Delete v1 screens and analysis code the wireframes drop (lyrics, auto regions, loops, stage mode, wavesurfer, tone).
2. Scaffold. Types, db migration, design tokens and fonts, shell with sidebar and hash routes.
3. Harness. Pure tests, synthetic test audio, fake `yt-dlp`, CDP e2e driver.
4. Riskiest first. Perform engine and its scheduling tests, then key finding.
5. Screens in flow order: Library, Tap and sections, Refine, Export, Sets, Perform.
6. Visual pass against the PDF, second opinion, fix, done.

## Status (2026-10-20)

Verified:

- `npm run build` and `npm test` pass from a clean copy of the tree after `npm ci`.
- `npm run e2e` passes 98 checks, including the v1 to v2 IndexedDB migration.
- With real yt-dlp, **Get all 12 keys** imported the Worship Pads album *Spontaneous, Vol. 4*, and Perform plays those recordings.
- Screenshots of all 7 screens match the wireframe layout, copy and states.

Still open, because each needs a person or hardware:

- A person tapping along to a real recording.
- A real tablet, and Safari.
- A background tab stalled for more than 3 seconds.
- A hold or pick during a song's ring-out (fixed in code, but no e2e check).
- Two tabs importing the same download (it makes a duplicate song).
