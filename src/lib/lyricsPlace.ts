import type { Lyrics, SectionLyric, Song, TimedLine } from '../types';
import { cleanLines, findLyrics, withFoundLyrics, type FoundLyrics, type LyricsDeps } from './lyricsFetch';
import { SECTION_TYPES, beatPos, beatTime, median, sectionViews, songGrid, upper, type Grid, type SectionView } from './songMap';

export interface PlaceOptions {
  /** Where the words came from, kept as `lyrics.source`. */
  source: string;
  /**
   * The nudge: seconds to move every line before placing, -2 to 2, on top of the estimate with `autoOffset`. It is
   * what `lyrics.offset` keeps, so passing that back with the same `autoOffset` places the words the same way again.
   */
  offset?: number;
  /** Lines on a slide, 1 to 4. Missing means 2. */
  linesPerSlide?: number;
  /** Estimate the offset from the beat grid, for LRCLIB records timed to another recording. */
  autoOffset?: boolean;
}

export interface Placement {
  /** Source, offset (the nudge) and blocks. `withPlacement` keeps the song's own lead and fade beside them. */
  lyrics: Lyrics;
  /** Keyed by section id. Sections with no words are left out. */
  sectionLyrics: Record<string, SectionLyric>;
  /** Lines outside every section: before the first, or in the unmarked rest of the song. */
  unplaced: TimedLine[];
  /** Per section id, the slides built from YouTube auto captions, whose words need checking. App only. */
  checkWords: Record<string, number[]>;
  /** Seconds every line moved: the estimate, if any, plus the nudge. */
  offsetUsed: number;
  /** The offset came from the beat grid, so the first line's timing needs checking. */
  offsetEstimated: boolean;
}

interface Slide {
  /** Bars from the section's first bar. */
  bar: number;
  lines: TimedLine[];
}

const EPS = 1e-6;

/**
 * Timed lines placed on the song's sections and bars, as blocks of slides. Lines go to the section they overlap most,
 * or the next one when they start in its pickup. Each section's slides hold `linesPerSlide` lines, and the same words
 * sung in several sections of a type share one block.
 */
export function placeLyrics(song: Song, lines: TimedLine[], options: PlaceOptions): Placement {
  const grid = songGrid(song);
  const views = sectionViews(song);
  const perSlide = Math.min(4, Math.max(1, Math.round(options.linesPerSlide ?? 2)));
  const nudge = Math.round(Math.min(2, Math.max(-2, options.offset || 0)) * 100) / 100;
  const clean = cleanLines(lines);
  const usable = grid.beats.length >= 2 && views.length > 0;
  const offsetEstimated = Boolean(options.autoOffset) && usable;
  const offsetUsed = Math.round(((offsetEstimated ? estimateOffset(clean, grid, views) : 0) + nudge) * 100) / 100;
  const shifted = clean.map(line => ({ ...line, start: line.start + offsetUsed, end: line.end + offsetUsed }));
  const lyrics = (blocks: Lyrics['blocks']): Lyrics => ({ source: options.source, offset: nudge, blocks });
  if (!usable) return { lyrics: lyrics({}), sectionLyrics: {}, unplaced: shifted, checkWords: {}, offsetUsed, offsetEstimated };

  const bySection = views.map(() => [] as TimedLine[]);
  const unplaced: TimedLine[] = [];
  for (const line of tidyLines(shifted, grid, song.beatsPerBar)) {
    const i = sectionOf(line, views, grid);
    (i < 0 ? unplaced : bySection[i]).push(line);
  }
  const slides = views.map((view, i) => (bySection[i].length ? slidesIn(view, bySection[i], grid, perSlide, song.beatsPerBar) : []));

  const groups: Array<{ id: string; text: string[][]; members: SectionView[] }> = [];
  views.forEach((view, i) => {
    if (!slides[i].length) return;
    const text = slides[i].map(slide => slide.lines.map(line => line.text));
    const group = groups.find(item => item.members[0].section.type === view.section.type && sameWords(item.text, text));
    if (group) group.members.push(view);
    else groups.push({ id: '', text, members: [view] });
  });
  const taken = new Set<string>();
  for (const group of groups) {
    const first = group.members[0];
    const label = SECTION_TYPES.find(item => item.type === first.section.type)?.label ?? first.name;
    const base = slug(group.members.length > 1 ? label : first.name);
    let id = base;
    for (let k = 2; taken.has(id); k++) id = `${base}-${k}`;
    taken.add(id);
    group.id = id;
  }

  const sectionLyrics: Record<string, SectionLyric> = {};
  const checkWords: Record<string, number[]> = {};
  for (const group of groups) {
    for (const view of group.members) {
      const own = slides[view.index];
      sectionLyrics[view.section.id] = { block: group.id, slideBars: own.map(slide => slide.bar) };
      const check = own.flatMap((slide, i) => (slide.lines.some(line => line.kind === 'auto') ? [i] : []));
      if (check.length) checkWords[view.section.id] = check;
    }
  }
  return {
    lyrics: lyrics(Object.fromEntries(groups.map(group => [group.id, group.text]))),
    sectionLyrics,
    unplaced,
    checkWords,
    offsetUsed,
    offsetEstimated,
  };
}

/** The song with its placed lyrics: blocks, source and offset set, lead and fade kept, and each section's slides. */
export function withPlacement(song: Song, placement: Placement): Song {
  const { source, offset, blocks } = placement.lyrics;
  const { leadBeats, fadeBeats } = song.lyrics ?? {};
  return {
    ...song,
    lyrics: {
      source,
      offset,
      ...(leadBeats === undefined ? {} : { leadBeats }),
      ...(fadeBeats === undefined ? {} : { fadeBeats }),
      blocks,
    },
    sections: song.sections.map(section => {
      const { lyric: _old, ...rest } = section;
      const lyric = placement.sectionLyrics[section.id];
      return lyric ? { ...rest, lyric } : rest;
    }),
  };
}

/**
 * Find lyrics (step 2), then place them. An LRCLIB record far from the recording's length gets its offset estimated.
 * Null when nothing was found.
 */
export async function findAndPlaceLyrics(
  song: Song,
  deps: Partial<LyricsDeps> = {},
  options: Omit<PlaceOptions, 'source'> = {},
): Promise<{ song: Song; found: FoundLyrics; placement: Placement } | null> {
  const found = await findLyrics(song, deps);
  if (!found) return null;
  const autoOffset = options.autoOffset ?? (found.kind === 'lrc' && Boolean(found.note));
  const placement = placeLyrics(song, found.lines, { ...options, autoOffset, source: found.source });
  return { song: withPlacement(withFoundLyrics(song, found), placement), found, placement };
}

/**
 * Clean-up that needs the beat grid, on lines already through `cleanLines` and in song time:
 * - An LRC line lasts until the next starts, at most 2 bars.
 * - Auto captions are rebuilt into lines. Step 2 keeps one start and end per caption, not per word, so each caption's
 *   words share its time evenly. A new line starts at a gap of half a beat, or on a downbeat once it has 6 words.
 * - The same words starting within a beat of each other are one line.
 * - Lines over 42 characters are split at a comma near the middle, else the middle word, their time split to match.
 */
export function tidyLines(lines: TimedLine[], grid: Grid, beatsPerBar: number): TimedLine[] {
  const pos = (t: number) => beatPos(grid, t);
  const capped = lines.map(line =>
    line.kind === 'lrc' ? { ...line, end: Math.min(line.end, beatTime(grid, pos(line.start) + 2 * beatsPerBar)) } : line,
  );
  const auto = capped.filter(line => line.kind === 'auto');
  const rebuilt = auto.length ? [...capped.filter(line => line.kind !== 'auto'), ...rebuildAuto(auto, grid)].sort((a, b) => a.start - b.start) : capped;
  const merged: TimedLine[] = [];
  for (const line of rebuilt) {
    const prev = merged[merged.length - 1];
    if (prev && plain(prev.text) === plain(line.text) && pos(line.start) - pos(prev.start) <= 1 + EPS) prev.end = Math.max(prev.end, line.end);
    else merged.push({ ...line });
  }
  return merged.flatMap(splitLong);
}

function rebuildAuto(lines: TimedLine[], grid: Grid): TimedLine[] {
  const words = lines.flatMap(line => {
    const parts = line.text.split(' ').filter(Boolean);
    const each = (line.end - line.start) / parts.length;
    return parts.map((text, i) => ({ text, start: line.start + i * each, end: line.start + (i + 1) * each }));
  });
  const out: TimedLine[] = [];
  let run: typeof words = [];
  const flush = () => {
    if (!run.length) return;
    const text = run.map(word => word.text).join(' ');
    out.push({ start: run[0].start, end: run[run.length - 1].end, text: text[0].toUpperCase() + text.slice(1), kind: 'auto' });
    run = [];
  };
  for (const word of words) {
    const prev = run[run.length - 1];
    const gap = prev ? beatPos(grid, word.start) - beatPos(grid, prev.end) : 0;
    const downbeat = prev ? upper(grid.downbeats, word.start + EPS) > upper(grid.downbeats, prev.start + EPS) : false;
    if (gap >= 0.5 - EPS || (run.length >= 6 && downbeat)) flush();
    run.push(word);
  }
  flush();
  return out;
}

function splitLong(line: TimedLine): TimedLine[] {
  const { text } = line;
  if (text.length <= 42) return [line];
  const mid = text.length / 2;
  const nearest = (marks: number[]) => marks.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  const at = (pattern: RegExp) => [...text.matchAll(pattern)].map(match => match.index!);
  // A comma right after the first word or before the last would leave a long line, so only one near the middle counts.
  const comma = nearest(at(/,/g).filter(i => i >= text.length / 4 && i <= (3 * text.length) / 4));
  const cut = comma !== undefined ? comma + 1 : nearest(at(/ /g));
  if (cut === undefined) return [line];
  const time = line.start + ((line.end - line.start) * cut) / text.length;
  return [
    ...splitLong({ ...line, text: text.slice(0, cut).trim(), end: time }),
    ...splitLong({ ...line, text: text.slice(cut).trim(), start: time }),
  ];
}

/** Index into `views`, or -1 when the line is mostly outside every section. */
function sectionOf(line: TimedLine, views: SectionView[], grid: Grid): number {
  const at = beatPos(grid, line.start);
  // Singers come in early: a line starting in a section's pickup (or a beat before it) is sung into that section.
  const pickup = views.findIndex(view => {
    const before = beatPos(grid, view.start) - at;
    return before > EPS && before <= view.section.pickupBeats + 1 + EPS;
  });
  if (pickup >= 0) return pickup;
  let best = -1;
  let most = 0;
  let inside = 0;
  views.forEach((view, i) => {
    const overlap = Math.max(0, Math.min(line.end, view.end) - Math.max(line.start, view.start));
    inside += overlap;
    if (overlap > most) [best, most] = [i, overlap];
  });
  return most > 0 && most >= line.end - line.start - inside ? best : -1;
}

/**
 * A section's lines as slides. A gap of 2 bars with no words starts a new slide, and a gap of 4 bars (also from the
 * section's start, or to its end) puts a blank slide on the first bar after the words stop. A slide comes in on the
 * bar its first line starts in, or the next bar when it starts in that bar's last beat or the section's pickup. The
 * first slide is up from the section's first bar.
 */
function slidesIn(view: SectionView, lines: TimedLine[], grid: Grid, perSlide: number, beatsPerBar: number): Slide[] {
  const pos = (t: number) => beatPos(grid, t);
  const d = grid.downbeats;
  const rel = (bar: number) => Math.min(view.e - view.s - 1, Math.max(0, bar - view.s));
  const barFrom = (t: number) => upper(d, t - EPS);
  const snap = (t: number) => {
    const next = barFrom(t);
    return next < d.length && pos(d[next]) - pos(t) <= Math.max(1, view.section.pickupBeats) + EPS ? next : next - 1;
  };
  const slides: Slide[] = [];
  let slide: Slide | null = null;
  // Quiet runs from the section's start until the first words, then from where the words so far ended.
  let wordsEnd = view.start;
  for (const [i, line] of lines.entries()) {
    const gap = pos(line.start) - pos(wordsEnd);
    if (gap >= 4 * beatsPerBar - EPS) slides.push({ bar: rel(barFrom(wordsEnd)), lines: [] });
    if (!slide || slide.lines.length >= perSlide || gap >= 2 * beatsPerBar - EPS) slides.push((slide = { bar: rel(snap(line.start)), lines: [] }));
    slide.lines.push(line);
    wordsEnd = i ? Math.max(wordsEnd, line.end) : line.end;
  }
  if (pos(view.end) - pos(wordsEnd) >= 4 * beatsPerBar - EPS) slides.push({ bar: rel(barFrom(wordsEnd)), lines: [] });
  // Slides on one bar are one slide. Words win over a blank.
  const merged = slides.reduce<Slide[]>((out, next) => {
    const last = out[out.length - 1];
    if (last && last.bar >= next.bar) last.lines.push(...next.lines);
    else out.push(next);
    return out;
  }, []);
  merged[0].bar = 0;
  return merged;
}

/**
 * Seconds to move an LRCLIB record timed to another recording, from -10 to 10 s: where the most line starts land on a
 * downbeat or just before one. That scores the same a whole bar later, so lines that come in after a bar or more of
 * quiet also score when they land on a sung section's start or its pickup, which picks the bar. The first line counts
 * double there, on the first sung section: the intro's length is what usually differs. Ties go to the smallest move.
 */
function estimateOffset(lines: TimedLine[], grid: Grid, views: SectionView[]): number {
  const ones = grid.beatInBar.flatMap((beat, i) => (beat === 1 ? [i] : []));
  const starts = views
    .filter(view => view.section.type !== 'intro' && view.section.type !== 'instrumental')
    .map(view => ({ at: beatPos(grid, view.start), before: view.section.pickupBeats + 1 }));
  const bar = median(grid.downbeats.slice(1).map((t, i) => t - grid.downbeats[i])) || 2;
  const entrance = lines.map((line, i) => i === 0 || line.start - lines[i - 1].end >= bar);
  /** 1 on a downbeat, down to 0 a quarter beat after it and to 0.5 a beat before it. */
  const onBar = (at: number) => {
    const next = ones[upper(ones, at - 0.25)];
    if (next === undefined) return 0;
    const before = next - at;
    return before < 0 ? 1 + before / 0.25 : before <= 1 ? 1 - before / 2 : 0;
  };
  const score = (offset: number) =>
    lines.reduce((sum, line, i) => {
      const at = beatPos(grid, line.start + offset);
      const lands = (start: { at: number; before: number }) => start.at - at >= -0.25 && start.at - at <= start.before;
      return sum + onBar(at) + (entrance[i] && starts.some(lands) ? 2 : 0) + (i === 0 && starts[0] && lands(starts[0]) ? 2 : 0);
    }, 0);
  let best = 0;
  let top = score(0);
  for (let k = 1; k <= 200; k++) {
    for (const step of [k, -k]) {
      const value = score(step / 20);
      if (value > top + EPS) [best, top] = [step / 20, value];
    }
  }
  return best;
}

/** Same slide count, and each slide has at least 90% of its words the same, so no slide shows words that weren't sung. */
function sameWords(a: string[][], b: string[][]): boolean {
  return (
    a.length === b.length &&
    a.every((lines, i) => {
      const [x, y] = [wordsOf(lines), wordsOf(b[i])];
      return lcs(x, y) >= 0.9 * Math.max(x.length, y.length);
    })
  );
}

const wordsOf = (lines: string[]) => lines.join(' ').toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
const plain = (text: string) => wordsOf([text]).join(' ');
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lyrics';

function lcs(a: string[], b: string[]): number {
  let row = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const next = [0];
    b.forEach((other, j) => next.push(word === other ? row[j] + 1 : Math.max(row[j + 1], next[j])));
    row = next;
  }
  return row[b.length];
}
