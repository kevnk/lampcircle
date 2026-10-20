# Cut list: Prep (PrepScreen.tsx + App.tsx prep wrapper)
Date: 2026-10-05 · Mode: auto · Evidence: code + render (1440×900, ready demo song, 30 bars, 4 parts) · Inputs: `…flow.md`, `…critique.md`, `…jobs-before.md`

**Job:** Shape the song's parts (name, pickup, fades, loop) on the bar grid, save the map, and hand off to Perform.
**Mainstream user:** Kevin at a laptop, calmly, the week before: picks a part on the timeline, sets its pickup and fades, then performs or saves. (PRODUCT.md: "Prep feels like a track editor (cut, snap, fade)".)
**Primary action:** Edit the selected part, then Perform. Secondary: play/seek, save and go back, export .djw, delete a part, re-tap (after F4).

**Removals are expected. Every element must earn its place. Propose cuts before additions.**

Flow decisions that touch this screen: F1 (back link), F2 (Play), F4 (Re-tap arrives here), F5 (bar count lives here). Not re-decided here.

## Ledger
| # | Element | Location | Decision it serves | Verdict | Test | Where it goes now | Risk | Verify | Approval | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Page wrapper (`min-h-screen bg-gray-900 p-6`), full width | `App.tsx:273`, `PrepScreen.tsx:99` | Layout | keep | Critique candidate "shared width" is F16 (follow-up) | — | — | — | — |  |
| 2 | "← Dashboard" | `PrepScreen.tsx:101` | Leave (drops unsaved edits) | see F1 | — | — | low | — | auto | done (F1) |
| 3 | "Export .djw" | `PrepScreen.tsx:103` | Save the map as a file | keep | Core: "save the map as .djw" (PRODUCT.md, guardrail 9). Critique candidate "move to a Library overflow menu": an overflow adds a disclosure level, and the map is made here. | — | — | — | — |  |
| 4 | "Save · mark ready" | `PrepScreen.tsx:104-106` | Save and return to Library without performing | keep | Prepping several songs before Sunday needs it; the back link doesn't save. Critique candidate "remove, autosave instead": autosave is a behavior addition (Follow-ups); until then this is the only saving exit besides Perform. | — | — | — | — |  |
| 5 | "Perform" (emerald filled) | `PrepScreen.tsx:107-109` | Save and perform | keep | Prep's single primary and its handoff (F7) | — | — | — | — |  |
| 6 | Song title (h2) | `PrepScreen.tsx:114` | Which song | keep | Identity | — | — | — | — |  |
| 7 | Grid summary "N bars · N BPM locked / tap grid · 4/4" | `PrepScreen.tsx:115-117` | What grid the parts sit on | keep | Home of the bar count (F5); meter read-only chip (F9) | — | — | — | — |  |
| 8 | "Re-tap" text button at the end of the summary line | new spot in `PrepScreen.tsx:115-117` | Redo the grid | see F4 (moved here from Library) | — | — | med | From Prep, Re-tap opens Tap for the same song | auto | done (F4) |
| 9 | "Play · 0:00" button (time inside the label) | `PrepScreen.tsx:119-121` | Hear the part | see F2 (shared PlayButton; time becomes plain text beside it) | — | — | med | — | auto | done (F2) |
| 10 | Timeline panel (scrolls sideways) | `PrepScreen.tsx:124-125` | The song on the bar grid | keep | The track-editor surface | — | — | — | — |  |
| 11 | Bar tick buttons ×N (thin line + bar number) | `PrepScreen.tsx:126-143` | Seek to a bar and select its part | keep | Seek is the only way to audition a spot; accessible name is the bar number. Critique candidate "demote to one seek surface + playhead" is a rebuild (Follow-ups). | — | — | — | — |  |
| 12 | Part blocks ×N (part color, white ring when selected) | `PrepScreen.tsx:144-162` | Pick the part to edit | keep | Primary path; colors are the user's part colors (data) | — | — | — | — |  |
| 13 | Part editor panel | `PrepScreen.tsx:166-167` | Groups the selected part's settings | keep | Real grouping | — | — | — | — |  |
| 14 | Name field (labelled) | `PrepScreen.tsx:168-175` | Part name shown on Perform's pad | keep | Core | — | — | — | — |  |
| 15 | Pickup beats (labelled number) | `PrepScreen.tsx:176-187` | When singers come in before the 1 | keep | Core (PRODUCT.md "pickups") | — | — | — | — |  |
| 16 | Fade in beats (labelled number) | `PrepScreen.tsx:188-199` | How the part enters | keep | Core ("cut and fade") | — | — | — | — |  |
| 17 | Fade out beats (labelled number) | `PrepScreen.tsx:200-211` | How the part leaves | keep | Core. Critique candidate for #15-17 "compact steppers or timeline handles" is an addition (Follow-ups). | — | — | — | — |  |
| 18 | Part timing sentence "Fade starts … Singers enter … Lands at …" / "No fade in. Lands at 0:00." | `PrepScreen.tsx:212-214,245-247` | Check what the pickup and fade values do in time | keep | Turns beat counts into moments you can check by ear | — | — | — | — |  |
| 19 | "Beat length about 0.50s." clause | `PrepScreen.tsx:244,247` | None | remove (and the now-unused beat-length math in `describePart`) | A number that drives no decision; Perform doesn't show it either | — | low | Sentence ends after "Lands at …." | auto | done (clause and barStart/nextDownbeat/beatDur math removed from `describePart`) |
| 20 | "Loop this part" checkbox (labelled) | `PrepScreen.tsx:215-222` | Does the part repeat until the next is queued | keep | Core to Perform's queue model | — | — | — | — |  |
| 21 | "Delete part" (red text button) | `PrepScreen.tsx:223-232` | Remove a part | keep | Reversible until saved (leaving without saving drops it); no confirm to keep. Critique candidate "add undo" is an addition (Follow-ups). | — | — | — | — |  |

## Keep (don't touch)
- The timeline with part blocks and bar ticks.
- Name, Pickup, Fade in, Fade out, Loop, and the timing sentence.
- "Export .djw", "Save · mark ready", and the emerald "Perform".

## Counts
State measured (before and after): ready demo song, 30 bars, 4 parts, Intro selected.

| Metric | Before | After (projected) | After (actual) |
|---|---|---|---|
| Interactive controls | 45 (30 of them bar ticks) | 46 | 46 (+ Re-tap from Library) |
| Words of visible copy | 77 | ~75 | 74 |
| Visible form fields | 5 | 5 | 5 |
| Accent colors | 1 (emerald: Perform). Red on "Delete part" is a destructive status; part colors are data. | 1 | 1 |
| Primary-styled actions | 1 button (Perform) + the part blocks (data-colored primary path) | same | same |
| Disclosure depth | 0 | 0 | 0 |
| Steps to primary action | 2 (pick a part, change a value) | 2 | 2 |

Prep gains a control (Re-tap) and loses almost nothing on its own: it was already close to its job. Its real gaps (no part boundary editing, no Space key, no unsaved-changes guard) are additions.

## Second pass and counter-pass
- Second pass: nothing new beyond #19; the screen is close to its job.
- Counter-pass: kept "Save · mark ready" (#4) and "Export .djw" (#3) in place instead of the critique's remove/move.

## Embody check
Unchanged in character: still the editor, with one more way back to Tap where you'd look for it (next to the grid it would redo). Not bare.

## Assumptions
- None beyond the flow ledger's.

## Follow-ups (out of scope)
- No Space key for play/pause (keyboard-first).
- "← Library" drops unsaved part edits without warning.
- Part start and end bars can't be edited here (PRODUCT.md: track editor with cut and snap).
- Bar numbers on the timeline are 10 px gray-500 on gray-800; nearly invisible.
- "Perform" and "Save · mark ready" are disabled with no reason shown when there are no parts.
- No way to add a part (deleting the last one strands the song).
- Autosave Prep like Tap, then retire "Save · mark ready".
- Compact steppers for pickup and fades; waveform and playhead on the timeline.
