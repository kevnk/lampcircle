# Worship Song Looper — rewireframe notes

> **Product name (2026-09-29):** **Lampcircle** (working). Former: Worship Song Looper / `worship-song-looper`. Tagline lean: live song maps — home-church / living-room angle.


Captured 2026-09-27 from Kevin. Current build is a taste / spike only. He will re-wireframe separately later. **Do not implement from these notes yet.**

## What’s working / not

1. **Song import** — great. Keep.
2. **Analyze** — not great. Do **not** fix yet.

## Target flow (three stages)

### 1. Import
Pull / load the track (already good enough as a start).

### 2. Prep page (rework the existing prep)
Should feel like **video / audio track editing software**, not the current looper panels.

Desired Prep behaviors:
- **Cut** the track into pieces
- Cuts **snap to measures or beats**
- Per piece (or cut edges): **fade-in / fade-out**
- Goal: author a clean, timed map of song parts before performance

### 3. Pad page (after Prep)
Performance / stage surface:
- Map **pads** to different parts of the song (the prepared pieces)
- **Smart queue**
  - Click a pad for what you want *next*
  - Wait until the **right beat**
  - **Fade in** so beats line up and the transition is clean
- **Pickup / anacrusis support**
  - Voices often start singing **a beat or two before** the “first” beat of a section
  - Pads / queue / fades must allow that lead-in so entrances feel natural

## Explicit non-goals right now
- No rewire of analyze quality
- No full redesign implementation until Kevin re-wireframes separately
- Current app stays as the working spike for import + taste

## Context from the spike (for later wireframing)
Spike already explored: beat grid, lyrics on grid, regions vs loops, named loops, snap Off/Beat/Measure, overlap crossfades, stage pads, YouTube import. Reuse what worked; don’t carry forward the Prep UX as-is.
