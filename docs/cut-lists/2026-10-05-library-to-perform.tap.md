# Cut list: Tap (TapScreen.tsx + App.tsx tap wrapper)
Date: 2026-10-05 · Mode: auto · Evidence: code + render (1440×900, reached via Re-tap on a ready demo song) · Inputs: `…flow.md`, `…critique.md`, `…jobs-before.md`

**Job:** Turn the recording into a bar grid by tapping the 1 of each bar, and mark sections as they go by.
**Mainstream user:** Kevin at a laptop, music playing, tapping Space on each downbeat and pressing I/V/C/B/T/O at section starts. (PRODUCT.md: "tap the 1s, flag sections"; keyboard-first.)
**Primary action:** Tap the 1 (button or Space). Secondary: play/pause, meter, lock the tempo, undo, go to Prep.

**Removals are expected. Every element must earn its place. Propose cuts before additions.**

Flow decisions that touch this screen: F1 (back link), F2 (Play), F5 (Downbeats list + count), F6 (Prep note). Not re-decided here.

## Ledger
| # | Element | Location | Decision it serves | Verdict | Test | Where it goes now | Risk | Verify | Approval | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Page wrapper (`min-h-screen bg-gray-900 p-6`) + `max-w-3xl` column | `App.tsx:257`, `TapScreen.tsx:145` | Layout | keep | Critique candidate "shared width" is F16 (follow-up) | — | — | — | — |  |
| 2 | "← Dashboard" | `TapScreen.tsx:147-149` | Leave | see F1 | — | — | low | — | auto | done (F1) |
| 3 | "Prep" forward button (blue filled; disabled under 2 bars) | `TapScreen.tsx:150-157` | Go on to Prep | keep, demote to neutral (`bg-gray-700`, same disabled rule) | One primary-styled action per view: "Tap the 1" is primary. It stays the only forward-labelled button, top-right. | Same place | low | Disabled with 0–1 bars, enabled at 2+, opens Prep | auto | done (`bg-gray-700`, `disabled:opacity-40` like Lock; render: disabled at 0 and 1 bars, enabled at 2, opens Prep) |
| 4 | Song title (h2) | `TapScreen.tsx:160` | Which song | keep | Identity | — | — | — | — |  |
| 5 | Instruction "Tap the 1 of each bar. Space taps. I V C B T O mark a section on the nearest 1." | `TapScreen.tsx:161` | How to tap and mark | keep | The only place the Space and section keys are taught; keyboard-first is core (guardrail 9). Critique candidate "tappable key chips" is an addition (Follow-ups). | — | — | — | — |  |
| 6 | Play / Pause (green filled) | `TapScreen.tsx:164-166` | Start the music to tap along | see F2 | — | — | med | — | auto | done (F2) |
| 7 | Time readout | `TapScreen.tsx:167` | Where the playhead is | keep | Feedback while tapping | — | — | — | — |  |
| 8 | Meter select (4/4, 3/4, 6/8) with visible label | `TapScreen.tsx:168-183` | Beats per bar | keep | A fact about the song, already defaulted to 4/4; labelled (guardrail 2). Critique candidate "move to Prep's metadata line": the Tap verdict needs it (`assessTempo(taps, perBar)`, `TapScreen.tsx:49-50`), so its home is Tap; Prep already shows it read-only (F9). | — | — | — | — |  |
| 9 | "Tap the 1" button | `TapScreen.tsx:185-191` | Primary action | keep | Primary action (guardrail 8) | — | — | — | — |  |
| 10 | Verdict panel container | `TapScreen.tsx:192` | Groups tempo status + grid actions | keep | Real grouping | — | — | — | — |  |
| 11 | Verdict text ("Keep tapping. N bars so far." / "Steady N BPM. Likely a click track." / "Drifts …") | `TapScreen.tsx:137-142,193` | Is the grid good yet? | keep | System status; also the per-tap feedback once the Downbeats list goes (F5) | — | — | — | — |  |
| 12 | "Use detected grid" | `TapScreen.tsx:195-197` | Skip tapping when beat detection is right | keep (assumed) | A one-click path for click-track songs; already neutral. Critique candidate "hide behind More options": that adds a menu for one item. | — | — | — | — |  |
| 13 | "Lock" / "Lock to N BPM" | `TapScreen.tsx:198-205` | Fill a steady grid to the end of the song | keep | Core tempo lock. Critique candidate "auto-lock when steady" changes behavior (Follow-ups). | — | — | — | — |  |
| 14 | "Use my taps" | `TapScreen.tsx:206-208` | Undo a lock | derive: show only while a lock is active (`lockedBpm !== null`) | When nothing is locked the grid already is your taps, so the button does nothing. After "Use detected grid" the taps were replaced too, so it can't restore them either. | Appears after Lock, in the same spot | low | Before Lock: hidden. After Lock: visible; clicking it clears the lock line and hides itself | auto | done (render: hidden unlocked, shown after Lock, click returns the tap verdict and hides it) |
| 15 | "Undo" | `TapScreen.tsx:209-211` | Remove the last tap | keep | Error recovery | — | — | — | — |  |
| 16 | "Snap to detected hits" checkbox (on) | `TapScreen.tsx:212-215` | Pull taps onto detected beats | keep (assumed) | Already defaulted on. Soft intros with no drums can fool onset detection, and this is the only way to turn snapping off. Critique candidate "hide": no natural trigger to hide it behind. | — | — | — | — |  |
| 17 | Separate emerald line "Locked at N BPM. N downbeats." | `TapScreen.tsx:217` | Confirms the lock | merge into the verdict (#11): while locked, the verdict line reads "Locked at N BPM." and the separate line goes | Same intent (tempo status), same scope. Today a locked grid shows "120 BPM" three times (verdict, Lock button, this line). Critique candidate. | Verdict line | low | Lock: the verdict line changes to "Locked at 120 BPM."; "Use my taps" returns it to the tap verdict | auto | done (render: locked shows "Locked at 120 BPM.", unlock shows "Steady 120 BPM. Likely a click track."; no emerald left on screen) |
| 18 | "N downbeats." in the locked line | `TapScreen.tsx:217` | None on this screen | see F5 (goes with #17; home is Prep's "N bars") | — | Prep summary | low | — | auto | done (F5) |
| 19 | Downbeats heading + list ("Bar N · 0:00" ×N, scrolls past 8) | `TapScreen.tsx:219-227` | None on this screen | see F5 (remove) | — | Prep timeline | low | — | auto | done (F5) |
| 20 | Sections heading + list ("Chorus · bar 17") | `TapScreen.tsx:228-240` | Confirms the section keys landed | keep | The only feedback for I/V/C/B/T/O presses; feeds Prep's parts. Critique candidate "allow rename and delete" is an addition (Follow-ups). | — | — | — | — |  |
| 21 | Two-column grid that held Downbeats and Sections | `TapScreen.tsx:219` | Layout | remove (with #19) | With one list left, the grid is an empty half | Sections list sits as a plain block | low | Sections list reads full-width under the panel | auto | done (with F5) |
| 22 | "Pickup and fades are set in Prep." | `TapScreen.tsx:242` | None | see F6 (remove) | — | Prep editor | low | — | auto | done (F6) |

## Keep (don't touch)
- "Tap the 1" and the Space shortcut (and I/V/C/B/T/O).
- The verdict line, the instruction line, the Sections list.
- Lock, Undo, the meter select.

## Counts
State measured (before and after): ready demo song (grid locked at 120 BPM, 30 bars, 4 marks), reached via Library.

| Metric | Before | After (projected) | After (actual) |
|---|---|---|---|
| Interactive controls | 10 | 10 (9 before a lock) | 10 locked; 9 on a fresh song before a lock ("Use my taps" hidden) |
| Words of visible copy | 175 (90 of them in the Downbeats list) | ~76 | 68 |
| Visible form fields | 2 (meter, snap) | 2 | 2 |
| Accent colors | 2 (blue: Tap the 1, Prep; emerald: Play and the locked line) | 1 | 1 (blue: Tap the 1) |
| Primary-styled actions | 3 (Prep, Play, Tap the 1) | 1 | 1 (Tap the 1) |
| Disclosure depth | 0 | 0 | 0 |
| Steps to primary action | 2 (Play, then tap) | 2 | 2 |

## Second pass and counter-pass
- Second pass: added #17 (locked line merges into the verdict) and #21 (empty grid half).
- Counter-pass: kept "Use detected grid" (#12), "Snap to detected hits" (#16) and the meter on Tap (#8) instead of the critique's hide/move.

## Embody check
Calmer and more obviously about one thing: a big "Tap the 1", a single status line, and the sections you've marked. Losing the timestamp list doesn't make it feel bare: the verdict line still reports bars as you tap, and Prep shows the grid as a timeline.

## Assumptions
- Kept "Use detected grid" and "Snap to detected hits": PRODUCT.md rules auto-analysis out of scope, which reads as "don't build more of it", not "remove what exists".

## Follow-ups (out of scope)
- No visual feedback on a Space tap (the button has no pressed state when the key is used).
- Re-tapping a ready song (one tap or a meter change) rewrites the phase as "tapped" and drops pickups, fades and loop settings from Prep. Warn first.
- On-screen section buttons (touch users can't mark sections today).
- Rename or delete a mark in the Sections list.
- Auto-lock when the verdict is steady.
