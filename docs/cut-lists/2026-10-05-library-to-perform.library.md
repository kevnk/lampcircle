# Cut list: Library (App.tsx library header shell + Dashboard.tsx + ImportSong.tsx + YouTubeSearch.tsx)
Date: 2026-10-05 · Mode: auto · Evidence: code + render (1440×900; helper down and helper up; 2 ready demo songs, 1 in the set) · Inputs: `…flow.md`, `…critique.md`, `…jobs-before.md`

**Job:** Keep the songs, send each one to its next step, and line up tonight's set.
**Mainstream user:** Kevin, at a laptop during the week (import, then open songs to tap or prep) and before a gathering (pick songs, start the set). (PRODUCT.md)
**Primary action:** Perform this set (assumed: no usage data; it is the Library's one decisive action and the flow's goal). Secondary jobs, all kept reachable without primary styling: get a song (YouTube / file / demo), open a song at its next step (Tap in / Prep / Perform), add to or remove from the set, delete a song.

**Removals are expected. Every element must earn its place. Propose cuts before additions.**

Flow decisions that touch this screen: F3 ("Edit" → "Prep"), F4 (Re-tap moves to Prep), F7 (row "Perform" demoted). Not re-decided here.

## Ledger
| # | Element | Location | Decision it serves | Verdict | Test | Where it goes now | Risk | Verify | Approval | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Header music-note icon (blue-500, 28 px) | `App.tsx:328` | None; decoration beside the wordmark | remove | Penalty: none. Not a brand mark (no DESIGN.md); it is the only blue in the header. | Wordmark "Lampcircle" stays | low | Header shows the wordmark alone, aligned left | auto | done |
| 2 | Header bar + "Lampcircle" h1 | `App.tsx:325-330` | Where am I / home | keep | Critique candidate "remove or merge the header": kept. It is the Library's only name and identity (F15). Its right side holds only dead `player`-view buttons, which this run doesn't edit. | — | — | — | — |  |
| 3 | Three section cards (Get a song / Your songs / Set list) | `Dashboard.tsx:58-170` | Layout | keep | Each holds a real job. Critique candidates "restructure the columns" and "demote or move Get a song" change the screen's shape: Structural proposal 2. | — | — | — | — |  |
| 4 | "Get a song" heading | `Dashboard.tsx:60` | Names the import panel | keep | Serves orientation | — | — | — | — |  |
| 5 | Import tabs: YouTube Search / Local File / Demo Track | `ImportSong.tsx:327-367` | Choose import source | keep | Critique candidate "merge into one drop zone + link field": not a merge. Same intent, different scope (local file vs YouTube vs generated). 3 tabs is within limits. | — | — | — | — |  |
| 5a | Default import tab = YouTube | `ImportSong.tsx:21` | Which source opens first | default → Local File | Local File works in every mode (local-first, offline). YouTube needs the helper; under `npm run dev:client` the first thing a new user sees is "YouTube helper is not running … port 3001" (render). Critique and Jobs review both flagged it. (assumed: no data on which source Kevin uses most) | YouTube is one click away, same tab row | low | Library opens on Local File; YouTube tab still works when clicked; dropping a .djw still switches to Local File | auto | done (YouTube tab still opens on click; .djw drop path unchanged) |
| 5b | Demo Track tab itself | `ImportSong.tsx:354-366` | Try the flow without a recording | keep (trimmed by #31-35) | Critique candidate "hide (dev-only)": counter-pass keeps it. The empty-state copy points to it (#38), and it's the only way to try the flow without a file. No natural trigger to hide it behind. | — | — | — | — |  |
| 6 | Icons inside the import tabs (search, upload, sparkles) | `ImportSong.tsx:337,350,363` | None | remove | An icon that repeats its label adds nothing; at xl they force each label onto two lines (render). | Labels alone | low | Tabs read on one line at 1440 px; active underline still shows | auto | done (labels still wrapped at 1440 without icons; polish cut tab padding px-4 → px-2 so all three fit on one line) |
| 7 | Active-tab underline (blue-500) | `ImportSong.tsx:332,345,358` | Which source is open | keep | State indicator | — | — | — | — |  |
| 8 | Import progress spinner (64 px, blue, spinning) | `ImportSong.tsx:371` | Is it working? | demote: shrink to text size (`w-5 h-5`) beside the message | The message carries the status; a 64 px spinning circle is the loudest thing on the Library while it runs (critique) | Inline with the message | low | Import shows a small spinner next to "Detecting beats..." | auto | done (20 px spinner inline, centered on the message; seen during demo generation and a failed import) |
| 8a | Import progress messages ("Reading file...", "Detecting beats...", "Suggesting regions...", "Saving song...", "Done!", "Demo ready!", failures) | `ImportSong.tsx:32-39,62-90,99-134,140-234,240-286` | Is it working / did it fail | keep | System status and errors (guardrail 7). Critique candidates: drop "Suggesting regions..." (that step really runs and its result is saved, so removing it is a data change, not a UI cut → Follow-ups); replace "Done!" (needs a new highlight → Follow-ups). | — | — | — | — |  |
| 8b | `.import-song-section { min-height: 400px }` | `index.css:161-163` | Keeps the import panel from collapsing between states | keep | Critique candidate "remove": kept. At xl the three columns stretch to the tallest anyway, and it's a global CSS file; no clear gain from the edit. | — | — | — | — |  |
| 9 | "Checking the YouTube helper…" | `YouTubeSearch.tsx:151-155` | Status | keep | System status | — | — | — | — |  |
| 10 | Helper-down / yt-dlp-missing warning (title, body, `brew install yt-dlp`) | `YouTubeSearch.tsx:157-186` | How to recover | keep | Error and recovery message (guardrail 7). Critique candidate "hide or demote (developer copy)": hiding is barred; after #5a it no longer greets a new user, because Local File opens first. | — | — | — | — |  |
| 11 | Search / Direct URL sub-tabs | `YouTubeSearch.tsx:188-200` | Which kind of YouTube input | merge (into #12) | Same intent (get a song from YouTube), same scope (YouTube). A second tab row inside a tab is a second disclosure level. | One box (#12) | med | No sub-tab row; one input under the import tabs | auto | done |
| 12 | Search input (placeholder as label + icon) and Direct URL input (placeholder only, no label) | `YouTubeSearch.tsx:202-214`, `:235-244` | What to search, or which video | merge + repair: one search box "Search YouTube or paste a link" with the search icon and `aria-label`; the system derives link vs query on submit | Guardrail 2: today the Direct URL field has only a placeholder for a label. After the merge it is a single search box with a visible search icon and an accessible name, which the guardrail allows. Derive: a value starting `http` or containing `youtu` is a link. | The same box | med | Typing words and submitting runs a search; pasting a youtube.com link and submitting downloads it; the input has an accessible name | auto | done (one input, aria-label = placeholder "Search YouTube or paste a link", search icon kept; link rule tightened at verify to "starts with http(s):// or youtube.com/ / youtu.be/", because "contains youtu" sent searches like "youtube worship" to the downloader) |
| 13 | Submit buttons: blue "Search" and green "Download & Analyze" | `YouTubeSearch.tsx:215-232`, `:245-262` | Run it | merge → one submit whose label follows #12 ("Download" for a link, "Search" otherwise) + demote to the neutral import look (#29) | Same form, one action at a time. One primary-styled action per view. | Beside the box | med | Label flips when a link is pasted; disabled while empty; spinner text unchanged | auto | done (one submit: Search / Download, Searching... / Downloading...; neutral look, disabled:opacity-40; label flip checked, nothing submitted) |
| 14 | "Paste a YouTube video URL to download and analyze it directly" | `YouTubeSearch.tsx:263-265` | How to use Direct URL | remove | Instruction for a tab that no longer exists; the placeholder says it | Placeholder of #12 | low | Not shown | auto | done |
| 15 | Disclaimer "Personal use only. Ensure you have rights to download content." + icon | `YouTubeSearch.tsx:269-272` | Legal | keep | Legal (guardrail 7) | — | — | — | — |  |
| 16 | Error box | `YouTubeSearch.tsx:274-278`, copy at `:70,76-77` | What went wrong, what to do | keep + repair: copy points to the merged box ("paste a YouTube link instead") instead of the removed "Direct URL" tab | Error and recovery (guardrail 7); after #11 the old copy would point at nothing | Same place | low | Force an empty search result in code review: message names the link option | auto | done (copy says "paste a YouTube link instead"; checked in code, no search run) |
| 17 | Result thumbnail, title, channel, duration, views | `YouTubeSearch.tsx:287-306` | Pick the right recording (official vs cover) | keep | Each helps choose the version. Critique candidate "remove view counts": kept (assumed), since views tell the official recording from covers. | — | — | — | — |  |
| 18 | Clock icon before the duration | `YouTubeSearch.tsx:300` | None | remove | Decoration; "3:42" reads as a duration on its own | — | low | Duration still shows | auto | done |
| 19 | Per-result "Download & Analyze" (green filled) | `YouTubeSearch.tsx:310-326` | Import this one | keep, demote to the neutral import look (#29) and rename "Download" | Same intent as every other import CTA; one primary-styled action per view. Same action as #13's link submit, so the same name; the critique also flags "Analyze" as out-of-scope wording. | Same place | low | Button reads "Download", still downloads; spinner while downloading | auto | done (reads "Download", neutral look, disabled:opacity-40; not run, no outbound download) |
| 20 | Per-result "Open" link (new tab) | `YouTubeSearch.tsx:328-336` | Preview before downloading | keep | Serves the pick; it navigates, so it is a link. Critique candidate "make the thumbnail the link" is a restructure, not a cut. | — | — | — | — |  |
| 21 | "No results found. Try a different search term." | `YouTubeSearch.tsx:343-347` | Empty results | merge (into #16) | Duplicates the empty-results error (`:70`), and it shows as soon as you type, before any search (`results.length === 0 && query`). The error box keeps the empty-results message (guardrail 7). | Error box #16 | low | Typing without submitting shows nothing; an empty search still shows the error | auto | done (typing without submitting shows nothing) |
| 22 | Local File drop zone (dashed, drag highlight) | `ImportSong.tsx:381-390` | Drop a file | keep | The import affordance | — | — | — | — |  |
| 23 | 64 px upload icon in the drop zone | `ImportSong.tsx:391` | None | remove | Decoration; the dashed zone and its heading say "drop here" | — | low | Drop zone still reads as a target | auto | done |
| 24 | Drop-zone heading ("Drop audio or a .djw map" / "Audio for <title>") | `ImportSong.tsx:392-394` | What to drop; which map is held | keep | Serves the import and the held-map state | — | — | — | — |  |
| 25 | Subtext "Or click the button below to browse" (no map held) | `ImportSong.tsx:398` | How to browse | remove | The button is directly below it; instructions are apologies | Button #26 | low | Button still visible under the heading | auto | done |
| 26 | Subtext "The map is loaded. Drop the recording that goes with it." (map held) | `ImportSong.tsx:397` | Status of the two-step map import | keep | Status | — | — | — | — |  |
| 27 | "Choose Audio File" button (blue filled) | `ImportSong.tsx:400-406` | Browse for a file | keep, demote to the neutral import look (#29) | One primary-styled action per view | Same place | low | Opens the file picker | auto | done |
| 28 | Upload icon inside "Choose Audio File" | `ImportSong.tsx:404` | None | remove | Repeats the label | — | low | Label alone | auto | done |
| 29 | Import CTAs share one look: Search/Download submit, Download & Analyze, Choose Audio File, Generate Demo Track | rows 13, 19, 27, 31 | Same action, same look | demote: all to `bg-gray-700 hover:bg-gray-600` (the app's existing secondary style) | Four filled colors (blue, green, blue, yellow) for one intent; the flow consistency rule wants one look | — | low | All four look alike and still work | auto | done (bg-gray-700 hover:bg-gray-600; disabled:opacity-40 on the two that can be disabled) |
| 30 | Footer "Audio, or a .djw map followed by its audio" | `ImportSong.tsx:418-420` | The map-then-audio order | keep | The heading doesn't say the order; this does. With #25 gone, the critique's "two lines saying the same thing" is down to this one line. | — | — | — | — |  |
| 31 | "Generate Demo Track" button (yellow filled) | `ImportSong.tsx:434-440` | Make the demo | keep, demote to the neutral import look (#29) | One primary-styled action per view; yellow is a third accent hue | Same place | low | Demo still generates and appears in Your songs | auto | done (demo generated and appeared in Your songs) |
| 32 | Sparkles icon inside the Generate button | `ImportSong.tsx:438` | None | remove | Repeats the label | — | low | Label alone | auto | done |
| 33 | 64 px yellow sparkles icon above the demo copy | `ImportSong.tsx:426` | None | remove | Decoration and a third hue | — | low | Demo panel still reads | auto | done |
| 34 | Demo heading "Generate Demo Track" | `ImportSong.tsx:427-429` | None | remove | Repeats the tab label and the button label (three times on one panel) | Tab + button | low | Panel still names the action via its button | auto | done |
| 35 | Demo copy "Create a 60-second synthetic worship track with auto-suggested regions. Perfect for testing the looper features." + spec lines "Includes auto regions: Intro • Verse • Chorus • Bridge" / "120 BPM • 4/4 Time • Clear beat markers" | `ImportSong.tsx:430-444` | What the demo is | merge → one line: "A 60-second synthetic track at 120 BPM for trying the flow." | "Looper" is old framing; the region list is wrong (render gave Intro, V1, Chorus, V2); three blocks say one thing. | One line above the button | low | One line, accurate | auto | done |
| 36 | "Your songs" heading | `Dashboard.tsx:66` | Names the list | keep | Orientation | — | — | — | — |  |
| 37 | Song count beside "Your songs" | `Dashboard.tsx:67` | None | remove | A number that changes no behavior; the list shows the songs | The list | low | Heading alone | auto | done |
| 38 | Empty state "Import a song or generate the demo to start a map." | `Dashboard.tsx:70` | What to do first | keep | Empty-state guidance | — | — | — | — |  |
| 39 | Song row card (bg-gray-900 + border inside the gray-800 section card) | `Dashboard.tsx:76` | Grouping | demote: drop the inner background and border; rows divided by a hairline (`divide-y divide-gray-700`) | Nested cards (critique); the section card already groups them | Same list | low | Rows still separate clearly; no card-in-card | auto | done (divide-y divide-gray-700, py-3) |
| 40 | Song name | `Dashboard.tsx:79` | Which song | keep | Identity | — | — | — | — |  |
| 41 | Song meta: length and BPM ("1:00 · 120 BPM") | `Dashboard.tsx:81-82` | Length and tempo for set planning | keep | Serves set decisions. (BPM repeats the name only for the demo, whose name contains it.) | — | — | — | — |  |
| 41a | Song meta status "Ready" (ready songs) | `Dashboard.tsx:81` | None once ready | remove | Show only the exception (critique), same rule as #53. A ready row already shows Perform; unready rows keep "Needs tap" / "Needs prep". | Row buttons; absence of a "Needs …" status | low | Ready row meta reads "1:00 · 120 BPM"; a needs-tap row still reads "Needs tap · …" | auto | done (ready rows read "1:00 · 120 BPM"; Needs tap / Needs prep path checked in code, no unready song in the fixture) |
| 42 | Delete control (icon-only trash, confirm dialog) | `Dashboard.tsx:85-96` | Delete a song | keep + repair: replace the trash icon with the visible text "Delete" (text-style button, same spot); keep the confirm | Guardrail 1: icon-only controls need a visible text label (only × and search are exempt). Guardrail 6: confirm stays. Critique candidate "move to an overflow menu or Prep": an overflow adds a disclosure level, and Prep is the wrong home for deleting a song. | Same spot | low | "Delete" visible; confirm still asks; cancel keeps the song | auto | done (visible "Delete", aria-label and confirm kept. A demo song was deleted during the apply agent's cancel check; cause found at verify: the DevTools `evaluate_script` tool auto-accepts dialogs by default, so a click fired through it confirms. Not an app bug; re-verified with a real dismiss in the flow walk) |
| 43 | Row next step "Tap in" / "Prep" (blue filled) | `Dashboard.tsx:99-107` | Open the song at its next step | keep, demote to neutral (`bg-gray-700`) | One primary-styled action per view; the row's first button is still its next step. (The critique's alternative, "one primary per card", still gives N primaries in one view.) | Same place | low | Clicking opens Tap or Prep for that song | auto | done |
| 44 | "Re-tap" (tapped rows) | `Dashboard.tsx:108-112` | Redo the grid | see F4 (move to Prep) | — | Prep summary line | med | — | auto | done (F4) |
| 45 | "Re-tap" (ready rows) | `Dashboard.tsx:115-117` | Redo the grid | see F4 (move to Prep) | — | Prep summary line | med | — | auto | done (F4) |
| 46 | "Edit" (ready rows) | `Dashboard.tsx:118-120` | Open Prep | see F3 (rename to "Prep") | — | Same place | low | — | auto | done (F3) |
| 47 | Row "Perform" (emerald filled, ready rows) | `Dashboard.tsx:121-127` | Perform one song | see F7 (demote to neutral) | — | Same place | low | — | auto | done (F7) |
| 48 | "Add to set" | `Dashboard.tsx:130-132` | Build the set | keep | On the primary path (the set feeds "Perform this set"). Critique candidate "merge with set-row Remove into one In-set toggle": counter-pass keeps both, since people look for Remove in the set list. Its silent no-op on songs already in the set is a Follow-up. | — | — | — | — |  |
| 49 | "Set list" heading | `Dashboard.tsx:142` | Orientation | keep | — | — | — | — | — |  |
| 50 | Set empty copy "Add songs from the library. Perform stays off until every song is ready." | `Dashboard.tsx:144` | Why Perform is off | keep | Explains the disabled primary (error prevention) | — | — | — | — |  |
| 51 | Set row background (bg-gray-900 inside the card) | `Dashboard.tsx:148` | Grouping | demote: drop the background, same hairline divider as #39 | Nested cards | Same list | low | Rows still read as a numbered list | auto | done (same divider, py-2) |
| 52 | Set row "N. Song name" | `Dashboard.tsx:150` | Order and song | keep | Serves the set | — | — | — | — |  |
| 53 | Set row "· Ready" (ready songs) | `Dashboard.tsx:151` | None once ready | remove | When every song is ready the button says "Perform this set"; "Ready" on each row adds nothing | Song row meta (#41) | low | Ready rows show only the name | auto | done |
| 54 | Set row "· Needs tap" / "· Needs prep" (unready songs) | `Dashboard.tsx:151` | Which song blocks the set | keep | The button says how many; this says which | — | — | — | — |  |
| 55 | Set row "Remove" | `Dashboard.tsx:153-155` | Take a song out of the set | keep | Reversible; text-style button | — | — | — | — |  |
| 56 | "Perform this set" / "N songs still need prep" | `Dashboard.tsx:160-169` | Start the set | keep | Primary action (guardrail 8) | — | — | — | — |  |

## Keep (don't touch)
- "Perform this set" and its disabled-state count ("1 song still needs prep").
- The helper-down warning and the legal disclaimer.
- The delete confirmation.
- Status meta on each song row ("Needs tap · 3:42 · 72 BPM").

## Counts
State measured (before and after, same browser state): 1440×900, two ready demo songs, one in the set, YouTube tab open with the helper up. After the run, Local File is the default tab; its numbers are listed separately.

| Metric | Before | After (projected) | After (actual) |
|---|---|---|---|
| Interactive controls | 19 | 15 | 15 |
| Words of visible copy | 67 | ~62 | 60 |
| Visible form fields | 1 (2 across the sub-tabs) | 1 | 1 |
| Accent colors | 3 (blue, green/emerald, yellow) | 2 | 2 (blue: tab underline, focus, spinner; emerald: Perform this set). Yellow remains only on the helper-down warning (status). |
| Primary-styled actions | 3 (Perform ×2, Perform this set); 4 once a search is typed | 1 | 1 (Perform this set) |
| Disclosure depth | 2 (import tab → YouTube sub-tab) | 1 | 1 |
| Steps to primary action | 1 | 1 | 1 |
| Row actions (ready song) | 5 (Re-tap, Edit, Perform, Add to set, delete) | 4 | 4 (Prep, Perform, Add to set, Delete) |
| Demo tab words | 37 | ~12 | 14 |
| Local File tab words | 25 | ~18 | 18 |
| Default view (opening tab) | YouTube: 19 controls, 67 words | — | Local File: 14 controls, 67 words, 0 fields |

## Second pass and counter-pass
- Second pass (keep rows re-read): added #5a (default tab), #8 (spinner), #41a ("Ready" on song rows).
- Counter-pass (softening only): kept the Demo tab (#5b), view counts (#17), Delete on the row (#42), and both "Add to set" and set-row "Remove" (#48) instead of the critique's harder verbs.

## Embody check
Still a working home: the set button is the one bright thing, every song shows its status and its next step first, import still has all three sources. The demo and file panels lose their giant icons, which leaves them quieter but not bare: each keeps a heading or a line of copy plus a clear button. Nothing softened.

## Assumptions
- Primary action is "Perform this set" (no analytics).
- Link detection for the merged YouTube box: planned as "starts with `http` or contains `youtu`"; tightened at verify to "starts with `http(s)://`, `youtube.com/` or `youtu.be/`" (with optional `www.`/`m.`) because the planned rule misread searches containing "youtube" as links.
- Default tab moves to Local File (#5a) without knowing which source Kevin uses most. YouTube stays one click away.

## Follow-ups (out of scope)
- Drop the "Suggesting regions..." step for imported songs (it computes and saves regions nothing in the flow reads); owner decision, since it changes saved data.
- Replace "Done!" / "Demo ready!" with a highlight on the new song.
- Header `px-4` vs main `p-6` leaves the wordmark 8 px off the cards' left edge.
- Import errors disappear after 2 s (`ImportSong.tsx:86-90`, `:130-134`, `:230-234`, `:282-286`); make them stay until dismissed.
- "Add to set" on a song already in the set silently does nothing; show "In set".
- Thumbnail `alt` repeats the title for screen readers; use `alt=""`.
- After an import, the whole Library remounts and the import tab snaps back to YouTube.
- `hover:bg-gray-750` on result rows is not a Tailwind class (no-op).
- The search placeholder's examples are cut off at xl widths.
