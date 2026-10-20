# Design Review (after): Lampcircle flow
Scored by a fresh sub-agent given only the screens and the frame (not the cut-list ledger). Date: 2026-10-05.

**Verdict:** NOT DONE (score 6/10). 4 of 7 Quick Diagnostic rows pass. The three that fail are steps to value, back of the fence, and pride.

**Bottom line:** The core trick works: a queued part really does land on the next bar line. But it takes 8 actions and about 20 seconds of tapping to get there. Along the way, the Tap screen can strand you, Prep throws away your edits, and on Perform one stray key stops the music in front of the room.

## How I tested

- Opened my own tab (isolated context `lampcircle-subtract`) at 1440×900. I imported `click-100bpm.wav` through **Choose Audio File**, tapped it with Space and I/V/C/B, locked it, set pickups and fades in Prep, then performed. I also ran Perform at 820 wide. The viewport came out 820×986 because of window chrome.
- I played a 2-song set and pressed **Next song** mid-song.
- I walked Library and Tap cold, then read the code only to confirm why things broke.
- What I left behind: the imported song is still in the library, as a second row named "click-100bpm". I added it to the set and then removed it, so the set is back to how I found it. I didn't delete anything.
- Screenshots: `/Users/kk/Projects/_scratch/lampcircle-ui-subtract-2026-10-05/screens/jobs-after-*.png` (10 files).

## Quick Diagnostic (whole flow)

| # | Question | Result | Evidence |
|---|----------|--------|----------|
| 1 | Can you state the One Thing in one sentence? | **PASS** | "Queue the next part and it lands on the beat, eyes on the room." Each screen has one job and one big action: **Perform this set** (green, Library), **Tap the 1** (full-width blue, Tap), **Perform** (green, Prep), and the pads (Perform). But Perform still carries things that fight the One Thing, like **Jump now** and Space = pause. |
| 2 | Does a new user reach core value in ≤3 steps? | **FAIL** | It takes 8 actions plus at least 8 bars of tapping (~19 s at 100 BPM) before the first part change. After import you're left on Library, and the new song sits at the bottom of the list. Even the demo path takes 5 actions (Demo Track tab → Generate → Perform → Play → pad). Only a returning user with a ready song does it in 3 (Perform → Play → pad). |
| 3 | Did the reviewer use it cold, as a customer? | **PASS** | I walked Library and Tap before reading any code. I used the real import path with a real file and went all the way through Perform at both sizes. |
| 4 | Is there a working demo on the real device? | **PASS** (caveat) | It runs in a laptop browser at laptop size, which is one of the two target devices, and the beat landing works there. Still unproven: a real tablet with touch, a dim room, and a full-length song. My file was 40 s; a 4-minute song is about 100 bars. |
| 5 | Was anything removed this cycle? | **PASS** (half-done) | The old player and stage views don't appear anywhere in the flow. Library rows show only the next step: **Tap in**, then **Prep**, then **Prep** + **Perform**. But the cut stopped at "unreachable." `App.tsx` still has about 350 lines of player/stage UI and still imports 7 components: WaveformPlayer, TransportControls, RegionEditor, LoopManager, StageMode, SettingsPanel, and BeatGridView. I can't see history, so this verdict comes from the product alone. |
| 6 | Do error, empty, and edge states match hero-screen quality? | **FAIL** | Tap dead-ends when the song ends: Play does nothing at 0:40 and there's no rewind. Prep with 0 bars is an empty grey box, with a Save button and a green Perform button that look live but do nothing. Prep edits vanish when you press **← Library**. More under Back of the fence. |
| 7 | Would the team proudly use it daily and sign it? | **FAIL** | Perform breaks PRODUCT.md's own rule, "safe from mid-song mistakes." Space pauses instantly (I tested it). **← Library** ends the song in one click. A **Jump now** button, 184×16 px, sits 8 px under every pad. And Prep is a form of number boxes, not the "track editor (cut, snap, fade)" PRODUCT.md asks for. |

**Score:** 4/7 → **6/10**. Real cuts and fixes are needed.

## The One Thing

Queue the next part and have it land on the beat, so the leader can keep their eyes on the room.

## Keeps its promise?

**Half.** The beat part keeps it:

- I queued Verse (2-beat pickup, 2-beat fade) at Bar 1.3. Its fade started on Bar 2.1, and it landed on Bar 3.1.
- I queued Chorus (1-beat pickup) at Bar 4.1. The pickup started on 4.4, and it landed on 5.1.
- Tapping a queued pad again cancels it, which is a good way out of a wrong pad.

The eyes-on-the-room part doesn't:

- The beat readout is 24 px grey text ("Bar 6.2"), with no pulse and no countdown.
- **Up next** shows times in the song file, not "lands in 3 beats." At 820 wide it said "Lands 0:05" while the song was at Bar 11.3. That time had already passed, because the part had looped.
- When a part has no fade or pickup, it still says "Fade 0:14. Singers 0:14. Lands 0:14."
- One stray key or tap can stop the worship:
  - Space pauses (tested).
  - **← Library** stops the song.
  - **Jump now** cuts off the beat.
  - **Next song** cuts hard to silence. When I tested it, song 2 loaded stopped.

## Steps to value

New user, from a local file to the first on-beat part change:

1. **Choose Audio File**, then pick the file. You stay on Library, and the song appears at the bottom of Your songs as "Needs tap."
2. **Tap in**.
3. **Play**.
4. Tap the 1 (Space) for at least 8 bars (~19 s), pressing I/V/C/B at each section start. No tempo verdict appears until bar 8.
5. **Lock to 100 BPM**. You only get this if your taps are steady. If they "drift," the grid is just your taps, so on a real song you'd have to tap every bar.
6. **Prep** (a small grey button, top right).
7. **Perform** (green, top right). Shaping the parts is optional.
8. **Play**.
9. Press a number key or tap a pad.

**Target: 3. Actual: 8 actions plus the tapping.** A returning user with a ready song gets there in 3 (Perform → Play → pad).

## Cut list

**Perform**
- **Jump now** under every pad. It's an off-beat cut with a 16 px-tall target 8 px below a 100 px pad. If you really need a hard jump, make it a long-press on the pad.
- The "Fade … Singers … Lands …" line in Up next. Replace it (see fix 2).

**Tap**
- **Use detected grid** and **Snap to detected hits**. PRODUCT.md puts auto-analyze out of scope, and snap made things worse. It pulled my early first tap 0.45 s onto the first detected hit. That produced "Drifts 100–133.3 BPM" on a steady click track and turned off Lock.
- The **Lock to 100 BPM** button once you've locked. It sits right next to "Locked at 100 BPM."

**Import and Library**
- The "Detecting beats… Suggesting regions…" steps at import. Prep rebuilds the regions from the parts when you save, so the suggestions never reach you. All they leave is a guessed BPM that Library shows before you've tapped ("Needs tap · 0:40 · 100 BPM").
- BPM on the song's info line when it's already in the title ("Demo Track - 120 BPM" over "1:00 · 120 BPM").
- The drop zone's second line, "Audio, or a .djw map followed by its audio." It repeats the heading.
- The **Demo Track** tab once the library has songs. Move the demo into the empty "Your songs" state.
- **Add to set** on songs that are already in the set. Clicking it does nothing.

**Prep**
- **Save · mark ready**. Autosave the way Tap does, and leave **Perform** as the one action. Move **Export .djw** off the main bar.

**Code**
- The unreachable player/stage branch in `App.tsx` and its 7 imports.

## Fix list (ranked)

1. **Make Perform safe mid-song.** One press of Space shouldn't stop the music; use hold-to-pause or a double-press. While a song is playing, **← Library** should need a hold or a confirm. **Next song** should queue the next song, and show its name, instead of cutting to silence.
2. **Make Up next glanceable.** Show "Lands in 3 beats" with a 4-dot beat pulse, and make the bar/beat readout big and bright. Drop the song-file times; they go stale as soon as a part loops.
3. **Fix the Tap dead end.** Add a restart or rewind, or let you click the time to seek. After the song ends, Play should start over from 0. Right now Play does nothing at 0:40, and the only way out is **← Library** and back in.
4. **Make Space always tap on Tap.** After you click the Snap checkbox or the Meter menu, Space works that control instead. I tested this: the checkbox flipped and the bar count didn't change. Also, either ignore taps while the song is paused or say "Press Play first." Right now a paused tap gets saved.
5. **Stop Prep from losing work.** Autosave, or confirm before **← Library** and **Re-tap**. I tested this: I set Verse to pickup 2 and fade 2, pressed **← Library**, and reopened the song. Both were back to 0.
6. **Make Prep a track editor.**
   - The part blocks hide bar numbers 1–16 of 17; only "17" shows.
   - There's no playhead, and clicking a part doesn't seek.
   - You can't move a boundary or add a part, only rename or delete one, so fixing a boundary means Re-tap.
   - Put pickup and fade on the block as handles, and show the playhead.
7. **Shorten the path.** After import, go straight to Tap for that song, or pin it to the top and highlight it. After Lock, make **Prep** the main button. If you can, show a tempo verdict before bar 8.
8. **Keep the status labels honest.** A song with 0 taps shows "Needs prep" and opens a blank Prep. Send it back to "Needs tap." Make disabled buttons look disabled: Undo on Tap, and Save and Perform on Prep.
9. **Cover the basics of "line up tonight's set."** You can't reorder the set. Two "click-100bpm" rows and two "Demo Track - 120 BPM" rows look identical, so you can't tell which one is in the set.
10. **Warm up the Perform colors.** Full-strength blue, green, amber, and red pads on near-black glare in a dim room, which fights "soft lamp, small circle." The queued pad gets a purple ring, which barely shows up on a red pad.

## Back of the fence

- **Prep with 0 bars:** a blank grey box. Save and the green Perform button look live but are disabled, and **Export .djw** still exports an empty map.
- **Tap before your first tap:** it says "Keep tapping. 0 bars so far." over a bare "Sections" heading. After you undo every tap, it still lists "Intro · bar 1 … Bridge · bar 7" for a grid with 0 bars.
- **Clearing taps** takes one Undo per tap (9 clicks for 9 taps). There's no "start over."
- **Undo removes the latest tap in the song, not your last action.** The taps get sorted, so if you make a stray paused tap at 0:05, Undo removes your real tap at 0:17 instead.
- **Grammar on Library's main button:** "1 song still need prep" (should be "needs").
- **YouTube helper errors are written for a developer, not a worship leader:** "Start the app with npm run dev…" and "Install yt-dlp…"
- **Import success** is a "Done!" flash that lasts 500 ms, and the new song gets no highlight.
- **One flow, three widths:** Tap is a centered 768 px column, Prep runs edge to edge at 1440, and Perform is 1024 px.
- **Dead code:** 300+ lines of player/stage UI still ship in `App.tsx`.
