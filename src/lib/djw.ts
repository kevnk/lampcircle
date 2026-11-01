import { Scalar, YAMLSeq, parse, stringify } from 'yaml';
import type { JumpAt, Lyrics, Section, SectionLyric, SectionType, Song, Tap } from '../types';
import { DEFAULT_SECTION, SECTION_TYPES, sectionViews, songGrid, typeFromName } from './songMap';

/** What a .djw file carries: everything about the map, never the audio. */
export interface DjwMap {
  title: string;
  artist: string;
  beatsPerBar: number;
  audioFile?: string;
  source?: string;
  taps: Tap[];
  sections: Omit<Section, 'id'>[];
  lyrics?: Lyrics;
  /** Seconds where the last section ends, or null for the end of the song. */
  marksEnd: number | null;
}

const JUMPS: JumpAt[] = ['beat', 'bar', 'phrase', 'section'];
/** A lyrics slide that is just this is a deliberate blank. */
const BLANK = '-';
const round = (t: number) => Math.round(t * 1000) / 1000;
/** A map can't open without a title, and the Song name field can be left empty. */
const UNTITLED = 'Untitled';

export function serializeDjw(song: Song, options: { includeAudioPath: boolean }): string {
  const grid = songGrid(song);
  const views = sectionViews(song);
  const d = grid.downbeats;
  const audio = {
    ...(options.includeAudioPath && song.audioFile ? { file: song.audioFile } : {}),
    ...(song.source ? { source: song.source } : {}),
  };
  return stringify({
    djw: 2,
    song: {
      title: song.title.trim() || UNTITLED,
      ...(song.artist ? { artist: song.artist } : {}),
      meter: `${song.beatsPerBar}/${song.beatsPerBar === 6 ? 8 : 4}`,
      ...(Object.keys(audio).length ? { audio } : {}),
    },
    grid: {
      beats: grid.beats.map(round),
      downbeats: d.map(round),
    },
    ...(song.lyrics ? { lyrics: lyricsOut(song.lyrics) } : {}),
    sections: views.map(view => ({
      name: view.name,
      type: view.section.type,
      start_bar: view.s + 1,
      end_bar: view.e + 1,
      key: view.key,
      pickup_beats: view.section.pickupBeats,
      fade_in: view.section.fadeInBeats,
      fade_out: view.section.fadeOutBeats,
      ...(view.section.fadeOutEndBeats ? { fade_out_end: view.section.fadeOutEndBeats } : {}),
      repeats: view.section.repeats,
      jump_at: view.section.jumpAt,
      ...(view.section.lyric
        ? { lyrics: view.section.lyric.block, slide_bars: Object.assign(new YAMLSeq<number>(), { flow: true, items: view.section.lyric.slideBars }) }
        : {}),
    })),
  });
}

/** Each block is a literal block: a blank line between slides, one line per line on screen. */
function lyricsOut(lyrics: Lyrics) {
  const literal = (slides: string[][]) =>
    Object.assign(new Scalar(`${slides.map(lines => lines.join('\n') || BLANK).join('\n\n')}\n`), { type: Scalar.BLOCK_LITERAL });
  return {
    ...(lyrics.source ? { source: lyrics.source } : {}),
    ...(lyrics.offset === undefined ? {} : { offset: lyrics.offset }),
    ...(lyrics.leadBeats === undefined ? {} : { lead_beats: lyrics.leadBeats }),
    ...(lyrics.fadeBeats === undefined ? {} : { fade_beats: lyrics.fadeBeats }),
    // Found lyrics that aren't placed yet have a source and no blocks.
    ...(Object.keys(lyrics.blocks).length ? { blocks: Object.fromEntries(Object.entries(lyrics.blocks).map(([id, slides]) => [id, literal(slides)])) } : {}),
  };
}

/** Lyrics never stop a map from opening. What can't be used is left out or clamped, and `warnings` (else the console) says what. */
export function parseDjw(text: string, warnings?: string[]): DjwMap {
  const warn: Warn = message => (warnings ? warnings.push(message) : console.warn(message));
  const doc = parse(text) as unknown;
  if (!isRecord(doc)) throw new Error('This .djw file is not a map.');
  if (doc.djw !== 1 && doc.djw !== 2) throw new Error(`djw version ${JSON.stringify(doc.djw)} is not supported.`);
  const song = record(doc.song, 'song');
  const grid = record(doc.grid, 'grid');
  const meter = text_(song.meter, 'song.meter');
  const beatsPerBar = Number.parseInt(meter, 10) || 4;
  const audio = song.audio === undefined ? {} : record(song.audio, 'song.audio');
  const downbeats = numbers(grid.downbeats, 'grid.downbeats');
  const onBar = new Set(downbeats.map(round));
  const beats = doc.djw === 2 ? numbers(grid.beats, 'grid.beats') : spread(downbeats, beatsPerBar);
  const rows = list(doc.djw === 2 ? doc.sections : doc.parts, doc.djw === 2 ? 'sections' : 'parts');
  const lyrics = readLyrics(doc.lyrics, warn);
  const at = (bar: number) => downbeats[Math.min(downbeats.length - 1, Math.max(0, bar - 1))];
  const sections = rows.map((value, i) => {
    const row = record(value, `section ${i + 1}`);
    const name = text_(row.name, `section ${i + 1} name`);
    const type = SECTION_TYPES.some(item => item.type === row.type) ? (row.type as SectionType) : typeFromName(name);
    const jumpAt = JUMPS.includes(row.jump_at as JumpAt) ? (row.jump_at as JumpAt) : DEFAULT_SECTION.jumpAt;
    // Like sectionViews, the next section's start ends this one. Only the last one goes by its end_bar.
    const next = rows[i + 1];
    const endBar = isRecord(next) ? next.start_bar : row.end_bar;
    const lyric = readLyric(row, name, isNumber(endBar) && isNumber(row.start_bar) ? endBar - row.start_bar : Infinity, lyrics?.blocks, warn);
    return {
      type,
      ...(type === 'custom' ? { name } : {}),
      at: at(num(row.start_bar, `${name} start_bar`)),
      ...(typeof row.key === 'string' && row.key ? { key: row.key } : {}),
      pickupBeats: num(row.pickup_beats, `${name} pickup_beats`),
      fadeInBeats: num(row.fade_in, `${name} fade_in`),
      fadeOutBeats: num(row.fade_out, `${name} fade_out`),
      ...(row.fade_out_end === undefined ? {} : { fadeOutEndBeats: num(row.fade_out_end, `${name} fade_out_end`) }),
      repeats: typeof row.repeats === 'number' ? row.repeats : 1,
      jumpAt,
      ...(lyric ? { lyric } : {}),
    };
  });
  const lastEnd = rows.length ? num(record(rows[rows.length - 1], 'last section').end_bar, 'end_bar') : 0;
  return {
    title: song.title === '' ? UNTITLED : text_(song.title, 'song.title'),
    artist: typeof song.artist === 'string' ? song.artist : '',
    beatsPerBar,
    ...(typeof audio.file === 'string' ? { audioFile: audio.file } : {}),
    ...(typeof audio.source === 'string' ? { source: audio.source } : {}),
    taps: beats.map(t => ({ t, one: onBar.has(round(t)) })),
    sections,
    ...(lyrics ? { lyrics } : {}),
    // v1 end bars stop at the last downbeat, which meant the end of the song.
    marksEnd: lastEnd - 1 < downbeats.length - (doc.djw === 1 ? 1 : 0) ? at(lastEnd) : null,
  };
}

type Warn = (message: string) => void;

function readLyrics(value: unknown, warn: Warn): Lyrics | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    warn('The lyrics in this file could not be read, so they were left out.');
    return undefined;
  }
  if (value.blocks !== undefined && !isRecord(value.blocks)) warn('lyrics.blocks is not a set of named blocks, so it was left out.');
  const blocks = Object.entries(isRecord(value.blocks) ? value.blocks : {}).flatMap(([id, words]) => {
    const slides = typeof words === 'string' ? slidesOf(words) : [];
    if (!slides.length) warn(`Lyrics block "${id}" has no words to show, so it was left out.`);
    return slides.length ? [[id, slides] as const] : [];
  });
  /** An optional field, with a warning when it is there but had to be left out or changed. */
  const field = <T>(key: string, read: (raw: unknown) => T | undefined): T | undefined => {
    const raw = value[key];
    if (raw === undefined) return undefined;
    const out = read(raw);
    if (out !== raw) warn(out === undefined ? `lyrics.${key} could not be read, so it was left out.` : `lyrics.${key} ${JSON.stringify(raw)} became ${out}.`);
    return out;
  };
  const beats = (raw: unknown) => (isNumber(raw) ? Math.min(8, Math.max(0, Math.round(raw * 2) / 2)) : undefined);
  const source = field('source', raw => (typeof raw === 'string' && raw ? raw : undefined));
  const offset = field('offset', raw => (isNumber(raw) ? raw : undefined));
  const leadBeats = field('lead_beats', beats);
  const fadeBeats = field('fade_beats', beats);
  return {
    ...(source === undefined ? {} : { source }),
    ...(offset === undefined ? {} : { offset }),
    ...(leadBeats === undefined ? {} : { leadBeats }),
    ...(fadeBeats === undefined ? {} : { fadeBeats }),
    blocks: Object.fromEntries(blocks),
  };
}

/** A blank line starts a new slide, and each line is a line on screen. */
function slidesOf(words: string): string[][] {
  return words
    .split(/\n\s*\n/)
    .map(slide => slide.split('\n').map(line => line.trim()).filter(Boolean))
    .filter(lines => lines.length)
    .map(lines => (lines.length === 1 && lines[0] === BLANK ? [] : lines));
}

/** Slide bars are whole bars from 0, inside the section when its length is known, sorted, one per slide at most. */
function readLyric(row: Record<string, unknown>, name: string, bars: number, blocks: Lyrics['blocks'] | undefined, warn: Warn): SectionLyric | undefined {
  const block = row.lyrics;
  if (block === undefined) return undefined;
  if (typeof block !== 'string' || !blocks || !Object.prototype.hasOwnProperty.call(blocks, block)) {
    warn(`${name} shows lyrics ${shown(block)}, which this file does not have, so it stays blank.`);
    return undefined;
  }
  const given = Array.isArray(row.slide_bars) ? row.slide_bars : [];
  const kept = [...new Set(given.filter(isNumber).map(bar => Math.max(0, Math.min(Math.ceil(bars) - 1, Math.round(bar)))))]
    .sort((a, b) => a - b)
    .slice(0, blocks[block].length);
  const slideBars = kept.length ? kept : [0];
  if (row.slide_bars !== undefined && shown(slideBars) !== shown(row.slide_bars)) {
    warn(`${name} slide_bars ${shown(row.slide_bars)} became ${JSON.stringify(slideBars)}.`);
  }
  return { block, slideBars };
}

/** JSON for a warning. A YAML alias that loops back on itself can't be JSON, and must not stop the map opening. */
function shown(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** v1 files carry downbeats only. Their beats are evenly spaced inside each bar. */
function spread(downbeats: number[], perBar: number): number[] {
  return downbeats.flatMap((t, i) => {
    const next = downbeats[i + 1] ?? (i > 0 ? t + (t - downbeats[i - 1]) : t + 2);
    return Array.from({ length: perBar }, (_, k) => t + ((next - t) * k) / perBar);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`djw ${label} is missing.`);
  return value;
}
function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`djw ${label} is missing.`);
  return value;
}
function text_(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`djw ${label} must be text.`);
  return value;
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function num(value: unknown, label: string): number {
  if (!isNumber(value)) throw new Error(`djw ${label} must be a number.`);
  return value;
}
function numbers(value: unknown, label: string): number[] {
  return list(value, label).map((item, i) => num(item, `${label}[${i}]`));
}
