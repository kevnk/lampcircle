import type { Pad, Song } from '../types';
import { platform, type Job } from '../platform';
import { decode } from '../audio/engine';
import { analyze, downmix, sectionChroma, type Onsets } from './analysis';
import { putAudio, putPad, putSong } from './db';
import type { DjwMap } from './djw';
import { detectKey, parseKey } from './music';
import { uid } from './songMap';

export type { Job } from '../platform';
export const helper = platform.helper;

/** The pad album used for "Get all 12 keys": Worship Pads, Spontaneous, Vol. 4. */
export const PAD_ALBUM = {
  name: 'Worship Pads · Spontaneous, Vol. 4',
  url: 'https://music.youtube.com/playlist?list=OLAK5uy_nihIu-cOsumBLTxv0bcMTkzFcHVOtjQUA',
};

export const isPlaylist = (url: string) => /[?&]list=/.test(url) && !/[?&]v=/.test(url);

/** Queue a link. A playlist queues each track; `onlyKeys` keeps the pads in those keys. */
export async function queueLink(url: string, kind?: 'song' | 'pad', onlyKeys?: number[]): Promise<number> {
  if (!isPlaylist(url)) {
    await helper.add(url, kind);
    return 1;
  }
  const tracks = (await helper.list(url)).filter(track => {
    if (!onlyKeys) return true;
    const key = padKeyFromTitle(track.title);
    return key !== null && onlyKeys.includes(key);
  });
  for (const track of tracks) await helper.add(track.url, kind, undefined, track.title);
  return tracks.length;
}

export function jobKind(job: Job): 'song' | 'pad' {
  return job.kind ?? (/\bpads?\b/i.test(job.title ?? '') ? 'pad' : 'song');
}

/** Letters and digits only, with accents dropped, so "Cuán" and "cuan" compare equal. */
const squash = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** How strongly a recording's file name points at a map: its saved audio file beats any title, and a longer title beats a shorter one. 0 is not at all. */
export function nameMatch(map: DjwMap, fileName: string): number {
  const name = squash(fileName);
  if (map.audioFile && squash(map.audioFile.split(/[\\/]/).pop()!) === name) return Infinity;
  const title = squash(map.title);
  return title && name.includes(title) ? title.length : 0;
}

/**
 * The waiting .djw map a recording goes to: the one you chose audio for, else, given the recording's
 * file name, the map it names most strongly, else the one waiting longest.
 */
export function mapForRecording(waiting: DjwMap[], chosen: DjwMap | null, fileName?: string): DjwMap | undefined {
  const named = fileName
    ? waiting.reduce<DjwMap | undefined>((best, map) => (nameMatch(map, fileName) > (best ? nameMatch(best, fileName) : 0) ? map : best), undefined)
    : undefined;
  return waiting.find(map => map === chosen) ?? named ?? waiting[0];
}

/** Turn a finished download into a song or pad. */
export async function importJob(job: Job): Promise<Song | Pad> {
  const blob = await helper.file(job.fileName!);
  const raw = job.title ?? job.fileName!.replace(/ \[[^\]]+\]\.\w+$/, '');
  if (jobKind(job) === 'pad') return importPad(blob, { title: raw, source: job.url });
  const meta = job.map ? { title: job.map.title, artist: job.map.artist } : splitTitle(raw, job.artist);
  return importSong(blob, { ...meta, source: job.url, audioFile: job.filePath }, job.map);
}

/** "Leeland - Way Maker (Official Live Video)" becomes title "Way Maker", artist "Leeland". */
export function splitTitle(raw: string, artist = ''): { title: string; artist: string } {
  const clean = raw
    .replace(/\s*[([][^)\]]*\b(official|lyrics?|video|audio|live|visuali[sz]er|music|hd|4k)\b[^)\]]*[)\]]/gi, '')
    .replace(/\.(mp3|m4a|wav|aac|ogg|flac)$/i, '')
    .trim();
  const dash = clean.indexOf(' - ');
  if (dash > 0) return { artist: clean.slice(0, dash).trim(), title: clean.slice(dash + 3).trim() };
  return { title: clean || raw, artist };
}

export function padKeyFromTitle(title: string): number | null {
  const match =
    /\b(?:in|key of)\s+([A-G][#♯b♭]?)(?![a-z])/i.exec(title) ?? /\b([A-G][#♯b♭]?)\s+(?:major\s+)?pads?\b/i.exec(title);
  return match ? parseKey(match[1].toUpperCase().replace(/^(.)B$/, '$1b'))?.tonic ?? null : null;
}

export async function importSong(
  blob: Blob,
  meta: { title: string; artist: string; source?: string; audioFile?: string },
  map?: DjwMap,
): Promise<Song> {
  const buffer = await decode(blob);
  const { peaks, chroma } = analyze(channels(buffer), buffer.sampleRate);
  const now = Date.now();
  const song: Song = {
    id: uid(),
    title: meta.title,
    artist: meta.artist,
    duration: buffer.duration,
    ...(meta.source ? { source: meta.source } : {}),
    ...(meta.audioFile ? { audioFile: meta.audioFile } : {}),
    peaks,
    chroma,
    beatsPerBar: map?.beatsPerBar ?? 4,
    taps: map?.taps ?? [],
    fill: false,
    sections: map ? map.sections.map(section => ({ id: uid(), ...section })) : [],
    marksEnd: map ? (map.marksEnd ?? buffer.duration) : 0,
    refined: Boolean(map),
    updatedAt: now,
    addedAt: now,
  };
  await putAudio(song.id, blob);
  await putSong(song);
  return song;
}

export async function importPad(blob: Blob, meta: { title: string; source?: string }): Promise<Pad> {
  const buffer = await decode(blob);
  const tonic =
    padKeyFromTitle(meta.title) ??
    detectKey(sectionChroma(analyze(channels(buffer), buffer.sampleRate).chroma, 0, buffer.duration))?.tonic ??
    0;
  const pad: Pad = {
    id: uid(),
    title: meta.title,
    tonic,
    duration: buffer.duration,
    ...(meta.source ? { source: meta.source } : {}),
    addedAt: Date.now(),
  };
  await putAudio(pad.id, blob);
  await putPad(pad);
  return pad;
}

/** Songs from v1 have no peaks or chroma until their audio is analyzed once. */
export async function analyzeBlob(blob: Blob): Promise<{ peaks: number[]; chroma: number[][] }> {
  const buffer = await decode(blob);
  return analyze(channels(buffer), buffer.sampleRate);
}

function channels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
}

const found = new WeakMap<AudioBuffer, Promise<Onsets>>();

/** The attacks in a decoded song, found once per buffer in a worker. */
export function onsetsOf(buffer: AudioBuffer): Promise<Onsets> {
  let promise = found.get(buffer);
  if (!promise) {
    const { x, rate } = downmix(channels(buffer), buffer.sampleRate);
    const worker = new Worker(new URL('./onsetWorker.ts', import.meta.url), { type: 'module' });
    promise = new Promise<Onsets>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = event => reject(new Error(event.message));
    }).finally(() => worker.terminate());
    worker.postMessage({ x, rate }, [x.buffer]);
    found.set(buffer, promise);
    promise.catch(() => found.delete(buffer));
  }
  return promise;
}

export function fileNameFor(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song'}.djw`;
}
