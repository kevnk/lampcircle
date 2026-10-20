> **Product name (2026-09-29):** **Lampcircle** (working). Former: Worship Song Looper / `worship-song-looper`. Tagline lean: live song maps — home-church / living-room angle.


## 2026-09-27 — v2 wireframes (Design canvas)

**Assumptions**
- v2 flow is four screens: Download → Prep/cut → Set list → Perform (one song at a time).
- Built from `NOTES-rewireframe-2026-09-27.md`: keep import, skip fixing Analyze, Prep feels like a track editor, Perform uses smart-queued pads with pickup support.
- No design system. Plain wireframe look: light screens for setup, dark screen for the stage.
- Analyze is out of scope, so Prep asks for a manual beat grid (BPM, time signature, where bar 1 starts, tap tempo).

**What exists**
- Design canvas "Worship Looper v2 Wireframes": https://claude.ai/artifact/3TC3a9zUx2pvQsbaSJzGtb
- 1 Download: one box for search or link, drop zone for files, results with download states, "Your songs" list with prep status.
- 2 Prep: song overview strip, zoomed timeline with measure ruler, cut tool, snap Off/Beat/Measure, clips with fade handles, a pickup zone before the chorus, and an inspector (part details, pickup, fades).
- 3 Set list: prepped songs on the left, ordered set on the right with drag handles, "Start on" part, and a note per song.
- 4 Perform: set progress, bar/beat counter, whole-song strip, 8 pads (one per cut part), "Up next" card, smart-queue settings, transport. Pads are clickable: tap to queue, tap again to cancel, "Jump now" to switch.
- Screens link to each other in Play mode through the step nav.

**Open questions**
- Should repeated parts (Chorus 1/2/3) be one pad or three?
- Should "Start on" in the set list stay, or should every song start on its first pad?
- Is a tablet the target for Perform (sizes assume 1280×800)?

**Next steps**
- Kevin reviews and marks up the canvas.
- Revise wireframes, then decide what to build first (likely Prep).

## 2026-09-27 (later) — How to find time signature and beats when tempo drifts

**Question from Kevin:** How do we find the time signature and place each beat, especially for live songs that don't hold one BPM?

**Proposed answer (not built, not yet on the canvas)**
- Store a beat map (a timestamp for every beat), not one BPM. BPM becomes a readout. The v1 `Beat[]` type already works this way.
- Time signature: Kevin picks it (default 4/4). Short odd bars (like a bar of 2 before a chorus) go inside the part they belong to, so the part is "8 bars + 2 beats."
- Placing beats, MVP: a "Tap the 1s" pass. Play the song and tap a key on every downbeat. Each tap snaps to the nearest drum hit and becomes an anchor. The app spaces the beats evenly between anchors, so drift is handled bar by bar.
- Fixing: drag any bar line onto the real hit. Only needs to be right near cuts and inside loops.
- Later, not now: an automatic beat and downbeat tracker fills the map first, and Kevin fixes it (matches the "don't fix Analyze yet" note).
- Open risk: two parts at slightly different tempos. Crossfades should hide small gaps; time-stretching waits until it's actually needed.

**Next step offered:** update the Prep wireframe to show the Tap-the-1s pass and draggable bar lines in place of the single BPM field.

## 2026-09-28 — Tap screen, slimmer Prep, .djw export

**Kevin asked for**
- A screen before the editor for tempo and tapping (Space = tap the 1), plus other keys to mark sections as they start.
- Less clutter under the Prep timeline: keep Selected part / Pickup / Fades, but behind icons or popups. Beat grid fields move off Prep.
- Save a fully mapped song as XML or YAML with a custom extension, maybe .djw ("DJ Worship").

**What changed on the canvas (now 5 screens)**
- New "2 · Tap": song map with your taps and section flags, a tempo line that shows drift, a big Tap-the-1 pad (Space), section keys I/V/C/B/T/O (Intro, Verse, Chorus, Bridge, Tag, Other) that snap to the nearest tapped 1, undo, time signature picker, snap-to-drum-hits toggle, sections list. Clickable in Play mode.
- "3 · Prep": beat grid fields replaced by read-only chips plus a Re-tap link. The three cards are gone. The selected part gets a small icon toolbar (rename, pickup, fades, loop, delete); the Pickup popover is shown open. The timeline got taller. The bottom bar shows a one-line summary, Export .djw, and Save.
- "1 · Download": the drop zone takes a .djw file too. "Prep" buttons now go to Tap.
- Nav on every screen updated to 5 steps.

**Decisions**
- .djw is YAML (easier to read and hand-edit than XML). It holds the map only, not the audio. It points to the audio by file name, source link, and a hash.
- The grid stores one time per downbeat, not every beat.
- Sample file: `way-maker.sample.djw` in this folder.

**Open questions**
- Should a .djw ever include the audio (one file to share), or always stay map-only?
- Odd bars (a bar of 2) need a spot in the format, e.g., `extra_beats` on a part.
- The earlier open questions still stand (one Chorus pad vs three, Start on, tablet size).

## 2026-09-28 (later) — Detect a steady BPM from taps

**Kevin asked for:** if a song was clearly played to a click and doesn't drift, work out the BPM from the taps.

**Rule (on the Tap screen)**
- After 8 tapped bars, fit a straight line through the tap times. The slope is the bar length, so BPM = beats per bar × 60 ÷ bar length.
- If every tap sits within 30 ms of that line, call it steady ("likely a click track").
- If the BPM lands within 0.1 of a whole number, show the whole number (click tracks are usually set to one).
- Steady → offer "Lock to 72 BPM". Locking fills the grid for the whole song, so you can stop tapping after ~8 bars. "Use my taps" undoes it.
- Not steady → show "Drifts 67.3–70.4 BPM · using your taps" and keep the tap-by-tap grid.
- Under 8 bars → "Keep tapping."

**Canvas**
- Tap screen tempo card now shows that verdict. A Tweaks switch ("Demo: Drifts / Steady") flips between a drifting live song and a click-track song. Lock and Use my taps work in Play mode.

**Still open**
- 30 ms and 8 bars are starting guesses. Tune them on real songs.
- A song can be steady for most of it and loosen at the end (a free-time tag). Maybe lock only a range later, if it actually comes up.

## 2026-09-28 (later) — Pickup fix: fade before the pickup, land on the 1

**Kevin's concerns**
1. Pickup needs more than ½ / 1 / 2 beats.
2. A queued part with a pickup must fade in at the right beat. Example: 1-beat pickup in 4/4 → fade in on beat 3, singers on beat 4, land on the 1.

**Model (changed)**
- Every part has a landing point: its bar's 1. That's fixed.
- Pickup = beats before the 1 where the singers start. Stepper in half-beat steps, 0 up to 4 bars (16 beats). You can also drag the dashed edge on the timeline.
- Fade-in happens before the pickup, not on top of it. Audio starts at landing − pickup − fade.
- Before, the fade ran during the pickup, which would have made the singers' lead-in quiet. That's fixed.

**Canvas**
- Prep: the fade ramp now sits before the pickup zone on the timeline. The Pickup popover has a stepper and a beat diagram (3 = fade, 4 = pickup, 1 = lands) plus a plain sentence.
- Perform: "Up next" shows the same beat strip for the queued part, a sentence ("Fades in on bar 28, beat 3. Singers' pickup on bar 28, beat 4. Lands on bar 29."), and a queue deadline ("Queue by bar 28, beat 2 or it waits one more loop"). The countdown now counts to the fade start. The global crossfade control is gone; fades come from each part.
- `way-maker.sample.djw` got a comment explaining start_bar, pickup_beats and fade_in.

**Worth knowing**
- The pickup audio still has the original band under it (the end of whatever section came before in the recording). The fade-in helps blend it. If that clashes with what's looping, a shorter fade or a smaller pickup is the fix.

## 2026-09-28 (later) — Dashboard replaces Download and Set list steps

**Kevin asked for**
- Move Download and Set list off the step flow onto a Dashboard.
- Song steps become 1 · Tap and 2 · Prep.
- Perform opens from a single prepped song, or from a set list whose songs are all prepped.
- A set list can be built before its songs are prepped.

**Canvas now (4 screens)**
- Dashboard (was Download): three columns.
  - Get a song: search or paste a link, drop audio or a .djw, results with download state.
  - Your songs: each song shows its status (Needs tap → Needs prep → Ready) and the next action: Tap in, Prep, or Edit + Perform. A + / ✓ button adds a song to the open set.
  - Set lists: set picker, "New set", ordered songs with drag handles and status. Unready songs get a Tap in / Prep shortcut. Start-on and notes moved into each row's "…" menu. "Perform this set" stays disabled until every song is ready, and says how many are left.
- Song step 1 · Tap and 2 · Prep: header is "← Dashboard", the two steps, and a Perform button (grayed on Tap, live on Prep). Prep's save button is now "Save · mark ready" and goes back to the Dashboard.
- Perform: back link goes to the Dashboard. The set strip across the top only appears when performing a set (a single song has no strip).
- The separate Set list screen was removed.

**Decisions**
- A song is "Ready" once you save it in Prep. "Needs prep" means tapped but not saved.

**Open questions**
- Perform for a single song: hide the set strip and "Next song" completely, or show "Back to dashboard" there instead?
- Should "Perform this set" allow skipping unready songs, or stay strictly all-ready?

## 2026-09-28 (later) — Song transitions, pads, and key changes (design answer, not on canvas yet)

**Kevin asked:** how to handle transitions between songs; use worship pads in the set list; can the app find each song's start and end keys and suggest keys for the transition? Go deep on theory.

**Proposal**
- Pads are their own library type: 12 files, one per key. No tapping, no beat; they loop and crossfade by time (seconds), not by beat.
- Each gap in a set list gets a transition slot: Stop, Straight in, or Pad path (e.g., G → E → A).
- Each song stores a start key, an end key (last chorus often jumps up), and a tuning offset in cents. These go in the .djw.
- Suggestion engine only needs the two keys, not the audio. Rule: a root+5th pad on note P fits major key K when P is scale degree 1, 2, 3, 4, 5 or 6 of K. Bridge pads are the ones that fit both keys. Rank by role in the new key: V best, then IV, then I.
- Results by interval, ending in G:
  - One pad: same key (G), up whole step (E or D), up major 3rd (E), up 4th (G), up 5th (G or A), down minor 3rd (B or A), down whole step (C), down half step (B).
  - Two pads: up minor 3rd (C then F), down major 3rd (C then Bb).
  - Hard: up half step (only C fits both; then Eb). Tritone: no shared pad → reset (silence) or pitch-shift the next song.
- Key detection (later, not MVP): average pitch-class energy (chroma) per part using the tapped grid; match against 24 major/minor key profiles; show top guess plus runner-up; user confirms by ear with a "play pad under song" check. Known errors: relative minor mix-ups and picking the IV or V.
- MVP: type the keys in (from the chord chart), pads library, suggestion table. Auto-detect and pitch-shift come later.
- Pitch-shift the next song ±1–2 semitones as an escape hatch; larger shifts sound processed.
- Tuning: detect the recording's tuning offset (cents) and retune the pad to match. Otherwise a pad at A440 can sound sour under a slightly sharp recording.

**Open questions**
- Which pad pack? (Couldn't open the YouTube Music link.) Root+5th pads fit the rule above; pads with a baked-in major 3rd need a stricter rule (P must be I, IV or V).
- Next step offered: wireframe the transition slot on the Dashboard set list and a transition card in Perform.
