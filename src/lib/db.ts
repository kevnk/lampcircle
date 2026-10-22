import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Pad, Section, Song, Tap, WorshipSet } from '../types';
import { DEFAULT_SECTION, typeFromName, uid } from './songMap';

interface Schema extends DBSchema {
  songs: { key: string; value: Song };
  pads: { key: string; value: Pad };
  sets: { key: string; value: WorshipSet };
  audio: { key: string; value: Blob };
}

let ready: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  ready ??= openDB<Schema>('worship-looper', 2, {
    blocked() {
      window.alert('Close other tabs of this app, then reload, so your library can upgrade.');
    },
    async upgrade(database, oldVersion, _newVersion, tx) {
      try {
        await migrate(database, oldVersion, tx);
      } catch (error) {
        // Roll the whole upgrade back rather than keep a half-converted library.
        console.error('Library upgrade failed', error);
        tx.abort();
      }
    },
  });
  return ready;
}

/** v1 kept the audio blob inside each song and a single set list. */
async function migrate(database: IDBPDatabase<Schema>, oldVersion: number, tx: unknown) {
  if (oldVersion < 1) database.createObjectStore('songs', { keyPath: 'id' });
  database.createObjectStore('pads', { keyPath: 'id' });
  database.createObjectStore('sets', { keyPath: 'id' });
  database.createObjectStore('audio');
  if (oldVersion < 1) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the v1 stores are outside the v2 schema
  const legacy = tx as any;
  const songs = legacy.objectStore('songs');
  if (songs.indexNames.contains('by-date')) songs.deleteIndex('by-date');
  for (const old of (await songs.getAll()) as LegacySong[]) {
    await legacy.objectStore('audio').put(old.audioBlob, old.id);
    await songs.put(fromLegacy(old));
  }
  if (database.objectStoreNames.contains('setlist' as never)) {
    const rows = ((await legacy.objectStore('setlist').getAll()) as Array<{ songId: string; order: number }>).sort(
      (a, b) => a.order - b.order,
    );
    if (rows.length) {
      await legacy.objectStore('sets').put({ id: uid(), name: 'Set list', songIds: rows.map(row => row.songId), updatedAt: Date.now() });
    }
    database.deleteObjectStore('setlist' as never);
  }
}

export async function loadAll(): Promise<{ songs: Song[]; pads: Pad[]; sets: WorshipSet[] }> {
  const database = await db();
  const [songs, pads, sets] = await Promise.all([
    database.getAll('songs'),
    database.getAll('pads'),
    database.getAll('sets'),
  ]);
  return {
    songs: songs.sort((a, b) => b.addedAt - a.addedAt),
    pads: pads.sort((a, b) => a.tonic - b.tonic),
    sets: sets.sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

export const putSong = async (song: Song) => void (await (await db()).put('songs', song));
export const putPad = async (pad: Pad) => void (await (await db()).put('pads', pad));
export const putSet = async (set: WorshipSet) => void (await (await db()).put('sets', set));
export const putAudio = async (id: string, blob: Blob) => void (await (await db()).put('audio', blob, id));
export const getAudio = async (id: string) => (await db()).get('audio', id);

export async function removeSong(id: string, sets: WorshipSet[]) {
  const database = await db();
  await database.delete('songs', id);
  await database.delete('audio', id);
  for (const set of sets.filter(item => item.songIds.includes(id))) {
    await database.put('sets', { ...set, songIds: set.songIds.filter(songId => songId !== id) });
  }
}

export async function removePad(id: string) {
  const database = await db();
  await database.delete('pads', id);
  await database.delete('audio', id);
}

export const removeSet = async (id: string) => void (await db()).delete('sets', id);

interface LegacyPart {
  name: string;
  startBar: number;
  endBar: number;
  pickupBeats: number;
  fadeInBeats: number;
  fadeOutBeats: number;
}
interface LegacySong {
  id: string;
  name: string;
  audioBlob: Blob;
  duration: number;
  timeSignature?: string;
  dateAdded: number;
  sourceUrl?: string;
  phase?:
    | { kind: 'needs-tap' }
    | { kind: 'tapped'; downbeats: number[]; marks: Array<{ bar: number; name: string }> }
    | { kind: 'ready'; downbeats: number[]; parts: LegacyPart[] };
}

function fromLegacy(old: LegacySong): Song {
  const perBar = Number.parseInt(old.timeSignature ?? '4', 10) || 4;
  const phase = old.phase ?? { kind: 'needs-tap' as const };
  const downbeats = phase.kind === 'needs-tap' ? [] : phase.downbeats;
  const taps: Tap[] = downbeats.flatMap((t, i) => {
    const next = downbeats[i + 1] ?? (i > 0 ? t + t - downbeats[i - 1] : t + 2);
    return Array.from({ length: perBar }, (_, k) => ({ t: t + ((next - t) * k) / perBar, one: k === 0 }));
  });
  const marks =
    phase.kind === 'ready'
      ? phase.parts.map(part => ({ bar: part.startBar, name: part.name, part }))
      : phase.kind === 'tapped'
        ? phase.marks.map(mark => ({ bar: mark.bar, name: mark.name, part: undefined }))
        : [];
  const sections: Section[] = marks.map(({ bar, name, part }) => ({
    id: uid(),
    type: typeFromName(name),
    ...(typeFromName(name) === 'custom' ? { name } : {}),
    at: downbeats[bar - 1] ?? 0,
    ...DEFAULT_SECTION,
    ...(part ? { pickupBeats: part.pickupBeats, fadeInBeats: part.fadeInBeats, fadeOutBeats: part.fadeOutBeats } : {}),
  }));
  const lastEnd = phase.kind === 'ready' ? phase.parts[phase.parts.length - 1]?.endBar : undefined;
  return {
    id: old.id,
    title: old.name,
    artist: '',
    duration: old.duration,
    ...(old.sourceUrl ? { source: old.sourceUrl } : {}),
    peaks: [],
    chroma: [],
    beatsPerBar: perBar,
    taps,
    fill: false,
    sections,
    // In v1 a last part ending on the final downbeat ran to the end of the song.
    marksEnd: lastEnd && lastEnd < downbeats.length ? downbeats[lastEnd - 1] : old.duration,
    refined: phase.kind === 'ready',
    updatedAt: Date.now(),
    addedAt: old.dateAdded,
  };
}
