# Cut list (flow): Library → Tap → Prep → Perform
Date: 2026-10-05 · Mode: auto · Evidence: code + render (Chrome DevTools MCP, 1440×900 and 820×1180, fresh profile + two demo songs; YouTube helper both down and up) · Inputs: `2026-10-05-library-to-perform.critique.md`, `2026-10-05-library-to-perform.jobs-before.md`
Baseline: external git dir `/Users/kk/Projects/_scratch/lampcircle-ui-subtract-2026-10-05/repo.git`, commit `af1de67`, clean working tree.

**Flow job:** Take a recorded song from import to a live performance where every part change lands on the beat.
**Mainstream user:** One worship leader (Kevin). Imports and maps songs calmly on a laptop during the week; performs on a laptop or tablet in a dim living room, eyes on people. (PRODUCT.md)
**Primary path:** Library → Tap → Prep → Perform.

| Screen | Job | Primary action |
|---|---|---|
| Library | Keep the songs, send each one to its next step, line up tonight's set | Perform this set (assumed: no usage data; the Library's one decisive action and the flow's goal). Secondary, kept reachable without primary styling: get a song, open a song at its next step (Tap in / Prep / Perform), build the set, delete. |
| Tap | Turn the recording into a bar grid by tapping the 1s, and mark sections | Tap the 1 (button or Space) |
| Prep | Shape the parts (name, pickup, fades, loop) and hand off | Edit the selected part, then Perform |
| Perform | Queue the next part so it lands on the beat, eyes on the room | Queue a pad (click or number key) |

**Removals are expected. Every element must earn its place. Propose cuts before additions.** Additions are out of scope and go to Follow-ups.

## Cross-screen inventory

Things on two or more screens, and values one screen hands to the next.

| Element / value | Library | Tap | Prep | Perform |
|---|---|---|---|---|
| Back to Library | (home) | "← Dashboard" `TapScreen.tsx:147` | "← Dashboard" `PrepScreen.tsx:101` | "← Dashboard" `PerformScreen.tsx:60` (no `text-sm`) |
| Play / Pause | — | green filled "Play/Pause" `TapScreen.tsx:164` | gray "Play · 0:00" (time inside label) `PrepScreen.tsx:119` | big green "Play/Pause" `PerformScreen.tsx:75` |
| Open Prep | "Prep" (tapped) / "Edit" (ready) `Dashboard.tsx:105,119` | blue filled "Prep" `TapScreen.tsx:150` | (here) | — |
| Open Tap | "Tap in" / "Re-tap" ×2 `Dashboard.tsx:105,110,116` | (here) | — | — |
| Perform | green "Perform" per row + "Perform this set" `Dashboard.tsx:121-127,160-169` | — | green "Perform" `PrepScreen.tsx:107` | (here) |
| Song title | row name | h2 text-3xl | h2 text-3xl | h1 text-4xl/6xl |
| BPM | row meta `Dashboard.tsx:82` | verdict, Lock label, locked line `TapScreen.tsx:141,204,217` | summary `PrepScreen.tsx:116` | — |
| Bar count / downbeats | — | "N downbeats" + Downbeats list `TapScreen.tsx:217,219-227` | "N bars" + timeline ticks `PrepScreen.tsx:116,126-143` | Bar.beat readout |
| Meter | — | select `TapScreen.tsx:168-183` | read-only in summary | used, not shown |
| Section marks → parts | — | Sections list `TapScreen.tsx:228-240` | part blocks + editor | pads |
| Pickups / fades | — | note "Pickup and fades are set in Prep." `TapScreen.tsx:242` | editor fields | "Fade … Singers … Lands …" in Up next |
| Phase status | "Needs tap / Needs prep / Ready" row + set list | — | "Save · mark ready" | — |
| Keyboard hints | — | instruction line `TapScreen.tsx:161` | none | pad numbers 1–9 |
| Space key | none | tap | none | play/pause |
| Page shell | App header bar (logo + wordmark) | bare | bare | bare, darker (gray-950) |
| Container width | max-w-7xl | max-w-3xl | full width | max-w-5xl |

## Flow ledger

| # | Element | Screens it's on | Verdict | Home / where it goes | Test | Risk | Verify | Approval | Result |
|---|---|---|---|---|---|---|---|---|---|
| F1 | Back link "← Dashboard" | Tap, Prep, Perform | **share** + rename to "← Library": one `BackLink` component, identical look (`text-sm text-gray-300`) on all three | Top-left of each screen, as today | Same intent and same destination on three screens, with two looks (Perform's lacks `text-sm`). The name contradicts PRODUCT.md ("Library → Tap → Prep → Perform") and the Library's own copy ("Add songs from the library"). | low | On Tap, Prep, Perform the link reads "← Library" and returns to Library. Perform: leaving still stops playback exactly as before (no new behavior). | auto | done (`FlowControls.tsx` BackLink; Tap, Prep, Perform) |
| F2 | Play / Pause toggle | Tap, Prep, Perform | **share** + demote: one `PlayButton` component; label is only "Play" / "Pause"; neutral filled (`bg-gray-700`), Perform's current touch size kept (`px-6 py-3 text-lg`) | Same spot on each screen. Prep's time moves out of the label into plain text beside the button. | Same action, three looks. One primary-styled action per view: Tap's is "Tap the 1", Perform's are the pads. Prep's label "Play · 0:13" changes its accessible name every tick. | med (Perform's Play gets quieter) | Click Play on Tap, Prep, Perform: audio starts, label flips to Pause. Perform: Space still toggles; Tap: Space still taps. Prep: time still visible next to the button. | auto | done (`FlowControls.tsx` PlayButton; Prep time moved beside it) |
| F3 | Name of the "open Prep" action: "Edit" (ready rows) vs "Prep" (tapped rows, Tap's forward button) | Library, Tap | **merge** names → "Prep" | Library ready row | Same destination (PrepScreen), same scope (one song), two names. | low | Library ready row shows "Prep" and opens Prep for that song. | auto | done |
| F4 | "Re-tap" on Library rows (tapped and ready songs) | Library | **move** → Prep: a text-style button "Re-tap" at the end of Prep's grid summary line ("30 bars · 120 BPM locked · 4/4 · Re-tap") | Prep (exists; it shows the grid Re-tap would redo). Needs-tap rows keep "Tap in". | Re-tap is a step back from Prep. Today Prep has no way back to Tap, so the only path is via Library. Library ready rows sit at 5 actions (warn band 4–5). Tiny wiring: a new `onRetap` prop on PrepScreen and `onRetap={() => setView('tap')}` in App.tsx's prep wrapper. No hook/lib change. | med | Library ready row: Prep, Perform, Add to set, Delete. Tapped row: Prep, Add to set. From Prep, Re-tap opens Tap for the same song; Tap's "Prep" returns. | auto | done (`onRetap` prop + one line in App.tsx prep wrapper) |
| F5 | Bar count + Downbeats list | Tap (locked line "N downbeats", list of "Bar N · 0:00"), Prep (summary "N bars", timeline ticks) | **home**: Prep. Remove the Downbeats list and the "N downbeats" count from Tap. | Prep summary "N bars" and the timeline. While tapping, Tap's verdict still says "Keep tapping. N bars so far." | The list drives no decision on Tap, and past bar 8 new taps land below its scroll fold, so it doesn't even confirm taps. | low | Tap: tap 4 times, verdict updates. Prep: "N bars" and ticks match. | auto | done (list, its grid, and the count removed) |
| F6 | "Pickup and fades are set in Prep." | Tap (about Prep's controls) | **home**: Prep. Remove the note from Tap. | Prep's part editor (Pickup beats, Fade in, Fade out) | An instruction that apologizes for the flow; Prep is the next button. | low | Prep still shows the three fields. | auto | done |
| F7 | "Perform" action look | Library rows, Library set button, Prep | **demote** the Library row "Perform" to neutral (`bg-gray-700`); keep filled emerald only where it is that view's single primary ("Perform this set" on Library, "Perform" on Prep). Names unchanged. | Library row keeps its spot (Library ledger #47 points here) | One primary-styled action per view beats "same look" here; the row action and the set action have different scopes (one song vs the set), so they are not merged. | low | Library: one emerald button. Prep: one emerald button. | auto | done |
| F8 | BPM | Library, Tap, Prep | keep | Library (set planning), Tap (where tempo is found), Prep (read-only context). Tap's internal repeats are handled in the Tap ledger. | Serves real decisions on each screen. | — | — | — |  |
| F9 | Meter | Tap (select), Prep (read-only) | keep | Home is Tap (editable); Prep already shows a read-only chip. | Already follows the home rule. | — | — | — |  |
| F10 | Section marks → parts → pads | Tap, Prep, Perform | keep | Handoff value: set on Tap, edited on Prep, played on Perform. | Core flow (guardrail 9). | — | — | — |  |
| F11 | Song title | Tap, Prep, Perform | keep | Perform's title is demoted one step in the Perform ledger (#4) but stays the page's h1. | Identity of each screen. | — | — | — |  |
| F12 | Phase status names (Needs tap / Needs prep / Ready) | Library rows, set list, Prep's "Save · mark ready" | keep | — | Consistent already. | — | — | — |  |
| F13 | Keyboard hints (Tap instruction line, Perform pad numbers) | Tap, Perform | keep | — | Keyboard-first is core (PRODUCT.md, guardrail 9). | — | — | — |  |
| F14 | Space key meaning: tap on Tap, play/pause on Perform, nothing on Prep and Library | Tap, Prep, Perform | keep (Space = tap is the Tap screen's identity). Prep's missing Space → Follow-ups (addition). | — | Consistency mismatch that a cut can't fix. | — | — | — |  |
| F15 | App header bar (logo + "Lampcircle") on Library only | Library | keep the shell; its icon is handled in the Library ledger (#1) | Library is home; the other screens are focused tasks. | Different shells match different jobs. | — | — | — |  |
| F16 | Container widths (Tap 3xl, Prep full, Perform 5xl): back and forward controls jump sideways between Tap and Prep | Tap, Prep, Perform | keep (log) → Follow-ups | — | Fixing it is a layout change, not a cut. Each screen still puts back top-left and forward top-right. | — | — | — |  |
| F17 | Save model: Tap saves every action; Prep saves only on "Save · mark ready" or "Perform", and its back link discards | Tap, Prep | keep (log) → Follow-ups | — | Critique consistency finding. Making Prep autosave is a behavior addition. F4 puts Re-tap on Prep, where it drops unsaved edits the same way the back link does today. | — | — | — |  |
| F18 | Terms: "regions" (import progress, demo copy), "sections" (Tap), "parts" (Prep, Perform) | Library, Tap, Prep, Perform | keep "sections" on Tap and "parts" on Prep/Perform (PRODUCT.md itself says "flag sections" and "map it into parts"); "regions" leaves the demo copy via Library #35 | — | Critique consistency finding; the remaining split matches the product's own words. | — | — | — |  |
| F19 | "Tap in" (needs-tap rows) vs "Re-tap" (after F4, Prep) | Library, Prep | keep both names | — | Critique consistency finding. Different situations (first pass vs redo), so different names are right. | — | — | — |  |

## Consistency

| Action | Before | After (projected) |
|---|---|---|
| Back to Library | "← Dashboard", two sizes | "← Library", one component (F1) |
| Play / Pause | three looks; Prep's name includes time | one component, neutral, "Play"/"Pause" only (F2) |
| Open Prep | "Prep" or "Edit" | "Prep" everywhere (F3) |
| Open Tap from a mapped song | Library row only | Prep summary line (F4); needs-tap rows keep "Tap in" |
| Queue state on Perform | "Up next" (panel) vs "Queued" (pad) | "Up next" on both (Perform ledger) |
| Get a song (import CTAs) | blue Search, green Download & Analyze, blue Choose Audio File, yellow Generate Demo Track | one neutral look (Library ledger) |

## Handoffs

Steps from start to the flow's primary job (first queued part on a real song): Local File tab → Choose Audio File → Tap in → Play → tap 8+ bars (or Lock) → Prep → Perform → Play → queue a pad = **10**. Projected after: **10** (subtraction doesn't remove real work here; Library's next step stays one click).

Each screen ends with one obvious next action:
- Library → Tap: the row's first button ("Tap in" / "Prep" / "Perform"). Kept.
- Tap → Prep: "Prep", top-right, disabled until 2 bars. Kept, demoted to neutral (Tap ledger) so it no longer competes with "Tap the 1"; still the only forward-labelled button.
- Prep → Perform: emerald "Perform", top-right. Kept as Prep's single primary.
- Perform → next song: "Next song" when a set has one. Kept.

## Structural proposals (for the owner; never applied)

1. **Merge Tap and Prep into one "Map" screen** (tap along on top, part editor below). Evidence: Re-tap belongs beside Prep's grid summary (F4); bar data is duplicated across them (F5); Tap's footer points at Prep (F6); both edit the same `SongPhase`; Prep has no Space key while Tap's Space taps (F14); the Tap→Prep handoff is a single button.
2. **Take "Get a song" out of the always-on Library column** (its own step, or an "Add a song" disclosure), so Library is songs + set. Evidence: import holds a third of the Library permanently even after the songs are in; the three equal columns give the Library no hierarchy (critique); the import panel nests two tab rows.
3. **Drop the unreachable `player` and `stage` views** and their panels (WaveformPlayer, TransportControls, RegionEditor, LoopManager, BeatGridView, SettingsPanel, StageMode, LoopSettingsControl) plus the unused LibraryView. Evidence: `view` starts at `'library'` (`App.tsx:28`) and `openSong` is only ever called with `'tap'`, `'prep'`, `'perform'` (`App.tsx:303,360-362`); `'player'` and `'stage'` are only ever set from each other (`App.tsx:219-223`, the Stage Mode button at `:336` renders only inside the player view), so neither is reachable from Library; App's global shortcut hook is enabled only for those two views (`App.tsx:244`); `LibraryView` is imported nowhere; `LoopSettingsControl` is used only by TransportControls and SettingsPanel. Not edited in this run.

## Assumptions
- Library's primary action is "Perform this set" (assumed: no analytics). The per-song next step is the most frequent click during the week, but it repeats on every row, so it can't be the one primary-styled action.
- "Share" needs a component file. The ui-subtract file rule lists only "the target screen's files and the run files". In flow mode the target is the flow, so one new file used only by the flow screens (`src/components/FlowControls.tsx`) is treated as a target file.

## Follow-ups (out of scope)
- Prep: Space for play/pause (keyboard-first).
- Container widths across Tap, Prep, Perform (F16).
- Prep autosave (F17); warn before Re-tap downgrades a Ready song and resets its parts.
- Guard "← Library" and "Next song" on Perform while playing.
- A warm palette in place of stock Tailwind blue/emerald/purple on cool grays.

## Run report

### Bottom line
The flow is quieter and more consistent, nothing on the main path was lost, and all four checks pass. Each screen now has one filled action. Back, Play and "Prep" mean the same thing everywhere. Perform's pads no longer jump when a part is queued. The Jobs score went from 4/10 to 6/10, but that +2 is entirely row 5 ("was anything removed?"), which flips after any cut. The rows that matter (steps to value, edge states, pride) still fail. Perform's mid-song safety gaps are additions, so they're Follow-ups, not fixes.

### Score (Jobs Quick Diagnostic, whole flow)
| Row | Before | After (fresh sub-agent, not shown the ledger) |
|---|---|---|
| 1 One Thing | pass | pass |
| 2 ≤3 steps to value | fail | fail |
| 3 Experienced cold | pass | pass |
| 4 Working demo on device | pass | pass (tablet still emulated) |
| 5 Anything removed | fail | **pass** |
| 6 Edge states at hero quality | fail | fail |
| 7 Proud to sign it | fail | fail |
| **Score** | **3/7 → 4/10** | **4/7 → 6/10** |

Built-in effects: row 5 flips after any cut, and row 6 can't improve in a subtraction pass. So the score change says nothing on its own; the counts below are the real measure.

### Counts per screen (same browser state before and after; states listed in each screen ledger)
| Screen | Controls | Words | Primary-styled buttons | Accent hues | Fields | Disclosure depth |
|---|---|---|---|---|---|---|
| Library (YouTube tab, helper up) | 19 → 15 | 67 → 60 | 3 → 1 | 3 → 2 | 1 → 1 | 2 → 1 |
| Tap (locked demo) | 10 → 10 | 175 → 68 | 3 → 1 | 2 → 1 | 2 → 2 | 0 → 0 |
| Prep (demo, 30 bars) | 45 → 46 | 77 → 74 | 1 → 1 (+ part blocks) | 1 → 1 | 5 → 5 | 0 → 0 |
| Perform (demo, one part queued) | 11 → 11 | 49 → 41 | 1 → 0 (+ pads) | 3 → 1 | 0 → 0 | 0 → 0 |
| **Flow total** | **85 → 82** | **368 → 243** | **8 → 3** | **4 → 3 distinct** (blue, emerald, yellow, purple → blue, emerald, purple) | **8 → 8** | **max 2 → 1** |

Other measures:
- Library ready-song row actions: 5 → 4.
- Perform pad movement when queuing: about 124 px → 0 px (pad tops 436 → 436 at 1440 and 820 wide, through queue, cancel and landing).
- Steps from import to first queued part (local file): 10 → 9, because Local File is now the default tab. A YouTube user now needs one extra click to open the YouTube tab.
- Code: 7 files changed, 149 insertions, 247 deletions, plus one new 29-line file (`src/components/FlowControls.tsx`). Net about −69 lines.

### Rows
| Ledger | Proposed (auto) | Done | Skipped | Reverted | Struck | Keep (no change) |
|---|---|---|---|---|---|---|
| Flow | 7 | 7 | 0 | 0 | 0 | 12 |
| Library | 33 (4 point to flow rows) | 33 | 0 | 0 | 0 | 28 |
| Tap | 9 (6 point to flow rows) | 9 | 0 | 0 | 0 | 13 |
| Prep | 4 (3 point to flow rows) | 4 | 0 | 0 | 0 | 17 |
| Perform | 9 (2 point to flow rows) | 9 | 0 | 0 | 0 | 12 |

Unique changes applied: 7 flow rows + 40 screen rows = 47. Structural proposals: 3, none applied.

### Changes outside the ledger (all in target files)
- **Verify fix (Library #12):** the planned link rule ("starts with http or contains youtu") sent searches like "youtube worship" to the downloader. Tightened to "starts with `http(s)://`, `youtube.com/` or `youtu.be/`".
- **Polish, Library:** drop-zone heading spacing (after #23/#25), Delete aligned to the song name (after #42), set-row edge padding (after #51), import tab padding `px-4` → `px-2`. The last one wasn't caused by a cut; the apply agent made it to meet row #6's Verify ("tabs read on one line").
- **Polish, Perform:** removing "Tap to queue" (#16) made only the queued pad grow 12 px, so every pad now reserves that line (empty unless queued). Pads are a uniform 100 px (were 108 px).
- **Quieter:** skipped on all four screens; every check passed after distill.

### Verify
- **Checks** (project root): `DJW_OK`, `SONGMAP_OK`, `SURFACES_OK`, `npx tsc --noEmit` clean (exit 0).
- **Primary path, start to finish** (1440×900, fresh import): Local File opened by default → Choose Audio File → "click-100bpm · Needs tap · 0:40 · 100 BPM" with "Tap in" → Tap: Play, two Space taps registered (Space did not also toggle the focused Play button), I/V/C marked sections, Use detected grid → "Steady 100 BPM", Lock → "Locked at 100 BPM." with "Use my taps" now shown → Prep: "17 bars · 100 BPM locked · 4/4 · Re-tap", Verse pickup 2 / fade 2 → "Fade starts 0:24. Singers enter 0:25. Lands at 0:26." → Perform: Space plays, `2` queues Verse ("Up next · tap to cancel", panel shows the same timings), pads didn't move, `M` toggles the click, `2` again cancels, mouse-click a pad then Space pauses without re-firing the pad, Jump now makes Chorus current → ← Library.
- **Consistency sweep:** back is "← Library" (one component) on Tap, Prep, Perform; Play/Pause is one neutral component on all three; "Prep" is the only name for opening Prep; Re-tap lives on Prep, "Tap in" on needs-tap rows; emerald appears only on "Perform this set" and Prep's "Perform"; queued state is "Up next" on panel and pad; all four import CTAs share one look; text-style buttons (Delete, Remove, Re-tap, Delete part, Jump now) share one family. Remaining mismatch: the shared Play button is Perform-sized, so it is the biggest button on Prep's header (it's neutral, not primary).
- **Guardrail sweep (every screen):** zero controls without an accessible name (DOM check); every field has a visible label (the YouTube box is the single-search-box exception: visible icon + `aria-label`); Library header and every back link visible on desktop; protected messages kept (helper-down warning, legal disclaimer, error box, import errors); Delete still confirms (clicked Delete, dismissed the dialog, both songs still there); primary actions and keyboard shortcuts intact (Space tap / play-pause, I V C B T O, 1–9, M).

### Assumptions (auto mode)
- Library's primary action is "Perform this set"; Library's default tab is Local File (no usage data for either).
- Critique's "Ask the User" answered from the frame (logged in the critique file). Critique's browser overlay (`impeccable live` + `detect.js` injection) skipped under the file rule; CLI results only.
- No `impeccable teach` (PRODUCT.md exists, user-confirmed) and no `impeccable document` / DESIGN.md (file rule).
- The second-opinion step from the user's global instructions was skipped at the lead's direction (quota). Apply sub-agents tried it anyway and hit the usage limit; no effect on the result.
- `src/components/FlowControls.tsx` created as a flow target file (see Assumptions above).
- Perform #10a (reserve the Up next slot) treated as a guardrail-8 repair.

### Incidents
- **A demo song was deleted during the Library apply agent's Delete-cancel check.** Cause: the DevTools `evaluate_script` tool auto-accepts dialogs by default, so a click fired through it confirms. Not an app bug. Re-verified with a real click and a dismissed dialog: nothing deleted. The demo song was regenerated. Only the isolated test profile was affected.
- **Chrome restarted mid-run** and wiped the isolated profile; the Tap agent rebuilt the fixture (two ready demo songs, one in the set).
- **Unexplained extra taps:** once during the Tap agent's check, one Space press became about 15 taps and then one per beat. Not reproduced in two logged reruns. Most likely another session sending keys to the shared browser; unproven.
- Every sub-agent's handback failed ("the agent that spawned you is no longer running"); their reports were recovered from their transcripts.
- The test profile now holds two extra imported "click-100bpm" songs from verification.

### Follow-ups (out of scope: additions, behavior changes, or owner decisions)
1. Perform mid-song safety: guard "← Library" and "Next song" while playing; fade or hold instead of a hard Space stop; give "Jump now" a bigger, separated target (or long-press); name each Jump now ("Jump to Chorus now").
2. Perform glanceability: current part as the largest element, a beat countdown to the landing instead of song-file times (they go stale once a part loops); warm, dim pad colors with readable text (white on lime/amber is ~2:1).
3. Prep loses work: autosave, or confirm before "← Library" and "Re-tap". Re-tapping a Ready song downgrades it and resets pickups, fades and loop; warn first.
4. Prep as a track editor: Space for play/pause, part boundary editing, add part, playhead, visible bar numbers, compact steppers.
5. Tap: Space toggles a focused checkbox or select instead of tapping; Tap dead-ends when the song ends (no rewind); paused taps are saved; every action remounts the screen (`saveAndKeep` → `reload()`), which drops focus and resets "Snap to detected hits"; on-screen section buttons for touch; auto-lock when steady.
6. Library: import errors vanish after 2 s; "Done!" flash with no highlight on the new song; "Add to set" silently no-ops for songs already in the set; no set reorder; duplicate names can't be told apart; "1 song still need prep" grammar; Search/Download icons inside the YouTube buttons were missed by the inventory; header `px-4` vs main `p-6` misalignment; drop the "Suggesting regions…" import step (owner: it changes saved data).
7. Shared Play button changes width between Play and Pause and nudges its neighbors; give it a min width.
8. Container widths differ across Tap, Prep, Perform (F16).
9. The Up next slot reserves 100 px; a long part name that wraps to a fourth line would move the pads again (truncate or reserve more).
10. impeccable design laws, logged only: stock cool Tailwind grays and `#fff`, no OKLCH, blue-500 spinner.

### Dead code for the owner (unreachable from the flow; not edited)
App.tsx `player` and `stage` views (and the player-only shortcut map, header buttons and panel tabs), `WaveformPlayer.tsx`, `TransportControls.tsx`, `RegionEditor.tsx`, `LoopManager.tsx`, `BeatGridView.tsx`, `SettingsPanel.tsx`, `StageMode.tsx`, `LoopSettingsControl.tsx`, `LibraryView.tsx`. Evidence in Structural proposal 3.

### Undo
Starting commit `af1de67` in the external git dir. All edits are uncommitted.
- Review: `git --git-dir=/Users/kk/Projects/_scratch/lampcircle-ui-subtract-2026-10-05/repo.git --work-tree=/Users/kk/Projects/HOME-studio/lampcircle diff af1de67`
- Drop the edits: same prefix + `checkout af1de67 -- src/App.tsx src/components/Dashboard.tsx src/components/ImportSong.tsx src/components/YouTubeSearch.tsx src/components/TapScreen.tsx src/components/PrepScreen.tsx src/components/PerformScreen.tsx`, then delete the untracked `src/components/FlowControls.tsx` (checkout won't remove it).
- No `.preexisting.patch` was needed (the tree was clean).
- The run record is the untracked `docs/cut-lists/2026-10-05-library-to-perform*` files; delete them if you don't want it. Screenshots: `/Users/kk/Projects/_scratch/lampcircle-ui-subtract-2026-10-05/screens/` (`before-*`, `after-*`, `jobs-after-*`).
