# Critique: Lampcircle flow (Library → Tap → Prep → Perform)
Date: 2026-10-05 · `impeccable critique`, run inside ui-subtract flow mode (evidence only; nothing here was applied directly) · Register: product

**Sources**
- **Assessment A (LLM design review):** a separate sub-agent, in its own browser tab, with no view of Assessment B. Read all four screens' code plus PRODUCT.md, walked the live flow at 1440×900 and a tablet size. Full report kept verbatim in the appendix.
- **Assessment B (deterministic detector):** `npx impeccable --json` on `Dashboard.tsx ImportSong.tsx YouTubeSearch.tsx TapScreen.tsx PrepScreen.tsx PerformScreen.tsx App.tsx` (exit 2, 2 findings).
- **Skipped:** the browser overlay (`npx impeccable live` plus injecting `detect.js`). The ui-subtract file rule forbids `impeccable live` and overlay injection, so per its fallback this critique continues with CLI results only.
- Orchestrator's own render notes (same build, page 4): Space on Perform toggled play without re-firing the focused pad; Library tab labels wrap to two lines at 1440; the YouTube placeholder is cut off at xl.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Tap's live verdict is excellent. Prep never shows unsaved changes; "Add to set" gives no feedback; Perform's playing state is only the button label; nothing counts down to a queued landing. |
| 2 | Match System / Real World | 2 | Musician words are great ("Tap the 1", "Singers enter", "Lands"). Jargon leaks: "Use detected grid", "Snap to detected hits", ".djw", "regions", "looper features", "npm run dev … port 3001". |
| 3 | User Control and Freedom | 2 | Undo on taps, tap-again-to-cancel, back links everywhere. But Prep's back link drops unsaved edits, Delete part has no undo, and any touch in Re-tap resets Prep work. |
| 4 | Consistency and Standards | 1 | Four container widths, three Play styles, Space means three things, two save models, home called Library / Dashboard / nothing, two greens. |
| 5 | Error Prevention | 1 | Perform: pads shift 124 px when a part is queued, 16 px "Jump now" under each pad, Space is a hard stop, M plays the click into the room, Back and Next song end the song in one tap. |
| 6 | Recognition Rather Than Recall | 2 | Section keys I V C B T O appear only in a sentence (no on-screen buttons, so touch can't mark sections); M is shown nowhere; duplicate song names can't be told apart. |
| 7 | Flexibility and Efficiency | 2 | Tap and Perform have keys; Prep has none, not even Space; Tap's Play has no key; no set reorder. |
| 8 | Aesthetic and Minimalist Design | 2 | Perform is sparse but its hierarchy is inverted; Library is three boxed columns with nested cards; Tap dumps 30 downbeats. |
| 9 | Error Recovery | 2 | The helper message names a fix, in developer language; import errors vanish after 2 s; "No results found" shows before you search. |
| 10 | Help and Documentation | 2 | Inline hints on Tap and a Prep sentence; nothing on Perform; nothing explains Lock vs Use my taps. |
| **Total** | | **18/40** | **Poor** (one point from Acceptable). The core path works; the product's top principle (Perform safe from mistakes) is not met. |

## Anti-Patterns Verdict

**LLM assessment:** Yes, you'd believe AI made it at first glance. It is the default Tailwind dark dashboard: gray-900/800 surfaces with gray-700 borders; blue-600 and emerald-600 filled buttons, a purple-950 panel, a yellow-900 warning; a blue-500 lucide `Music` icon as the logo (`App.tsx:328`); `Sparkles` plus a yellow button on the Demo tab (`ImportSong.tsx:363,426,436`); the system font stack; three equal bordered card columns (`Dashboard.tsx:58`); nested cards (song card in section card; helper warning in a box in a card); the raw Tailwind 500 rainbow for parts and pads (red first, so Intro is red). It fails the category-reflex test ("music tool → dark plus neon pads"). Nothing is warm. Absent: gradient text, glassmorphism, glows, hero metrics, side stripes. Copy has no em dashes; "Done!" and "Demo ready!" are off-tone.

**Deterministic scan (2 findings):**

| Detector rule | Location | Verdict |
|---|---|---|
| `ai-color-palette` (slop): "text-purple-200 on heading" | `PerformScreen.tsx:90` (the Up next part name on a purple-950 panel) | **Agrees with A.** True positive. |
| `gray-on-color` (quality): "text-gray-400 on bg-emerald-600" | `Dashboard.tsx:163` ("Perform this set") | **False positive.** The gray text is `disabled:text-gray-400` and only ever renders on `disabled:bg-gray-700`; it never sits on emerald. |

The detector missed what A found by reading and rendering: nested cards, three filled buttons per screen, the duplicate queue indicators, the icon-only trash control, and every behavior issue on Perform. Nothing the detector caught was missed by A.

**Visual overlays:** not run (file rule; see Sources).

## Overall Impression

The flow works end to end and its primitives are right: tap the 1, queue on the beat, tap again to cancel. It looks like a stock dark Tailwind template rather than a lamp-lit room. The biggest opportunity is Perform: the screen PRODUCT.md says must be safe and calm is the least safe, and it carries the most stray color.

## What's Working

1. **Musician's language in the core primitives.** Numbered pads that match their keys; tap-to-queue and "Queued · tap to cancel"; "Up next"; "Singers enter / Lands"; "Tap the 1".
2. **Tap's live verdict** ("Keep tapping. 3 bars so far.", "Steady 120 BPM. Likely a click track.") is the best copy in the app: calm, plain, says what the system concluded.
3. **Some guardrails exist.** "Perform this set" stays disabled and says why ("1 song still needs prep"); delete confirms with the song's name; Prep shows its inspector only for the selected part.

## Priority Issues

**[P0] Perform is not safe mid-song**
- **What:** queuing inserts "Up next" above the pads (`PerformScreen.tsx:87-95`) and shifts every pad down 124 px; "Jump now" (`:112-114`) is a 16 px underlined link 8 px under each pad and cuts immediately; Space is a hard stop with no fade (`useAudioPlayer.ts` pause → `stopAllSources`); M / "Click on/off" (`:47,78-80`) routes the click to the same output as the music; "← Dashboard" (`:60`) and "Next song" (`:81-85`) end the song in one tap.
- **Why it matters:** PRODUCT.md's first principle is "safe from mid-song mistakes (wrong pad, accidental stop)".
- **Fix:** keep the pads from moving (fixed slot for Up next, or show it elsewhere); make Jump one deliberate control; fade on pause; separate the click; guard Back and Next song while playing.
- **Suggested command:** `$impeccable harden` (behavior), `$impeccable distill` (layout shift, duplicate indicators).

**[P1] Silent data loss between Tap and Prep**
- **What:** any action in Re-tap on a Ready song rewrites the phase to `tapped` (`TapScreen.tsx:52-65,168-177`), drops it to "Needs prep" (disabling "Perform this set"), and the next Prep visit rebuilds parts from marks, resetting pickups, fades, loop and colors (`PrepScreen.tsx:21`). Prep's back link discards unsaved edits (`:101`).
- **Why it matters:** careful prep is lost silently and the loss shows up at the performance.
- **Fix:** autosave Prep; preserve part settings when the start bar is unchanged; warn before Re-tap downgrades a Ready song.
- **Suggested command:** `$impeccable harden`.

**[P1] Perform hierarchy is inverted and the palette is against the brand**
- **What:** title text-6xl, bar text-2xl, current part text-xl blue-200 (`:68-72`); saturated 500 pads with white text (contrast red 3.76:1, orange 2.80, amber 2.15, lime 1.98); active vs queued is a 2 px ring.
- **Why it matters:** a glance should answer "where am I, what's next, when", not "what song is this".
- **Fix:** smaller title; current part and a bar countdown largest; dim warm pads with light text; state by brightness.
- **Suggested command:** `$impeccable quieter`, `$impeccable typeset`, `$impeccable colorize`.

**[P1] Library gives the rare task the prime spot and opens on a developer error**
- **What:** `xl:grid-cols-3` gives "Get a song" equal weight (on tablet it fills the first 950 px); YouTube is the default tab, so under `dev:client` the first content is "YouTube helper is not running … npm run dev … port 3001"; three tabs with icons, then two sub-tabs; five actions per ready card; per-song emerald Perform next to "Perform this set".
- **Fix:** songs first, set beside; import compact; one "search or paste a link" field; demo out of the way; one primary.
- **Suggested command:** `$impeccable distill`, `$impeccable layout`.

**[P2] Prep is a form, not a track editor, and has no keyboard**
- **What:** no waveform or playhead; bar numbers hidden (10 px gray-500); 30 bar buttons named "1"…"30" before the parts; ~930 px-wide number fields; no drag, no add part, no shortcuts.
- **Fix:** waveform + playhead, draggable bar-snapped boundaries with fade handles, Space/arrows/split key, compact steppers.
- **Suggested command:** `$impeccable shape` (it's new capability, not a cut).

## Persona Red Flags

**Worship leader mid-song** (project persona: guitar on, tablet ~1.5 m away, lamp light, eyes on people, glances under 1 s): the title is the largest text and the part is 20 px pale blue with no countdown; queuing moves every pad 124 px; Space cuts the music; M puts a click over the room; "← Dashboard" stops everything; a slightly low tap on a pad hits Jump now; amber and lime pad text is unreadable at distance; playing and paused look the same apart from one word; on tablet portrait the bottom 55% is empty.

**Alex (power user, keyboard-first):** Prep has zero shortcuts; Tap's Play has no key; 30 tab stops through the Prep ticks; no set reorder; "Add to set" on a song already in the set does nothing.

**Riley (stress tester):** Re-tap downgrades a song and wipes its Prep settings; Prep's back link discards edits; two "Demo Track - 120 BPM" songs can't be told apart; import errors vanish after 2 s (`ImportSong.tsx:86-90`); "No results found" appears while typing (`YouTubeSearch.tsx:343`); Library card height jumps between tabs.

**Sam (screen reader / keyboard):** four identical "Jump now" names; concatenated pad names ("1 Intro Tap to queue"); bar buttons named only by number; no `aria-pressed` for part selection; bar/beat and Up next aren't live regions; section marking has no on-screen control.

## Cross-screen consistency mismatches
- Width: Library 7xl, Tap 3xl, Prep none, Perform 5xl.
- Header on Library only; its right side holds only dead player-view buttons (`App.tsx:333-350`).
- Home is "Library" (PRODUCT.md, view name) but every back link says "← Dashboard".
- Back link `text-sm` on Tap and Prep, `text-base` on Perform.
- Play/Pause: emerald filled (Tap), gray "Play · 0:00" with the time inside (Prep), emerald filled + Space (Perform).
- Space: taps (Tap), nothing (Prep), play/pause (Perform).
- To Prep: "Prep" vs "Edit". To Tap: "Tap in" vs "Re-tap".
- Saving: Tap autosaves every action; Prep needs an explicit save and its back link discards.
- Terms: regions (import, demo) / sections (Tap) / parts (Prep, Perform).
- Greens: emerald-600 vs green-600 ("Download & Analyze").
- Filled buttons: Library 3+ (up to 6 hues across tabs), Tap 3, Prep 1, Perform 1 plus pads, blue-200 and purple.

## Subtraction candidates (combined)
The full candidate tables (with file:line and suggested verbs) are in Assessment A's section 8 in the appendix. Every one of them is carried into the flow or screen ledgers as a row, including the ones kept.

## Minor Observations
- Library tabs wrap to two lines at 1440 ("YouTube / Search").
- Prep shows a pointless horizontal scrollbar at 1440 (1392 vs 1390).
- BPM duplicated in the demo name and its metadata.
- Native `confirm()` is off-brand but works.
- Header `px-4` vs main `p-6` misaligns the logo by 8 px.
- Emerald means both status ("Locked at") and action (Play).
- Emotional arc: a yellow "something's broken" first impression, a focused Tap, form-filling Prep, an unprotected Perform peak, an abrupt end (Back stops the music and lands on a busy dashboard).

## Questions to Consider
1. If his eyes are on people, should Perform show the title at all?
2. Is Tap just the first pass on Prep's timeline? Merging them removes a screen, a handoff, a back link and the destructive Re-tap.
3. Does single-song Perform need to exist apart from a set of one?
4. Should Perform own the metronome when it shares the room speakers with the music?

## Ask the User (answered in auto mode)
ui-subtract auto mode answers critique's questions from the frame and PRODUCT.md and logs them here instead of stopping:
- **Priority direction:** subtraction and focus.
- **Scope:** all subtraction issues.
- **Off-limits:** each screen's primary action and cut-list's numbered guardrails.
- **Design intent:** judged against PRODUCT.md's personality (warm, quiet, intimate, never flashy). The stock cold palette conflicts with it, so it is treated as unintentional.
- Critique's closing "Recommended Actions" offer is addressed to the user and was skipped.

---

## Appendix: Assessment A, verbatim

(Delivered by the A sub-agent. Its screenshots were viewed inline only; the MCP server refused the scratchpad path.)

**Bottom line:** The flow works end to end, and its core ideas are right: tap the 1, queue on the beat, tap again to cancel. But it reads as a stock dark Tailwind template, not a lamp-lit room. Perform is the screen the product says must be safe, and it is the least safe: pads jump 124px when a part is queued; Space cuts the music dead; the metronome plays through the room speakers; 16px "Jump now" links sit right under every pad. Score is 18/40 (Poor, one point from Acceptable). Cognitive load fails 7 of 8 checks (critical).

**Test notes:** Prep → "Perform" re-saved demo song #1 with its parts unchanged. Space played, then paused. The queued part was cancelled before leaving. Nothing was deleted, tapped, or removed from the set list. emulate() reloads the page; the tablet pass went Library → Perform (per-song button) → Edit.

### Cognitive load: 7 of 8 fail (critical)
- Single focus: fail. Import, a rare task, gets an equal column, and the top 950px on tablet. Tap has 3 filled calls to action.
- Chunking: fail. 5 actions per song card; Tap's tool row has 5 controls.
- Grouping: pass. If anything, over-boxed.
- Visual hierarchy: fail. Perform title 60px versus current part 20px. Library has 3 equal columns and 3 emerald buttons at once.
- One thing at a time: fail. Tap asks for tapping, grid strategy, meter, snap, and section marks together.
- Minimal choices: fail.
- Working memory: fail. Memorized section keys, Space changes meaning between screens, duplicate names.
- Progressive disclosure: fail. Import is always open and the full downbeat list is always shown. Prep's selected-part inspector is the one good example.

| Screen | Controls at once |
|---|---|
| Library, ready song card | 5 (Re-tap, Edit, Perform, Add to set, Delete); about 15 on screen with 2 songs |
| Library, helper up | 3 tabs, then 2 sub-tabs, then input + Search, then 2 buttons per result |
| Tap | 10 visible plus 6 hidden keys |
| Prep | 13 controls plus 30 bar buttons, each a tab stop |
| Perform | 4 + 2 per part: 12 for the demo, 22 for a 9-part song, mid-song |

### Subtraction candidates (A, section 8)

**Library**

| file:line | Element | Verb | Reason |
|---|---|---|---|
| App.tsx:325-353 | App header | Remove or merge | One screen only; right side serves the dead player view. A quiet wordmark in main is enough. |
| App.tsx:328 | Blue-500 Music logo | Remove | Generic icon, stray blue. |
| App.tsx:211-245, 309-317, 333-350, 366-609 | Player and stage code, player shortcuts | Remove (code) | Unreachable; keeps "looper" ideas in the copy and bundle. |
| Dashboard.tsx:58 | 3 equal columns | Restructure | Songs lead, set beside, import demoted. |
| Dashboard.tsx:59-62 | "Get a song" card | Demote or move | One-time task; a compact row or a Library-wide drop zone. |
| Dashboard.tsx:67 | Song count | Remove | Noise. |
| Dashboard.tsx:80-83 | Status · duration · BPM | Demote | Status repeats the buttons; BPM repeats the name. Show status only when not Ready. |
| Dashboard.tsx:85-96 | Trash per card | Move | Overflow menu or Prep. |
| Dashboard.tsx:108-112, 115-117 | Re-tap | Move | Overflow or Prep; a destructive redo shouldn't sit as a peer of Perform. |
| Dashboard.tsx:118-120 | Edit | Rename or merge | Call it "Prep", or open Prep by tapping the row. |
| Dashboard.tsx:121-127 | Per-song Perform | Merge or demote | A set of one; leaves one primary Perform. |
| Dashboard.tsx:130-132 + 153-155 | Add to set + Remove | Merge | One "In set ✓" toggle with feedback. |
| Dashboard.tsx:151 | " · Ready" in set rows | Remove when Ready | Show only the exception. |
| ImportSong.tsx:21 | Default tab youtube | Default to file | Local-first, works offline. |
| ImportSong.tsx:327-367 | 3 tabs with icons | Merge | One drop zone with Choose file, plus a link field when the helper is up. |
| ImportSong.tsx:354-366, 424-446 | Demo tab (Sparkles, yellow, "testing the looper features") | Hide | Dev-only; stale copy. |
| ImportSong.tsx:371 | 64px spinner | Demote | Inline progress text. |
| ImportSong.tsx:391 | 64px upload icon | Remove | Decorative. |
| ImportSong.tsx:395-399 + 418-420 | Two lines saying the same thing | Merge | One line. |
| ImportSong.tsx:36, 153 | "Suggesting regions..." | Remove | Regions unused for imported songs; auto-analyze is out of scope. |
| ImportSong.tsx:78, 122, 222 | "Done!" / "Demo ready!" | Replace | Highlight the new song and its Tap in. |
| index.css:161-163 | min-height 400px | Remove | Empty box, jumping tab heights. |
| YouTubeSearch.tsx:157-178 | Helper-down warning (nested twice) | Hide or demote | Developer copy. |
| YouTubeSearch.tsx:182-199 | Search / Direct URL sub-tabs | Merge | One field that detects links. |
| YouTubeSearch.tsx:263-265 | URL helper text | Remove | Repeats the placeholder. |
| YouTubeSearch.tsx:303-305 | View counts | Remove | Irrelevant. |
| YouTubeSearch.tsx:328-336 | Open button | Demote | Make the thumbnail the link. |
| YouTubeSearch.tsx:248, 313 | green-600 "Download & Analyze" | Repair | Second green; "Analyze" is out-of-scope wording. Use "Add song". |
| YouTubeSearch.tsx:343-347 | "No results found" | Repair | Shows while typing; duplicates the line-70 error. |

**Tap**

| file:line | Element | Verb | Reason |
|---|---|---|---|
| TapScreen.tsx:150-157 | Blue Prep | Keep, gate | Hide or ghost until the grid is usable. |
| TapScreen.tsx:161 | Instruction sentence | Repair | Visible, tappable key chips for I V C B T O. |
| TapScreen.tsx:168-183 | Meter select | Move | To Prep's metadata line; changing it silently downgrades a Ready song. |
| TapScreen.tsx:195-197 | Use detected grid | Hide | Fallback; "More options". |
| TapScreen.tsx:198-208 | Lock + Use my taps | Merge or default | Auto-lock when steady, with a "Locked / Follow my taps" toggle. Lock stays active after locking today. |
| TapScreen.tsx:212-215 | Snap checkbox | Default on, hide | Rarely changed. |
| TapScreen.tsx:217 | Emerald "Locked at" line | Merge | Into the verdict. |
| TapScreen.tsx:219-227 | Downbeats list (30 rows) | Remove | Raw dump; a count or bar strip. |
| TapScreen.tsx:228-240 | Sections list | Keep, repair | Read-only today; allow rename and delete. |
| TapScreen.tsx:242 | "Pickup and fades are set in Prep." | Remove | Prep is next anyway. |
| TapScreen.tsx:145 | max-w-3xl | Repair | Shared width. |

**Prep**

| file:line | Element | Verb | Reason |
|---|---|---|---|
| PrepScreen.tsx:103 | Export .djw | Move | Library song overflow; keep the feature. |
| PrepScreen.tsx:104-106 | Save · mark ready | Remove | Autosave; ready follows from having parts. |
| PrepScreen.tsx:119-121 | Play · 0:00 | Repair | Match Play elsewhere, add Space, time beside. |
| PrepScreen.tsx:129-141 | 30 bar tick buttons | Demote | One seek surface; fix hidden labels; add a playhead. |
| PrepScreen.tsx:176-211 | Wide pickup and fade fields | Repair | Steppers or timeline handles. |
| PrepScreen.tsx:247 | "Beat length about 0.50s." | Remove | Debug info; keep Singers enter / Lands. |
| PrepScreen.tsx:223-232 | Delete part | Keep, repair | Add undo; no add part exists to recover. |
| PrepScreen.tsx:99 | No max width | Repair | Shared width. |

**Perform**

| file:line | Element | Verb | Reason |
|---|---|---|---|
| PerformScreen.tsx:68 | 60px title | Demote | He knows the song. |
| PerformScreen.tsx:72 | Current part, 20px blue-200 | Promote | Should be the largest element. |
| PerformScreen.tsx:47 (m) + 78-80 | Click on/off and M | Move or remove | Plays into the room; the label reads as an instruction. |
| PerformScreen.tsx:81-85 | Next song | Repair | Queue it for song end, or enable only when stopped; move it from Pause. |
| PerformScreen.tsx:87-95 | Purple Up next panel | Merge or fix | Fixed slot, or on the queued pad; drop the purple. |
| PerformScreen.tsx:92 | Three m:ss times | Demote | One bar countdown. |
| PerformScreen.tsx:110 | "Tap to queue" on every pad | Remove | Keep only the queued state label. |
| PerformScreen.tsx:112-114 | Jump now × N | Remove (move) | One deliberate control or a long-press. |
| PerformScreen.tsx:60 | ← Dashboard | Keep, guard | Hold or confirm while playing; rename to Library. |
| PerformScreen.tsx:57 | bg-gray-950 | Repair | Warm-tinted dark, shared with the other screens. |

**Must stay (A):** Library: song list with a per-phase next action; set list plus "Perform this set" with its disabled reason; file and .djw map import; delete with confirm. Tap: Play/Pause, Tap the 1 plus Space, live verdict, Undo, section marking, the Prep handoff. Prep: part timeline with click-to-seek; Name, Pickup, Fade in, Fade out, Loop, Delete; the Perform handoff; .djw export. Perform: numbered pads with number keys and tap-to-queue/cancel; current part plus bar/beat; queued indicator; Play/Pause plus Space, made safe; "Song x of y" and next song; guarded back.
