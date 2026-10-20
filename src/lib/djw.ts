import { parse, stringify } from 'yaml';
import type { JumpAt, Section, SectionType, Song, Tap } from '../types';
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
  /** Seconds where the last section ends, or null for the end of the song. */
  marksEnd: number | null;
}

const JUMPS: JumpAt[] = ['beat', 'bar', 'phrase', 'section'];
const round = (t: number) => Math.round(t * 1000) / 1000;

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
      title: song.title,
      ...(song.artist ? { artist: song.artist } : {}),
      meter: `${song.beatsPerBar}/${song.beatsPerBar === 6 ? 8 : 4}`,
      ...(Object.keys(audio).length ? { audio } : {}),
    },
    grid: {
      beats: grid.beats.map(round),
      downbeats: d.map(round),
    },
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
    })),
  });
}

export function parseDjw(text: string): DjwMap {
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
  const at = (bar: number) => downbeats[Math.min(downbeats.length - 1, Math.max(0, bar - 1))];
  const sections = rows.map((value, i) => {
    const row = record(value, `section ${i + 1}`);
    const name = text_(row.name, `section ${i + 1} name`);
    const type = SECTION_TYPES.some(item => item.type === row.type) ? (row.type as SectionType) : typeFromName(name);
    const jumpAt = JUMPS.includes(row.jump_at as JumpAt) ? (row.jump_at as JumpAt) : DEFAULT_SECTION.jumpAt;
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
    };
  });
  const lastEnd = rows.length ? num(record(rows[rows.length - 1], 'last section').end_bar, 'end_bar') : 0;
  return {
    title: text_(song.title, 'song.title'),
    artist: typeof song.artist === 'string' ? song.artist : '',
    beatsPerBar,
    ...(typeof audio.file === 'string' ? { audioFile: audio.file } : {}),
    ...(typeof audio.source === 'string' ? { source: audio.source } : {}),
    taps: beats.map(t => ({ t, one: onBar.has(round(t)) })),
    sections,
    // v1 end bars stop at the last downbeat, which meant the end of the song.
    marksEnd: lastEnd - 1 < downbeats.length - (doc.djw === 1 ? 1 : 0) ? at(lastEnd) : null,
  };
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
function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`djw ${label} must be a number.`);
  return value;
}
function numbers(value: unknown, label: string): number[] {
  return list(value, label).map((item, i) => num(item, `${label}[${i}]`));
}
