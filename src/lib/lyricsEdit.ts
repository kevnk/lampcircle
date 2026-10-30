import type { Snapshot } from '../audio/engine';
import type { SectionLyric, Song } from '../types';
import { LYRICS_PREFS, slideLead } from './lyricsCue';
import { placeLyrics, withPlacement, type PlaceOptions, type Placement } from './lyricsPlace';
import { beatPos, beatTime, nearestIndex, sectionViews, songGrid, type SectionView } from './songMap';

/** One slide in the Map Song lyrics lane. */
export interface LaneSlide {
  sectionId: string;
  block: string;
  /** Its index in the section's slide bars, and in the block. */
  i: number;
  /** Bars from the section's first bar. */
  bar: number;
  /** Seconds of the recording: its bar, and the next slide's bar or the section's end. */
  start: number;
  end: number;
  /** When the change starts, `lead` beats before its bar: the wedge in front of the box. */
  changeAt: number;
  /** [] is a deliberate blank. */
  lines: string[];
  /** Its section's last slide, so there is no next to merge with. */
  last: boolean;
  /** Other sections show this block too, so new words show there as well. */
  shared: boolean;
  /** Words from YouTube auto captions that nobody has changed yet. */
  check: boolean;
}

/** Every slide the sections show, in song order. Slides past their section's end are left out, as on the screen. */
export function laneSlides(song: Song, prefs = LYRICS_PREFS): LaneSlide[] {
  const grid = songGrid(song);
  const d = grid.downbeats;
  const views = sectionViews(song);
  const lead = song.lyrics?.leadBeats ?? prefs.leadBeats;
  const found = autoWords(song);
  const users = new Map<string, number>();
  for (const view of views) if (view.section.lyric) users.set(view.section.lyric.block, (users.get(view.section.lyric.block) ?? 0) + 1);
  return views.flatMap(view => {
    const lyric = view.section.lyric;
    const block = lyric && song.lyrics?.blocks[lyric.block];
    if (!lyric || !block) return [];
    const bars = shownBars(view, lyric);
    return bars.map((bar, i) => {
      const lines = block[i] ?? [];
      const start = d[view.s + bar];
      return {
        sectionId: view.section.id,
        block: lyric.block,
        i,
        bar,
        start,
        end: i + 1 < bars.length ? d[view.s + bars[i + 1]] : view.end,
        changeAt: beatTime(grid, beatPos(grid, start) - slideLead(view, view.s + bar, lines, lead)),
        lines,
        last: i + 1 === bars.length,
        shared: (users.get(lyric.block) ?? 0) > 1,
        check: found !== null && lines.length > 0 && (found === '' || found.includes(` ${wordsOf(lines)} `)),
      };
    });
  });
}

/**
 * Moves slide `i`'s start to the bar nearest `t`, between the slides either side of it and inside its section. The
 * first slide stays on the section's first bar. Like every edit here, it returns the same song when nothing changes.
 */
export function moveSlideEdge(song: Song, sectionId: string, i: number, t: number): Song {
  const at = target(song, sectionId);
  if (!at || i <= 0 || !Number.isFinite(t)) return song;
  const { view, lyric } = at;
  const bars = lyric.slideBars;
  const length = view.e - view.s;
  if (i >= bars.length || bars[i] >= length) return song;
  const lo = bars[i - 1] + 1;
  const hi = Math.min(bars[i + 1] ?? length, length) - 1;
  const bar = Math.min(hi, Math.max(lo, nearestIndex(songGrid(song).downbeats, t) - view.s));
  return lo > hi || bar === bars[i] ? song : withSlides(song, lyric.block, null, new Map([[sectionId, bars.map((b, k) => (k === i ? bar : b))]]));
}

/** New words for slide `i`, one line per line, '' or '-' for a blank. A block's words show in every section using it. */
export function setSlideText(song: Song, sectionId: string, i: number, text: string): Song {
  return setSlide(song, sectionId, i, slideLines(text));
}

export function makeBlank(song: Song, sectionId: string, i: number): Song {
  return setSlide(song, sectionId, i, []);
}

/**
 * Slide `i` as two slides: `parts`, else its lines in half (one line at its middle word). Every section showing the
 * slide gets the second half on the bar halfway to its next slide, so none is split unless all of them have the room.
 */
export function splitSlide(song: Song, sectionId: string, i: number, parts?: [string[], string[]]): Song {
  const at = target(song, sectionId);
  if (!at || i >= at.block.length || i >= shownBars(at.view, at.lyric).length) return song;
  const [a, b] = parts ?? halves(at.block[i]);
  if (!a.length || !b.length) return song;
  const bars = new Map<string, number[]>();
  for (const view of sectionViews(song)) {
    const lyric = view.section.lyric;
    if (lyric?.block !== at.lyric.block) continue;
    const own = lyric.slideBars;
    const length = view.e - view.s;
    if (i >= own.length) continue;
    // Past the section's end, slide `i` and the ones after it never show. Their bars go, so none points at the wrong words later.
    if (own[i] >= length) {
      bars.set(view.section.id, shownBars(view, lyric));
      continue;
    }
    const to = Math.min(own[i + 1] ?? length, length);
    if (to - own[i] < 2) return song;
    bars.set(view.section.id, [...own.slice(0, i + 1), Math.floor((own[i] + to) / 2), ...own.slice(i + 1)]);
  }
  return withSlides(song, at.lyric.block, [...at.block.slice(0, i), a, b, ...at.block.slice(i + 1)], bars);
}

/** Slide `i` and the next as one slide on `i`'s bar, in every section using the block. Words win over a blank. */
export function mergeNext(song: Song, sectionId: string, i: number): Song {
  const at = target(song, sectionId);
  if (!at || i + 1 >= at.block.length || i + 1 >= shownBars(at.view, at.lyric).length) return song;
  const bars = new Map<string, number[]>();
  for (const section of song.sections) {
    const own = section.lyric?.block === at.lyric.block ? section.lyric.slideBars : [];
    if (own.length > i + 1) bars.set(section.id, own.filter((_, k) => k !== i + 1));
  }
  const slides = [...at.block.slice(0, i), [...at.block[i], ...at.block[i + 1]], ...at.block.slice(i + 2)];
  return withSlides(song, at.lyric.block, slides, bars);
}

/** This section's slide bars for every other section using its block. Bars past a shorter section's end are left out there. */
export function applyBarsToBlock(song: Song, sectionId: string): Song {
  const at = target(song, sectionId);
  if (!at) return song;
  const bars = new Map<string, number[]>();
  for (const view of sectionViews(song)) {
    const lyric = view.section.lyric;
    if (view.section.id === sectionId || lyric?.block !== at.lyric.block) continue;
    const own = at.lyric.slideBars.filter(bar => bar < view.e - view.s);
    if (own.join() !== lyric.slideBars.join()) bars.set(view.section.id, own);
  }
  return bars.size ? withSlides(song, at.lyric.block, null, bars) : song;
}

/** A slide's words as lines on screen: blank lines dropped, a lone '-' a blank. */
export function slideLines(text: string): string[] {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.length === 1 && lines[0] === '-' ? [] : lines;
}

/** Text being edited, split at the cursor into the two slides Cmd+Enter makes. */
export function splitText(text: string, cursor: number): [string[], string[]] {
  return [slideLines(text.slice(0, cursor)), slideLines(text.slice(cursor))];
}

/** Lines per slide and the offset estimate Find lyrics used, so placing again gives the same slides. */
export function placingOf(song: Song): NonNullable<Song['lyricsPlacing']> {
  return { linesPerSlide: 2, autoOffset: false, ...song.lyricsPlacing };
}

/**
 * The song's timed lines placed again, with a new nudge or lines per slide, replacing its slides. Lead and fade stay.
 * Null when Find lyrics has not kept any timed lines.
 */
export function placeAgain(song: Song, change: Partial<Pick<PlaceOptions, 'offset' | 'linesPerSlide'>> = {}): { song: Song; placement: Placement } | null {
  const source = song.lyrics?.source;
  if (!song.timedLyrics?.length || !source) return null;
  const placing = { ...placingOf(song), ...(change.linesPerSlide === undefined ? {} : { linesPerSlide: change.linesPerSlide }) };
  const placement = placeLyrics(song, song.timedLyrics, { source, offset: change.offset ?? song.lyrics?.offset ?? 0, ...placing });
  return { song: { ...withPlacement(song, placement), lyricsPlacing: placing }, placement };
}

const placements = new WeakMap<Song, Placement | null>();

/** Lines left unplaced and whether the offset was estimated aren't kept on the song, so they come from placing it again. */
export function placementOf(song: Song): Placement | null {
  if (!placements.has(song)) placements.set(song, placeAgain(song)?.placement ?? null);
  return placements.get(song)!;
}

/**
 * A Perform snapshot for the Map Song preview: the song playing straight through, `pos` seconds in at context time
 * `ctxNow`. Past the last section there is no song, so the screen goes idle.
 */
export function previewSnapshot(views: SectionView[], pos: number, ctxNow: number, paused: boolean): Snapshot {
  const idx = views.findIndex(view => pos < view.end);
  const next = idx >= 0 ? views[idx + 1] : undefined;
  return {
    paused,
    song:
      idx < 0
        ? null
        : {
            ...{ title: '', idx, pass: 1, repeats: 1, hold: false, bar: 0, beat: 1, beatsPerBar: 4, pos, barsLeft: 0, secondsLeft: 0 },
            next: next ? { idx: idx + 1, reason: 'plan', bars: 0, beats: 0, landingCtx: ctxNow + next.start - pos } : null,
            ...{ ending: false, forced: false, arriving: false },
          },
    ...{ pad: null, padFading: false, clock: null },
  };
}

interface Target {
  view: SectionView;
  lyric: SectionLyric;
  block: string[][];
}

function target(song: Song, sectionId: string): Target | null {
  const view = sectionViews(song).find(item => item.section.id === sectionId);
  const lyric = view?.section.lyric;
  const block = lyric && song.lyrics?.blocks[lyric.block];
  return view && lyric && block ? { view, lyric, block } : null;
}

/** Slide bars inside the section. They're sorted, so index i is still slide i. */
const shownBars = (view: SectionView, lyric: SectionLyric) => lyric.slideBars.filter(bar => bar < view.e - view.s);

function setSlide(song: Song, sectionId: string, i: number, lines: string[]): Song {
  const at = target(song, sectionId);
  if (!at || i >= at.block.length || at.block[i].join('\n') === lines.join('\n')) return song;
  return withSlides(song, at.lyric.block, at.block.map((slide, k) => (k === i ? lines : slide)), new Map());
}

/** The song with a block's slides and some sections' slide bars replaced. */
function withSlides(song: Song, block: string, slides: string[][] | null, bars: Map<string, number[]>): Song {
  return {
    ...song,
    ...(slides && song.lyrics ? { lyrics: { ...song.lyrics, blocks: { ...song.lyrics.blocks, [block]: slides } } } : {}),
    sections: song.sections.map(section => {
      const slideBars = bars.get(section.id);
      return slideBars && section.lyric ? { ...section, lyric: { ...section.lyric, slideBars } } : section;
    }),
  };
}

function halves(lines: string[]): [string[], string[]] {
  if (lines.length > 1) {
    const k = Math.ceil(lines.length / 2);
    return [lines.slice(0, k), lines.slice(k)];
  }
  const words = (lines[0] ?? '').split(' ').filter(Boolean);
  const k = Math.ceil(words.length / 2);
  return [slideLines(words.slice(0, k).join(' ')), slideLines(words.slice(k).join(' '))];
}

/** The words YouTube auto captions gave, as ' a b c ', when that's where the words came from: '' when they're no longer kept. */
function autoWords(song: Song): string | null {
  if (song.lyrics?.source !== 'youtube-auto') return null;
  const lines = song.timedLyrics ?? [];
  return lines.length ? ` ${wordsOf(lines.map(line => line.text))} ` : '';
}

const wordsOf = (lines: string[]) => (lines.join(' ').toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).join(' ');
