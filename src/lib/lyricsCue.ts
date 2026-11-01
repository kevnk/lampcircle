import type { PerfSong, Snapshot } from '../audio/engine';
import type { Lyrics } from '../types';
import { beatPos, beatTime, type SectionView } from './songMap';

/** The app's lead and fade, in beats. A song's own `lyrics.leadBeats` and `fadeBeats` win over them. */
export interface LyricsPrefs {
  leadBeats: number;
  fadeBeats: number;
}

export const LYRICS_PREFS: LyricsPrefs = { leadBeats: 2, fadeBeats: 1 };

/** Seconds in a beat when there is no song to measure one: 120 BPM. */
const IDLE_BEAT = 0.5;

/** What the screen should show, worked out from one Perform snapshot. */
export interface LyricsCue {
  /** The slide up now, one string per line. [] is a blank slide. Null while a song comes in and none of its slides is due: keep what is up. */
  now: string[] | null;
  /** Context seconds when `now` came in. It tells one showing of a slide from the next one with the same words. */
  since: number | null;
  /** The slide that comes in next. Null at the end of the song and while paused. */
  next: string[] | null;
  /** Context seconds when `next` starts to fade in. */
  changeAt: number | null;
  /** Seconds a change takes, measured on the grid where it happens, so it follows the tempo. */
  fadeSeconds: number;
  /** No song, or a song with no words: the screen is black, or shows the logo. */
  idle: boolean;
}

interface Change {
  lines: string[];
  /** Audio seconds of the pass now playing. */
  t: number;
}

/**
 * The slide up now and the next change, from a Perform snapshot. `ctxNow` is the context time the snapshot was taken
 * at. A slide changes `leadBeats` before its bar, and a section's first slide never later than half a beat before its
 * pickup, so the words are up before the singers come in. A blank slide changes on its bar, so it never hides words
 * still being sung. The next pass's slides count back on its own beats from where it lands, so a loop, a hold and a pick
 * all work the same way, and a lead longer than its first slide cues the second before it lands too. A pick too late
 * for its lead, or a plan taken back, shows up as a different `now`.
 */
export function lyricsCue(snapshot: Snapshot, ps: Pick<PerfSong, 'song' | 'grid' | 'views'> | null, ctxNow: number, prefs = LYRICS_PREFS): LyricsCue {
  const lead = ps?.song.lyrics?.leadBeats ?? prefs.leadBeats;
  const fade = ps?.song.lyrics?.fadeBeats ?? prefs.fadeBeats;
  const playing = snapshot.song;
  const view = ps && playing ? ps.views[playing.idx] : undefined;
  if (!ps || !playing || !view || ps.grid.beats.length < 2) return { now: [], since: null, next: null, changeAt: null, fadeSeconds: fade * IDLE_BEAT, idle: true };
  const { grid, views } = ps;
  const d = grid.downbeats;
  const { pos } = playing;
  const lyrics = ps.song.lyrics;
  /** Audio time `beats` before `t`. */
  const before = (t: number, beats: number) => beatTime(grid, beatPos(grid, t) - beats);
  const leadOf = (section: SectionView, bar: number, lines: string[]) => slideLead(section, bar, lines, lead);

  const target = playing.next ? views[playing.next.idx] : undefined;
  const landing = target ? pos + (playing.next!.landingCtx - ctxNow) : Infinity;
  const order: Change[] = slidesOf(view, lyrics)
    .filter(slide => d[slide.bar] < landing - 1e-6)
    .map(slide => ({ lines: slide.lines, t: before(d[slide.bar], leadOf(view, slide.bar, slide.lines)) }));
  if (target) {
    for (const slide of slidesOf(target, lyrics)) {
      order.push({ lines: slide.lines, t: landing + before(d[slide.bar], leadOf(target, slide.bar, slide.lines)) - target.start });
    }
  }
  let i = -1;
  order.forEach((change, k) => {
    if (change.t <= pos + 1e-9) i = k;
  });
  // A slide passed over by a later one with a longer lead never shows.
  const coming = snapshot.paused ? null : order.slice(i + 1).reduce<Change | null>((soonest, change) => (soonest && soonest.t <= change.t ? soonest : change), null);
  const at = coming ? coming.t : pos;
  return {
    now: i >= 0 ? order[i].lines : null,
    since: i >= 0 ? ctxNow + (order[i].t - pos) : null,
    next: coming?.lines ?? null,
    changeAt: coming ? ctxNow + (coming.t - pos) : null,
    fadeSeconds: beatTime(grid, beatPos(grid, at) + fade) - at,
    idle: !views.some(item => slidesOf(item, lyrics).some(slide => slide.lines.length)),
  };
}

/** Beats before its bar (absolute) a slide comes in. A blank comes in on its bar, and only a section's first slide has singers coming in early. */
export function slideLead(view: SectionView, bar: number, lines: string[], lead: number): number {
  return !lines.length ? 0 : bar === view.s ? Math.max(lead, view.section.pickupBeats + 0.5) : lead;
}

/** A section's slides on absolute bars. Before its first slide, and with no words at all, it is blank. */
function slidesOf(view: SectionView, lyrics: Lyrics | undefined): Array<{ bar: number; lines: string[] }> {
  const lyric = view.section.lyric;
  const block = lyric ? lyrics?.blocks[lyric.block] : undefined;
  const own = lyric && block ? lyric.slideBars.map((bar, i) => ({ bar: view.s + bar, lines: block[i] ?? [] })).filter(slide => slide.bar < view.e) : [];
  return own[0]?.bar === view.s ? own : [{ bar: view.s, lines: [] }, ...own];
}

/** What a display puts up: lines joined by newlines, '' for black, or the logo. */
interface Face {
  text: string;
  logo: boolean;
}

/** One instruction to a display: from `changeAtMs`, fade over `fadeMs` to this. A higher `seq` replaces any cue still to come. */
export interface DisplayCue extends Face {
  seq: number;
  /** On the display clock that `CueInput.ms` reads. */
  changeAtMs: number;
  fadeMs: number;
}

export interface CueState {
  seq: number;
  /** What the display has up, apart from `pending`. Null before the first cue. */
  up: Face | null;
  /** The last cue sent for later, until it has surely landed. */
  pending: DisplayCue | null;
  /** A slide tapped on Perform, up until the next slide comes in after the one that was up (`over` is its `since`). */
  tapped: { face: Face; over: number | null } | null;
}

/** A display that joins late is caught up by passing `{ ...state, up: null, pending: null }`. */
export const CUE_START: CueState = { seq: 0, up: null, pending: null, tapped: null };

export interface CueInput {
  /** The context time the cue was worked out for. */
  ctxNow: number;
  /** The display clock now. `Date.now()` on the Mac, where two windows share it; each window's `performance.now()` can stop during sleep. */
  ms: number;
  /** Blank and Logo hold the screen until it goes back to words. Missing means words. */
  mode?: 'words' | 'blank' | 'logo';
  /** Between songs and through songs with no words. Missing means blank. */
  idle?: 'blank' | 'logo';
  /** A slide tapped just now: it goes up at once, and stays until the next change comes due. */
  tap?: string[];
}

/** Seconds for a change that was not cued ahead: a late pick, a plan taken back, a tap, Blank or Logo. */
const QUICK_FADE = 0.25;
/** How far apart the context clock and the display clock may drift between ticks. */
const SLACK_MS = 50;
const BLACK: Face = { text: '', logo: false };
const LOGO: Face = { text: '', logo: true };

/**
 * The cues to send displays, from the latest `lyricsCue`, so they get cues, not frames. Call it every tick: it
 * returns no cues while nothing changes, one to put a slide up now when it is not up (a quick fade), and one for the
 * next change, cued ahead with the full fade. A plan taken back or a pause sends what is up again, to clear the one
 * still to come. A change about to land on a display is never replaced, so clocks a few ms apart cannot make it flicker.
 */
export function nextCue(state: CueState, cue: LyricsCue, input: CueInput): { state: CueState; cues: DisplayCue[] } {
  const { ctxNow, ms, mode = 'words' } = input;
  let { seq, up, pending, tapped } = state;
  if (pending && ms >= pending.changeAtMs + SLACK_MS) [up, pending] = [face(pending), null];
  const idle = input.idle === 'logo' ? LOGO : BLACK;
  const show = (lines: string[]): Face => (lines.length ? { text: lines.join('\n'), logo: false } : cue.idle ? idle : BLACK);
  const auto = cue.now ? show(cue.now) : (up ?? show([]));
  if (input.tap) tapped = { face: { text: input.tap.join('\n'), logo: false }, over: cue.since };
  else if (tapped && (tapped.over === null || cue.since === null ? tapped.over !== cue.since : Math.abs(tapped.over - cue.since) > SLACK_MS / 1000)) tapped = null;
  const want = mode === 'blank' ? BLACK : mode === 'logo' ? LOGO : (tapped?.face ?? auto);
  const next = mode === 'words' && cue.next && cue.changeAt !== null ? show(cue.next) : null;
  const coming = next && !same(next, want) ? { ...next, changeAtMs: ms + (cue.changeAt! - ctxNow) * 1000 } : null;
  const matches = (a: DisplayCue | null, b: typeof coming) =>
    a && b ? same(a, b) && Math.abs(a.changeAtMs - b.changeAtMs) <= SLACK_MS : a === b;
  if (pending && pending.changeAtMs <= ms + SLACK_MS && (same(pending, want) || matches(pending, coming))) {
    return { state: { seq, up, pending, tapped }, cues: [] };
  }
  const cues: DisplayCue[] = [];
  const send = (to: Face, changeAtMs: number, fadeMs: number) => {
    const out = { seq: ++seq, ...face(to), changeAtMs, fadeMs };
    cues.push(out);
    return out;
  };
  if (!up || !same(up, want)) {
    send(want, ms, Math.min(QUICK_FADE, cue.fadeSeconds) * 1000);
    up = want;
    pending = null;
  }
  if (!matches(pending, coming)) pending = coming ? send(coming, coming.changeAtMs, cue.fadeSeconds * 1000) : (send(up, ms, 0), null);
  return { state: { seq, up, pending, tapped }, cues };
}

/** What a display holds: the cue up now and at most one still to come. */
export interface DisplayState {
  seq: number;
  up: DisplayCue | null;
  pending: DisplayCue | null;
}

/** A display taking a cue at `ms`: an older `seq` is ignored, and a newer one replaces any cue still to come. */
export function takeCue(display: DisplayState, cue: DisplayCue, ms: number): DisplayState {
  if (cue.seq <= display.seq) return display;
  const up = display.pending && display.pending.changeAtMs <= ms ? display.pending : display.up;
  return cue.changeAtMs <= ms ? { seq: cue.seq, up: cue, pending: null } : { seq: cue.seq, up, pending: cue };
}

const face = (from: Face): Face => ({ text: from.text, logo: from.logo });
const same = (a: Face, b: Face) => a.text === b.text && a.logo === b.logo;
