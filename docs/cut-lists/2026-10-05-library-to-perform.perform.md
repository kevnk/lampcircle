# Cut list: Perform (PerformScreen.tsx + App.tsx perform view)
Date: 2026-10-05 · Mode: auto · Evidence: code + render (1440×900 and 820×1180; single-song playlist; V1 and then Chorus queued; Space play/pause tested) · Inputs: `…flow.md`, `…critique.md`, `…jobs-before.md`

**Job:** Play the song live and queue the next part so it lands on the beat, while the leader's eyes stay on the room.
**Mainstream user:** Kevin mid-song on a laptop or tablet in a dim living room, glancing down, pressing number keys or tapping pads. (PRODUCT.md: readable at a glance; safe from wrong-pad and accidental-stop mistakes; large touch targets.)
**Primary action:** Queue a part (tap its pad or press its number). Secondary: play/pause (Space), jump now, click track (M), next song, leave.

**Removals are expected. Every element must earn its place. Propose cuts before additions.**

Flow decisions that touch this screen: F1 (back link), F2 (Play). Not re-decided here.

## Ledger
| # | Element | Location | Decision it serves | Verdict | Test | Where it goes now | Risk | Verify | Approval | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Page (`bg-gray-950`, `max-w-5xl`) | `PerformScreen.tsx:57-58` | Darker stage surface | keep | Dim-room surface (PRODUCT.md). Critique candidate "warm-tinted dark" is a palette change (Follow-ups). | — | — | — | — |  |
| 2 | "← Dashboard" (leaving stops playback) | `PerformScreen.tsx:60` | Leave | see F1 | — | — | low | Still stops playback exactly as before; no new behavior | auto | done (F1) |
| 3 | "Song N of M" (sets only) | `PerformScreen.tsx:61-65` | Where am I in the set | keep | Set position | — | — | — | — |  |
| 4 | Song title (h1, `text-4xl md:text-6xl`, white) | `PerformScreen.tsx:68` | Which song | demote: `text-3xl md:text-4xl` | He knows the song; at 60 px it is the brightest, biggest thing in a dark room, three times the current part's size (critique P1). Still the page's h1 and still readable at a glance. | Same place | low | Title readable at 820 px and 1440 px; bar readout and part name sit closer in weight | auto | done |
| 5 | Bar.beat readout ("Bar 3.4") | `PerformScreen.tsx:69-71` | Where in the song | keep | Timing at a glance | — | — | — | — |  |
| 6 | Current part name / "Choose a part" (text-blue-200) | `PerformScreen.tsx:72` | What's playing now | keep, demote color to neutral (`text-gray-200`) | Status that also shows as the white ring; blue-200 is used nowhere else, so it is an extra hue on the calmest screen. Critique candidate "promote it to the largest element" is not a cut (Follow-ups); #4's demotion narrows the gap. | Same place | low | Name still shows under the bar readout and changes when a queued part lands | auto | done |
| 7 | Play / Pause (big green filled) | `PerformScreen.tsx:75-77` | Start / stop | see F2 (shared, neutral, same touch size) | — | — | med | Space still toggles; click still toggles | auto | done (F2) |
| 8 | "Click on / off" + `M` | `PerformScreen.tsx:47,78-80` | Click track | keep (assumed) | Critique candidate "move or remove (it plays into the room)": it is the flow's only metronome, so removing it removes the feature; routing it to a separate output is audio work (Follow-ups). | — | — | — | — |  |
| 9 | "Next song" (sets with a next song) | `PerformScreen.tsx:81-85` | Move through the set | keep | Set flow. Critique candidate "queue it for song end, or enable only when stopped" changes behavior (Follow-ups). | — | — | — | — |  |
| 10 | "Up next" panel styling (bg purple-950/60; text purple-200 and purple-100) | `PerformScreen.tsx:88-94` | Make the queued part obvious | demote: neutral panel (`bg-gray-900`), name in white, timing line in `text-gray-300` | Purple text on purple is the detector's AI-palette hit (`PerformScreen.tsx:90`); the queued pad keeps its purple ring as the one queue color | Same panel, same place | low | Queue a part: panel shows "Up next / V1 / Fade … Singers … Lands …", readable at 820 px | auto | done |
| 10a | Up next panel appears above the pads only when a part is queued | `PerformScreen.tsx:87-95` | — | keep + repair: reserve the panel's height so the pads don't move when a part is queued or lands | Queuing pushes every pad down ~124 px under the finger (critique P0, measured); the next tap can hit the wrong pad. Guardrail 8 (the primary action's path) read with PRODUCT.md's "safe from wrong pad". No new copy or element: an empty slot when nothing is queued. (assumed) | Same place | med | Queue and cancel a part: pad positions don't change (compare `getBoundingClientRect().top` before and after) | auto | done (wrapper `mb-6 min-h-[6.25rem]` = panel height; pad tops equal with nothing queued, queued, cancelled and landed at 1440, 820 and 600 px) |
| 11 | "Up next" label + queued part name + "Fade … Singers … Lands …" | `PerformScreen.tsx:89-93` | What's next and when the singers come in | keep | Glanceable queue state plus the singer cue. Critique candidate "one bar countdown instead of three m:ss times" is an addition (Follow-ups). | — | — | — | — |  |
| 12 | Pad grid (2 / 4 columns) | `PerformScreen.tsx:96` | Layout | keep | — | — | — | — | — |  |
| 13 | Pads (part color, white ring = current, purple ring = queued) | `PerformScreen.tsx:101-111` | Primary action | keep | Primary action (guardrail 8); colors are part data | — | — | — | — |  |
| 14 | Pad number (1–9) | `PerformScreen.tsx:108` | Which key queues it | keep | Keyboard-first (guardrail 9) | — | — | — | — |  |
| 15 | Pad name | `PerformScreen.tsx:109` | Which part | keep | Core | — | — | — | — |  |
| 16 | "Tap to queue" on every unqueued pad | `PerformScreen.tsx:110` | None after the first use | remove | The same instruction printed on every pad. A pad obviously presses; its number shows its key; "Jump now" under it marks the other behavior. | — | low | Unqueued pads show number + name only | auto | done (polish: hint line kept as an empty `block min-h-4` slot so the queued pad no longer grows 12 px) |
| 17 | "Queued · tap to cancel" on the queued pad | `PerformScreen.tsx:110` | It's queued; how to cancel | keep + rename "Queued" → "Up next" ("Up next · tap to cancel") | Two names for one state on one screen ("Up next" panel vs "Queued" pad). Cancel isn't discoverable otherwise, so the hint stays. | Same pad | low | Queue a pad: it reads "Up next · tap to cancel"; tap again cancels | auto | done |
| 18 | "Jump now" under each pad (button styled as an underlined link) | `PerformScreen.tsx:112-114` | Cut to this part immediately | keep + repair: drop the underline so it is a text-style button, like "Remove" (Library) and "Delete part" (Prep) | Guardrail 4: buttons look like buttons, links like links. It doesn't navigate. Critique candidate "remove; one deliberate control or long-press": counter-pass keeps it, since it is the only immediate cut when a looping part won't end soon. Its size and nearness to the pads are a mid-song risk; respacing is an addition (Follow-ups). | Same spot | low | Still reads "Jump now", still jumps; no underline | auto | done |
| 19 | Auto-arm the first part on entry | `PerformScreen.tsx:43-45` | Ready to play | keep | Behavior on the primary path | — | — | — | — |  |
| 20 | Keys: Space play/pause, M click, 1–9 queue | `PerformScreen.tsx:47-51` | Keyboard-first control | keep | Core (guardrail 9); verified Space doesn't re-fire a focused pad | — | — | — | — |  |

## Keep (don't touch)
- Space, M and 1–9; the pads and their numbers.
- The bar.beat readout and the "Up next" panel with its timing line (the title stays, smaller).
- The white (current) and purple (queued) rings.

## Counts
State measured (before and after): single-song playlist (demo, 4 parts), one part queued, paused.

| Metric | Before | After (projected) | After (actual) |
|---|---|---|---|
| Interactive controls | 11 | 11 | 11 |
| Words of visible copy | 49 | ~41 | 41 |
| Visible form fields | 0 | 0 | 0 |
| Accent colors | 3 (emerald: Play; purple: panel and queued ring; blue: current part name). Part colors are data. | 1 | 1 (purple, queued ring only) |
| Primary-styled actions | Play + the pads (data-colored primary action) | the pads only | the pads only |
| Disclosure depth | 0 | 0 | 0 |
| Steps to primary action | 1 (press a number) | 1 | 1 |
| Pad movement when a part is queued | ~124 px down (critique, measured) | 0 | 0 px (pad tops 436 → 436 at 1440 and 820; queue, cancel, land) |

## Second pass and counter-pass
- Second pass: added #4 (title demote) and #10a (stop the pads from moving).
- Counter-pass: kept "Jump now" (#18) and "Click on/off" (#8) instead of the critique's remove.

## Embody check
Calmer for a dim room: the colored pads carry the screen; the title steps back; everything else is neutral. Queue state still shows in two glanceable places (panel and ring), and queuing no longer moves the pads. Nothing on the mid-song path was removed.

## Assumptions
- None beyond the flow ledger's.

## Follow-ups (out of scope)
- Mid-song safety: "← Library" and "Next song" act at once while playing (accidental stop / switch). Guard while playing.
- "Jump now" is a ~16 px target 8 px under each pad; enlarge or separate it (touch targets).
- White pad text on lime and amber part colors is low contrast in a dim room.
- Four identical "Jump now" accessible names; name each ("Jump to Chorus now").
- Make the current part the largest element, with a bar countdown to the queued landing.
- Route the click to a separate output, or leave it off Perform.
- Fade on pause instead of a hard stop.
- Warm, dim pad colors with readable text; warm-tinted background.
