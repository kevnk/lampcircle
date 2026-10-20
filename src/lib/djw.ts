import { parse, stringify } from 'yaml';
import type { SongPart, SongPhase } from '../types';
import { beatsPerBar } from './songMap';

const PART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export interface DjwMap {
  title: string;
  artist?: string;
  meter: string;
  audioFile?: string;
  source?: string;
  downbeats: number[];
  parts: Array<Omit<SongPart, 'id' | 'color'>>;
}

export function parseDjw(text: string): DjwMap {
  const doc = parse(text) as unknown;
  if (!isRecord(doc)) throw new Error('djw file is not a mapping');
  if (doc.djw !== 1) {
    throw new Error(`djw version ${JSON.stringify(doc.djw)} is not supported; expected 1`);
  }
  if (!isRecord(doc.song)) throw new Error('djw song is missing');
  if (!isRecord(doc.grid) || !Array.isArray(doc.grid.downbeats)) {
    throw new Error('djw grid.downbeats is missing');
  }
  if (!Array.isArray(doc.parts)) throw new Error('djw parts is missing');

  const title = requireString(doc.song.title, 'song.title');
  const meter = requireString(doc.song.meter, 'song.meter');
  const artist = optionalString(doc.song.artist, 'song.artist');

  let audioFile: string | undefined;
  let source: string | undefined;
  if (doc.song.audio !== undefined && doc.song.audio !== null) {
    if (!isRecord(doc.song.audio)) throw new Error('djw song.audio must be a mapping');
    audioFile = optionalString(doc.song.audio.file, 'song.audio.file');
    source = optionalString(doc.song.audio.source, 'song.audio.source');
  }

  const downbeats = doc.grid.downbeats.map((value, index) =>
    requireNumber(value, `grid.downbeats[${index}]`),
  );
  const parts = doc.parts.map((value, index) => parsePart(value, index));

  return {
    title,
    ...(artist !== undefined ? { artist } : {}),
    meter,
    ...(audioFile !== undefined ? { audioFile } : {}),
    ...(source !== undefined ? { source } : {}),
    downbeats,
    parts,
  };
}

export function serializeDjw(input: DjwMap): string {
  const audio: { file?: string; source?: string } = {};
  if (input.audioFile !== undefined) audio.file = input.audioFile;
  if (input.source !== undefined) audio.source = input.source;

  return stringify({
    djw: 1,
    song: {
      title: input.title,
      ...(input.artist !== undefined ? { artist: input.artist } : {}),
      meter: input.meter,
      ...(Object.keys(audio).length > 0 ? { audio } : {}),
    },
    grid: {
      downbeats: input.downbeats,
    },
    parts: input.parts.map((part) => ({
      name: part.name,
      start_bar: part.startBar,
      end_bar: part.endBar,
      pickup_beats: part.pickupBeats,
      fade_in: part.fadeInBeats,
      fade_out: part.fadeOutBeats,
      loop: part.loop,
    })),
  });
}

export function phaseFromDjw(map: DjwMap): SongPhase {
  if (map.downbeats.length < 2 || map.parts.length === 0) return { kind: 'needs-tap' };
  const barSeconds = map.downbeats[1] - map.downbeats[0];
  const raw = barSeconds > 0 ? (beatsPerBar(map.meter) * 60) / barSeconds : 0;
  const nearest = Math.round(raw);
  const lockedBpm = raw > 0 ? (Math.abs(raw - nearest) <= 0.1 ? nearest : Math.round(raw * 10) / 10) : null;
  return {
    kind: 'ready',
    downbeats: map.downbeats,
    taps: map.downbeats.slice(0, 8),
    lockedBpm,
    parts: map.parts.map((part, index) => ({
      ...part,
      id: `part-${part.startBar}-${index}`,
      color: PART_COLORS[index % PART_COLORS.length],
    })),
  };
}

function parsePart(value: unknown, index: number): Omit<SongPart, 'id' | 'color'> {
  if (!isRecord(value)) throw new Error(`djw parts[${index}] must be a mapping`);
  if (typeof value.loop !== 'boolean') {
    throw new Error(`djw parts[${index}].loop must be a boolean`);
  }
  return {
    name: requireString(value.name, `parts[${index}].name`),
    startBar: requireNumber(value.start_bar, `parts[${index}].start_bar`),
    endBar: requireNumber(value.end_bar, `parts[${index}].end_bar`),
    pickupBeats: requireNumber(value.pickup_beats, `parts[${index}].pickup_beats`),
    fadeInBeats: requireNumber(value.fade_in, `parts[${index}].fade_in`),
    fadeOutBeats: requireNumber(value.fade_out, `parts[${index}].fade_out`),
    loop: value.loop,
  };
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`djw ${label} must be a string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`djw ${label} must be a number`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
