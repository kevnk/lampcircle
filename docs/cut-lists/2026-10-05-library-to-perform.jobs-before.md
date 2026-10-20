# Design Review: Lampcircle flow (Library → Tap → Prep → Perform)

Date: 2026-10-05 · Reviewer: ui-subtract run (agent) · Read at flow level, per the ui-subtract Flow mode note.
How it was experienced: cold, in a live build (Vite dev client at http://localhost:43123, Chrome via DevTools MCP, fresh isolated browser profile with an empty library). Walked from first launch → Demo Track → Library → Re-tap → Tap → Prep → Perform (queued a part with the `2` key, played and paused with Space), at 1440×900 and at a tablet viewport (820×1180). The YouTube helper (port 3001) was not running, so the first-run Library showed the helper warning. That is the real first-run state for `npm run dev:client`. Screenshots: `/Users/kk/Projects/_scratch/lampcircle-ui-subtract-2026-10-05/screens/before-*.png`.

**Verdict:** NOT DONE (score 4/10)

**The One Thing (flow):** Take a recorded song from import to a live performance where every part change lands on the beat.

Per screen (the starting point for each screen's primary action):
- Library: open a song at its next step (Tap in, Prep, Perform), or start tonight's set.
- Tap: tap the 1 of each bar until the grid holds.
- Prep: shape the parts (name, pickup, fades, loop) and hand off to Perform.
- Perform: queue the next part so it lands on the beat, eyes on the room.

**Keeps its promise?** Partly. The promise in PRODUCT.md is "warm, quiet, intimate" and "readable at a glance in a dim room, safe from mid-song mistakes." Mechanically the flow works end to end: the demo imported, Tap read "Steady 120 BPM", Prep showed four parts, Perform queued V1 with a clear "Up next" and Space toggled play without re-firing the focused pad. Tonally it breaks the promise. It is stock Tailwind on gray-900 (blue-600, emerald-600, yellow-600, green-600, purple-950) with a blue music-note logo. That reads as a generic dark dashboard, not lamp light. The Library shows three green "Perform" buttons at once. Perform shows the queued part three ways (purple panel, purple ring, "Queued · tap to cancel").

**Steps to value:** 10 for a real song (import to first queued part): Local File tab → Choose Audio File → Tap in → Play → tap 8+ bars (or Lock) → Prep → Perform → Play → queue a pad. With the demo it's 4 (Demo Track tab → Generate → Perform → Play), but the demo is not real use. Subtraction can't shorten the real path much. The steps are mostly real work, not ceremony.

## Quick Diagnostic (baseline)

| # | Question | Result | Evidence |
|---|---|---|---|
| 1 | Can you state the One Thing in one sentence? | **Pass** | Stated above. PRODUCT.md and the flow order make it unambiguous. |
| 2 | Does a new user reach core value in ≤3 steps? | **Fail** | 10 steps for a real song (list above). |
| 3 | Did the reviewer experience it cold, as a customer? | **Pass** | Fresh profile, empty library, no walkthrough. (Agent, not the leader. Tablet only emulated.) |
| 4 | Is there a working demo on the real device? | **Pass** | Running build in Chrome at laptop size. Tablet in a dim room was emulated by viewport only. |
| 5 | Was anything removed this cycle? | **Fail** | Nothing removed yet. (Built-in: flips after any cut.) |
| 6 | Do error, empty, and edge states match hero quality? | **Fail** | Import errors vanish after 2 s (`ImportSong.tsx:86-90`); YouTube "No results found" shows while you're still typing, before any search (`YouTubeSearch.tsx:343`); "← Dashboard" on Prep silently drops unsaved part edits (`PrepScreen.tsx:101`); "Add to set" on a song already in the set does nothing, with no feedback (`Dashboard.tsx:37`); Perform with no parts shows only "Choose a part". |
| 7 | Would the team proudly use it daily and sign it? | **Fail** | Off-brand palette and logo; competing filled buttons on every screen (Library 3, Tap 3: Prep, Play, Tap the 1); Perform's "Jump now" links sit 8 px under every pad. |

Passes 3/7 → **4/10**. Failed rows: 2, 5, 6, 7.

## Cut list (candidates, not a plan)

Flow-wide
- "← Dashboard" on Tap, Prep, Perform: the screen is called Library in PRODUCT.md and in the Library's own copy ("Add songs from the library"). One name, one look, everywhere.
- Play/Pause: three different looks for one action (green filled on Tap, gray with the time inside the label on Prep, big green on Perform). Make it one quiet control; the time sits next to it, not in its name.
- "Edit" (ready songs, Library) and "Prep" (tapped songs, Library; Tap's forward button) open the same screen. One name: Prep.
- Re-tap appears twice per song row on Library; it's a step back from Prep. It belongs beside Prep's grid summary.
- Bar counts on Tap ("30 downbeats", the Downbeats list) duplicate Prep's "30 bars" and timeline.
- "Pickup and fades are set in Prep." on Tap: an instruction that apologizes for the flow.

Library
- Blue music-note icon in the header (decoration; adds a hue).
- Song count "2" beside "Your songs" (a number that changes nothing).
- Icons inside the import tabs (repeat their labels; force the labels to wrap onto two lines at xl).
- Demo tab: the 64 px sparkles icon, the heading that repeats the tab and button, "Perfect for testing the looper features" (old looper framing), and "Includes auto regions: Intro • Verse • Chorus • Bridge" (inaccurate: the demo came out Intro, V1, Chorus, V2), "120 BPM • 4/4 Time • Clear beat markers".
- Local File: the 64 px upload icon, "Or click the button below to browse", the icon inside "Choose Audio File".
- YouTube: two tab rows nested (import tabs, then Search / Direct URL). Search and paste-a-link are one intent; one box can tell a link from a query. Views count and clock icon on results. The duplicate empty-results messages.
- Four different filled colors for one intent ("get a song"): blue Search, green Download & Analyze, blue Choose Audio File, yellow Generate Demo Track.
- Per-row filled "Perform" ×N plus "Perform this set": one filled action per view.
- Nested cards: song rows and set rows are bordered cards inside bordered cards.
- "· Ready" after every set-list song (only the unready ones need a status).

Tap
- Three filled buttons (Prep, Play, Tap the 1). Only "Tap the 1" should be filled.
- Downbeats list: 30+ rows of "Bar N · 0:00". Past bar 8 new taps land below the scroll fold, so it doesn't even confirm taps.
- "Use my taps" when the grid already is your taps (does nothing visible).
- "120 BPM" said three times when locked (verdict, Lock button, locked line).

Prep
- "Beat length about 0.50s." in the part description (a number that drives no decision).
- Time inside the Play label ("Play · 0:13"): its accessible name changes every second.

Perform
- "Tap to queue" printed on every pad.
- "Queued" on the pad vs "Up next" in the panel: two names for one state.
- Purple "Up next" panel (purple-950 / purple-200: the detector's AI-palette hit) and blue-200 part name: extra hues on the one screen that must be calm in a dim room.
- Big green Play: competes with the pads; Space is the main control.
- "Jump now" styled as an underlined link but it's a button.

## Fix list (ranked; fixes that cut are already candidates above, the rest are follow-ups)

1. **Perform mid-song safety** (Perform, `PerformScreen.tsx:60`, `:81-85`, `:112-114`): "← Dashboard" and "Next song" stop or switch the song in one click while it plays; "Jump now" is a 16 px target 8 px below each pad. Fix direction: guard leave/next while playing; give Jump now real spacing or a modifier. (Additions, so follow-ups.)
2. **Palette vs brand** (all screens): replace stock blue/emerald/purple with a warm lamp palette. (Addition/redesign, so follow-up. The cut pass can only reduce hue count.)
3. **Prep loses work** (`PrepScreen.tsx:101`): back link discards edits with no warning. Fix direction: save-or-discard choice. (Follow-up.)
4. **Prep has no Space shortcut** (keyboard-first per PRODUCT.md). (Follow-up.)
5. **Import errors vanish in 2 s** (`ImportSong.tsx:86-90`, `:130-134`, `:230-234`, `:282-286`). (Follow-up.)
6. **Part boundaries can't be edited in Prep** (no start/end bar control). PRODUCT.md says Prep should feel like a track editor (cut, snap, fade). (Follow-up.)

## Back of the fence

- Error copy flashes and disappears (import), or appears before it's true (YouTube "No results found" while typing).
- "Add to set" silently no-ops for songs already in the set.
- Bar tick labels on the Prep timeline are 10 px gray-500 on gray-800, effectively invisible.
- White pad text on lime and amber part colors on Perform is low contrast in a dim room.
- Unreachable code still ships: App.tsx `player` and `stage` views, WaveformPlayer, TransportControls, RegionEditor, LoopManager, BeatGridView, SettingsPanel, StageMode, LoopSettingsControl, LibraryView.

**Next review:** after this subtraction pass: same cold walk, same viewports, score the same 7 rows.
