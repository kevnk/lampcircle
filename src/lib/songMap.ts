import type { JumpAt, Section, SectionType, Song, Tap } from '../types';
import { followBeats, sectionChroma, type Onsets } from './analysis';
import { detectKey, keyName, parseKey, sameSignature, type MusicKey } from './music';

export const MIN_TAPS = 8;

export interface Grid {
  beats: number[];
  tapped: boolean[];
  /** 1-based position of each beat in its bar. */
  beatInBar: number[];
  downbeats: number[];
  /** The taps behind each beat, more than one where taps merged. Empty for a beat the grid placed itself. */
  sources: Tap[][];
}

export interface SectionView {
  section: Section;
  index: number;
  name: string;
  short: string;
  /** Bars [s, e), 0-based. */
  s: number;
  e: number;
  start: number;
  end: number;
  key: string | null;
}

export type Step = 'tap' | 'sections' | 'refine' | 'export' | 'set' | 'done';

export interface Check {
  id: 'grid' | 'sections' | 'keys' | 'seams';
  ok: boolean;
  text: string;
  fix: Step;
  /** The section the problem is in, for Fix to open. */
  sectionId?: string;
}

export const SECTION_TYPES: Array<{ type: SectionType; label: string; short: string; shade: Shade }> = [
  { type: 'intro', label: 'Intro', short: 'I', shade: 'light' },
  { type: 'verse', label: 'Verse', short: 'V', shade: 'mid' },
  { type: 'prechorus', label: 'Pre-chorus', short: 'PC', shade: 'mid' },
  { type: 'chorus', label: 'Chorus', short: 'C', shade: 'black' },
  { type: 'bridge', label: 'Bridge', short: 'B', shade: 'dark' },
  { type: 'tag', label: 'Tag', short: 'Tag', shade: 'light' },
  { type: 'instrumental', label: 'Instrumental', short: 'Inst', shade: 'dark' },
  { type: 'outro', label: 'Outro', short: 'O', shade: 'light' },
];
export type Shade = 'light' | 'mid' | 'dark' | 'black';

export const DEFAULT_SECTION = {
  pickupBeats: 0,
  fadeInBeats: 1,
  fadeOutBeats: 1,
  repeats: 1,
  jumpAt: 'phrase' as JumpAt,
};

/** crypto.randomUUID only exists on https and localhost; a tablet on the LAN uses plain http. */
export function uid(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

const memo = new WeakMap<object, Map<string, unknown>>();
function cached<T>(owner: object, key: string, make: () => T): T {
  let table = memo.get(owner);
  if (!table) memo.set(owner, (table = new Map()));
  if (!table.has(key)) table.set(key, make());
  return table.get(key) as T;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Every tap is a beat. Gaps get evenly spaced beats; `fill` extends from the edge tempos. Beats the app placed are not `tapped`. */
export function buildGrid(taps: Tap[], beatsPerBar: number, duration: number, fill: boolean): Grid {
  type Merged = Tap & { from: Tap[] };
  const merge = (list: Merged[], gap: number) =>
    list.reduce<Merged[]>((out, tap) => {
      const last = out[out.length - 1];
      if (last && tap.t - last.t < gap) out[out.length - 1] = { ...(last.auto && !tap.auto ? tap : last), one: last.one || tap.one, from: [...last.from, ...tap.from] };
      else out.push(tap);
      return out;
    }, []);
  const within = taps.filter(tap => tap.t >= 0 && tap.t <= duration).sort((a, b) => a.t - b.t);
  // Taps closer than 80 ms are one tap (a double press).
  const distinct = merge(within.map(tap => ({ ...tap, from: [tap] })), 0.08);
  const typical = median(distinct.slice(1).map((tap, i) => tap.t - distinct[i].t));
  const clean = typical > 0 ? merge(distinct, 0.4 * typical) : distinct;
  const gaps = clean.slice(1).map((tap, i) => tap.t - clean[i].t);
  const single = (gap: number) => gap < 1.5 * typical;
  const localBeat = (i: number) => median(gaps.slice(Math.max(0, i - 4), i + 5).filter(single)) || typical;

  const beats: number[] = [];
  const tapped: boolean[] = [];
  const ones: boolean[] = [];
  const sources: Tap[][] = [];
  const add = (t: number, isTap: boolean, one: boolean, from: Tap[] = []) => {
    beats.push(t);
    tapped.push(isTap);
    ones.push(one);
    sources.push(from);
  };
  clean.forEach((tap, i) => {
    if (i > 0) {
      const gap = gaps[i - 1];
      const count = Math.min(10000, Math.max(1, Math.round(gap / localBeat(i - 1)) || 1));
      for (let k = 1; k < count; k++) add(clean[i - 1].t + (gap * k) / count, false, false);
    }
    add(tap.t, !tap.auto, tap.one, tap.from);
  });

  if (fill && beats.length >= 2) {
    const head = median(gaps.slice(0, 8).filter(single)) || typical;
    const tail = median(gaps.slice(-8).filter(single)) || typical;
    const before: number[] = [];
    for (let t = beats[0] - head; t >= 0; t -= head) before.unshift(t);
    beats.unshift(...before);
    tapped.unshift(...before.map(() => false));
    ones.unshift(...before.map(() => false));
    sources.unshift(...before.map(() => []));
    for (let t = beats[beats.length - 1] + tail; t < duration - 0.05; t += tail) add(t, false, false);
  }

  const perBar = Math.max(1, beatsPerBar);
  const beatInBar: number[] = [];
  let anchor = ones.indexOf(true);
  if (anchor < 0) anchor = 0;
  for (let i = 0; i < beats.length; i++) {
    if (ones[i]) anchor = i;
    beatInBar.push((((i - anchor) % perBar) + perBar) % perBar + 1);
  }
  return { beats, tapped, beatInBar, downbeats: beats.filter((_, i) => beatInBar[i] === 1), sources };
}

/**
 * The person's taps plus a beat for everything they did not tap, following the recording out from their taps.
 * Their taps stay as they are. Where a gap between taps cannot be followed, the grid spaces it evenly as before.
 */
export function mapTaps(song: Song, env: Onsets): Tap[] {
  const manual = song.taps.filter(tap => !tap.auto);
  const grid = buildGrid(manual, song.beatsPerBar, song.duration, false);
  const tapped = grid.beats.filter((_, i) => grid.tapped[i]);
  if (tapped.length < 2) return manual;
  const gaps = tapped.slice(1).map((t, i) => t - tapped[i]);
  const typical = median(gaps);
  /** Beat length near the i-th tap, from the single-beat gaps around it. */
  const beatNear = (i: number) => median(gaps.slice(Math.max(0, i - 4), i + 4).filter(gap => gap < 1.5 * typical)) || typical;
  const placed = [...(followBeats(env, tapped[0], beatNear(0), 0) ?? [])];
  for (let i = 1; i < tapped.length; i++) {
    if (gaps[i - 1] > 1.5 * beatNear(i - 1)) placed.push(...(followBeats(env, tapped[i - 1], beatNear(i - 1), tapped[i], true) ?? []));
  }
  const last = tapped.length - 1;
  placed.push(...(followBeats(env, tapped[last], beatNear(last), song.duration) ?? []));
  return [...manual, ...placed.map(t => ({ t, one: false, auto: true }))];
}

export function songGrid(song: Song): Grid {
  return cached(song, 'grid', () => buildGrid(song.taps, song.beatsPerBar, song.duration, song.fill));
}

/** Fractional beat index for a time, extrapolating past the ends. */
export function beatPos(grid: Grid, t: number): number {
  const b = grid.beats;
  const n = b.length;
  if (n < 2) return NaN;
  if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
  if (t >= b[n - 1]) return n - 1 + (t - b[n - 1]) / (b[n - 1] - b[n - 2]);
  const i = upper(b, t) - 1;
  return i + (t - b[i]) / (b[i + 1] - b[i]);
}

export function beatTime(grid: Grid, pos: number): number {
  const b = grid.beats;
  const n = b.length;
  if (n < 2) return NaN;
  if (pos <= 0) return b[0] + pos * (b[1] - b[0]);
  if (pos >= n - 1) return b[n - 1] + (pos - n + 1) * (b[n - 1] - b[n - 2]);
  const i = Math.floor(pos);
  return b[i] + (pos - i) * (b[i + 1] - b[i]);
}

/** Bar is 1-based; bar 0 is a pickup before the first downbeat. */
export function barBeatAt(grid: Grid, t: number): { bar: number; beat: number } | null {
  if (grid.beats.length === 0) return null;
  const beatIndex = Math.max(0, upper(grid.beats, t + 1e-6) - 1);
  return { bar: upper(grid.downbeats, t + 1e-6), beat: grid.beatInBar[beatIndex] };
}

export function nearestIndex(times: number[], t: number): number {
  const i = upper(times, t);
  if (i === 0) return 0;
  if (i === times.length) return times.length - 1;
  return t - times[i - 1] <= times[i] - t ? i - 1 : i;
}

/** First index whose value is greater than t. */
export function upper(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function barSeconds(grid: Grid, bar: number): number {
  const d = grid.downbeats;
  if (d.length < 2) return 2;
  const i = Math.min(Math.max(0, bar), d.length - 2);
  return d[i + 1] - d[i];
}

export function bpmOf(grid: Grid): number | null {
  const gaps = grid.beats.slice(1).map((t, i) => t - grid.beats[i]);
  const beat = median(gaps);
  return beat > 0 ? Math.round((600 / beat)) / 10 : null;
}

/** Tempo of the last few taps, for the Tap screen readout. */
export function liveBpm(grid: Grid): number | null {
  const times = grid.beats.filter((_, i) => grid.tapped[i]).slice(-9);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const typical = median(gaps);
  const beat = median(gaps.filter(gap => gap < 1.5 * typical));
  return beat > 0 ? Math.round(600 / beat) / 10 : null;
}

export function sectionViews(song: Song): SectionView[] {
  return cached(song, 'views', () => {
    const d = songGrid(song).downbeats;
    const n = d.length;
    if (n === 0) return [];
    const kept: Array<{ section: Section; s: number }> = [];
    // A mark past the bars waits for them, rather than show on a bar it was not marked on.
    for (const section of [...song.sections].sort((a, b) => a.at - b.at).filter(item => !pastBars(song, item.at))) {
      const s = nearestIndex(d, section.at);
      const last = kept[kept.length - 1];
      if (last && last.s === s) {
        if (Math.abs(section.at - d[s]) < Math.abs(last.section.at - d[s])) last.section = section;
      } else {
        kept.push({ section, s });
      }
    }
    const lastBar = n > 1 ? d[n - 1] - d[n - 2] : song.duration - d[n - 1];
    const endBar = song.marksEnd >= Math.min(song.duration - 0.05, d[n - 1] + lastBar / 2) ? n : nearestIndex(d, song.marksEnd);
    const totals = new Map<SectionType, number>();
    for (const { section } of kept) totals.set(section.type, (totals.get(section.type) ?? 0) + 1);
    const seen = new Map<SectionType, number>();
    return kept.map(({ section, s }, index) => {
      const e = Math.min(n, Math.max(s + 1, kept[index + 1]?.s ?? endBar));
      const count = (seen.get(section.type) ?? 0) + 1;
      seen.set(section.type, count);
      const numbered = (totals.get(section.type) ?? 0) > 1;
      const info = SECTION_TYPES.find(item => item.type === section.type);
      const name = info ? (numbered ? `${info.label} ${count}` : info.label) : section.name || 'Custom';
      const short = !info
        ? name.slice(0, 3)
        : section.type === 'verse' && numbered
          ? `V${count}`
          : info.short;
      const start = d[s];
      const end = e < n ? d[e] : song.duration;
      const found = detectKey(sectionChroma(song.chroma, start, end));
      return {
        section,
        index,
        name,
        short,
        s,
        e,
        start,
        end,
        key: section.key ?? (found ? keyName(found) : null),
      };
    });
  });
}

export function typeFromName(name: string): SectionType {
  const lower = name.toLowerCase();
  if (/pre-?chorus/.test(lower)) return 'prechorus';
  const match = SECTION_TYPES.find(item => lower.startsWith(item.label.toLowerCase()));
  if (match) return match.type;
  if (/^inst/.test(lower)) return 'instrumental';
  if (/^(ending|end)/.test(lower)) return 'outro';
  return 'custom';
}

export function shadeOf(type: SectionType): Shade {
  return SECTION_TYPES.find(item => item.type === type)?.shade ?? 'mid';
}

/** The stretch after the last section, with its key and whether that key is new. */
export function unmarked(song: Song): { start: number; key: string | null; change: boolean } | null {
  const views = sectionViews(song);
  const d = songGrid(song).downbeats;
  const last = views[views.length - 1];
  const start = last ? last.end : d[0] ?? 0;
  if (last && last.e >= d.length) return null;
  if (song.duration - start < 1) return null;
  const found = detectKey(sectionChroma(song.chroma, start, song.duration));
  const lastKey = last?.key ? parseKey(last.key) : null;
  return {
    start,
    key: found ? keyName(found) : null,
    change: Boolean(found && lastKey && !sameSignature(found, lastKey)),
  };
}

export function songKeys(song: Song): { start: string; end: string } | null {
  const views = sectionViews(song).filter(view => view.key);
  if (views.length > 0) return { start: views[0].key!, end: views[views.length - 1].key! };
  const found = detectKey(sectionChroma(song.chroma, 0, song.duration));
  return found ? { start: keyName(found), end: keyName(found) } : null;
}

export function keysText(keys: { start: string; end: string } | null): string {
  if (!keys) return '—';
  return keys.start === keys.end ? keys.start : `${keys.start} → ${keys.end}`;
}

export function planText(song: Song): string {
  const views = sectionViews(song);
  return views
    .map((view, i) => {
      const prev = views[i - 1]?.key ? parseKey(views[i - 1].key!) : null;
      const key = view.key ? parseKey(view.key) : null;
      const change = i > 0 && prev && key && !sameSignature(prev, key) ? `(${view.key})` : '';
      const repeats = view.section.repeats > 1 ? ` ×${view.section.repeats}` : '';
      return view.short + change + repeats;
    })
    .join(' · ');
}

export function planSeconds(song: Song): number {
  return sectionViews(song).reduce((sum, view) => sum + (view.end - view.start) * view.section.repeats, 0);
}

export function checks(song: Song): Check[] {
  const grid = songGrid(song);
  const views = sectionViews(song);
  const lastBeat = grid.beats[grid.beats.length - 1] ?? 0;
  const gridOk = grid.downbeats.length >= 2 && song.duration - lastBeat <= 2 * barSeconds(grid, grid.downbeats.length);
  const rest = unmarked(song);
  const waiting = song.sections.filter(section => pastBars(song, section.at)).length;
  const sectionsOk = views.length > 0 && views[0].s === 0 && !rest && waiting === 0;
  const keyless = views.filter(view => !view.key);
  const badSeams = views.filter(view => {
    const before = beatPos(grid, view.start);
    const length = beatPos(grid, view.end) - before;
    // A fade-in that reaches before 0:00 is cut short, but singers coming in before the song starts cannot be heard.
    const { pickupBeats, fadeOutBeats, fadeOutEndBeats = 0, repeats } = view.section;
    return beatTime(grid, before - pickupBeats) < -0.05 || fadeOutBeats - fadeOutEndBeats > length || repeats < 1;
  });
  return [
    {
      id: 'grid',
      ok: gridOk,
      text: gridOk ? 'The beat grid covers the song' : `The beat grid stops at ${clock(lastBeat)}. Tap further or map the rest from the song.`,
      fix: 'tap',
    },
    {
      id: 'sections',
      ok: sectionsOk,
      text: sectionsOk
        ? 'Every bar is in a section'
        : waiting > 0
          ? `${waiting === 1 ? 'A section mark is' : `${waiting} section marks are`} past the last bar. Tap further or map the rest from the song.`
          : views.length === 0
            ? 'No sections yet'
            : rest
              ? `Bars after ${clock(rest.start)} are not in a section`
              : 'Bars before the first section are not in a section',
      fix: 'sections',
    },
    {
      id: 'keys',
      ok: views.length > 0 && keyless.length === 0,
      text: keyless.length ? `No key for ${keyless.map(view => view.name).join(', ')}` : 'Every section has a key',
      fix: 'sections',
    },
    {
      id: 'seams',
      ok: badSeams.length === 0,
      text: badSeams.length
        ? `${badSeams.map(view => view.name).join(', ')}: pickup or fades do not fit`
        : 'Every pickup and fade fits',
      fix: 'refine',
      sectionId: badSeams[0]?.section.id,
    },
  ];
}

export function isReady(song: Song): boolean {
  return checks(song).every(check => check.ok);
}

export function nextStep(song: Song, inSet: boolean): Step {
  if (song.taps.length < MIN_TAPS) return 'tap';
  if (!checks(song).find(check => check.id === 'sections')?.ok) return 'sections';
  if (!song.refined) return 'refine';
  if (!isReady(song) || !song.exportedAt || song.updatedAt > song.exportedAt) return 'export';
  return inSet ? 'done' : 'set';
}

export const STEP_LABEL: Record<Step, string> = {
  tap: 'Tap in',
  sections: 'Mark sections',
  refine: 'Transitions',
  export: 'Export .djw',
  set: 'Add to set',
  done: 'Open set',
};

/**
 * A mark with no bar to land on yet: its nearest bar is past the last one, and the song has room for that bar.
 * It stays in the map, and taps or mapping give it its bar.
 */
export function pastBars(song: Song, at: number): boolean {
  const { beats, beatInBar, downbeats } = songGrid(song);
  const last = downbeats[downbeats.length - 1];
  if (last === undefined) return false;
  const n = beats.length;
  const beat = n > 1 ? beats[n - 1] - beats[n - 2] : 0.5;
  const next = beats[n - 1] + (song.beatsPerBar - beatInBar[n - 1] + 1) * beat;
  return at >= (last + next) / 2 && next < song.duration - 0.05;
}

/** Sections cover what you have listened through: a playhead that just crossed their end extends it, and one that reaches the end of the recording runs them out to it. A jump 2 s or more ahead extends nothing. */
export function listenedTo(song: Song, t: number): Song {
  const ahead = t - song.marksEnd;
  if (song.sections.length === 0 || ahead <= 0 || ahead >= 2) return song;
  if (t >= song.duration - 0.05) return { ...song, marksEnd: song.duration };
  return ahead >= 0.5 ? { ...song, marksEnd: t } : song;
}

/**
 * Makes the beat nearest `t` a 1, or takes the mark off it, and adds no beat. Null when no beat is within half a beat.
 * A beat the app placed becomes a tap, so it keeps its 1 if mapping is turned off.
 */
export function toggleOne(song: Song, t: number): Song | null {
  const { beats, sources } = songGrid(song);
  if (beats.length < 2) return null;
  const i = nearestIndex(beats, t);
  const half = Math.min(...[beats[i] - beats[i - 1], beats[i + 1] - beats[i]].filter(gap => gap > 0)) / 2;
  if (Math.abs(t - beats[i]) > half) return null;
  const here = sources[i];
  // Placed by the grid, so there is no tap to change: a new one goes exactly where the beat already is.
  if (here.length === 0) return { ...song, taps: [...song.taps, { t: beats[i], one: true }] };
  const one = !here.some(tap => tap.one);
  // One tap holds the beat: a person's tap if there is one, or else the placed beat the grid kept, which becomes a tap.
  // The others stay placed, or turning mapping off could split the beat, and a placed beat turned into a tap could move it.
  const confirmed = here.every(tap => tap.auto) ? here[0] : null;
  return { ...song, taps: song.taps.map(tap => (!here.includes(tap) ? tap : tap === confirmed ? { t: tap.t, one } : { ...tap, one })) };
}

export function markSection(song: Song, type: SectionType, at: number, name?: string): Song {
  const d = songGrid(song).downbeats;
  if (d.length === 0) return song;
  const s = nearestIndex(d, at);
  // Past the last bar every mark would snap to that one bar, so each would rename the section there instead of adding its own.
  const existing = pastBars(song, at) ? undefined : sectionViews(song).find(view => view.s === s);
  const sections = existing
    ? song.sections.map(item => (item.id === existing.section.id ? { ...item, type, name } : item))
    : [...song.sections, { id: uid(), type, name, at, ...DEFAULT_SECTION }];
  return { ...song, sections, marksEnd: Math.max(song.marksEnd, at) };
}

export function moveSection(song: Song, id: string, bars: number): Song {
  const d = songGrid(song).downbeats;
  const views = sectionViews(song);
  const i = views.findIndex(item => item.section.id === id);
  if (i < 0) return song;
  // It stops a bar short of its neighbours, since two sections on one bar collapse into one.
  const s = Math.min(views[i + 1] ? views[i + 1].s - 1 : d.length - 1, Math.max(views[i - 1] ? views[i - 1].s + 1 : 0, views[i].s + bars));
  if (s === views[i].s) return song;
  return { ...song, sections: song.sections.map(item => (item.id === id ? { ...item, at: d[s] } : item)) };
}

/** Where a cut at `t` lands: the nearest bar, if it falls inside a section rather than on its edge. */
export function cutBar(song: Song, t: number): { view: SectionView; bar: number } | null {
  const view = sectionViews(song).find(item => t >= item.start && t < item.end);
  const bar = nearestIndex(songGrid(song).downbeats, t);
  return view && bar > view.s && bar < view.e ? { view, bar } : null;
}

/** Splits a section at the bar nearest `t`. The second half keeps the label and a key set by hand; its pickup, fades and repeats start fresh. */
export function cutSection(song: Song, t: number): Song {
  const cut = cutBar(song, t);
  if (!cut) return song;
  const { type, name, key } = cut.view.section;
  const at = songGrid(song).downbeats[cut.bar];
  return { ...song, sections: [...song.sections, { id: uid(), type, name, key, at, ...DEFAULT_SECTION }] };
}

export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function keyOf(name: string | null | undefined): MusicKey | null {
  return name ? parseKey(name) : null;
}
