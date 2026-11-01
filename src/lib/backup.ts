import type { Pad, Song, WorshipSet } from '../types';

/** A whole library in one file, to move it from the browser to the Mac app. */
export type Backup = { songs: Song[]; pads: Pad[]; sets: WorshipSet[]; audio: Array<[id: string, blob: Blob]> };

type Entry = { id: string; type: string; offset: number; length: number };

const FORMAT = 'lampcircle-library';

export const libraryFileName = (date = new Date()) =>
  `lampcircle-library-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.lampcircle`;

/** The header's byte length (uint32, little-endian), the JSON header, then each recording's bytes as they are. */
export function packLibrary({ songs, pads, sets, audio }: Backup): Blob {
  let offset = 0;
  const entries: Entry[] = audio.map(([id, blob]) => {
    const entry = { id, type: blob.type, offset, length: blob.size };
    offset += blob.size;
    return entry;
  });
  const header = new TextEncoder().encode(JSON.stringify({ format: FORMAT, version: 1, songs, pads, sets, audio: entries }));
  const size = new DataView(new ArrayBuffer(4));
  size.setUint32(0, header.length, true);
  return new Blob([size, header, ...audio.map(([, blob]) => blob)], { type: 'application/octet-stream' });
}

/** What a restore tells you it added. */
export function addedText({ songs, pads, sets, audio }: { songs: number; pads: number; sets: number; audio: number }): string {
  const counts = ([[songs, 'song'], [pads, 'pad'], [sets, 'set'], [audio, 'recording']] as const)
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}${count === 1 ? '' : 's'}`);
  if (!counts.length) return 'Nothing new to add. Everything in that file is already in your library.';
  return `Added ${counts.length > 1 ? `${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}` : counts[0]}.`;
}

/** Bytes per step. Each one is read when its turn comes, so a large library never sits in memory. */
const PIECE = 1 << 20;

export type BackupStep = { step: 'piece'; name: string; at: number; hex: string } | { step: 'finish'; name: string; size: number };
export type BackupReply = { written?: number; saved?: boolean; error?: string };

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

const toHex = (bytes: Uint8Array) => {
  let text = '';
  for (const byte of bytes) text += HEX[byte];
  return text;
};

/**
 * Hands a backup to src-tauri/src/ios/backup.rs a piece at a time, each piece waiting for the answer to the last,
 * so a failed write stops it there and never passes for a whole backup. True when it was saved, false when cancelled.
 */
export async function sendBackup(file: Blob, name: string, ask: (step: BackupStep) => Promise<BackupReply>, onProgress: (part: number) => void): Promise<boolean> {
  const answer = async (step: BackupStep) => {
    const reply = await ask(step);
    if (reply.error) throw new Error(`The backup was not saved. ${reply.error}`);
    return reply;
  };
  for (let at = 0; at < file.size; at += PIECE) {
    const piece = file.slice(at, at + PIECE);
    const { written } = await answer({ step: 'piece', name, at, hex: toHex(new Uint8Array(await piece.arrayBuffer())) });
    if (written !== at + piece.size) throw new Error('The backup was not saved. It stopped part way.');
    onProgress(written / file.size);
  }
  return (await answer({ step: 'finish', name, size: file.size })).saved === true;
}

/** Reads only the header. Each recording comes back as a slice of the file, read when it is stored. */
export async function unpackLibrary(file: Blob): Promise<Backup> {
  const notOurs = new Error('This is not a Lamp Circle library file.');
  if (file.size < 4) throw notOurs;
  const length = new DataView(await file.slice(0, 4).arrayBuffer()).getUint32(0, true);
  if (4 + length > file.size) throw notOurs;
  let header;
  try {
    header = JSON.parse(await file.slice(4, 4 + length).text());
  } catch {
    throw notOurs;
  }
  if (header?.format !== FORMAT || header.version !== 1 || ![header.songs, header.pads, header.sets, header.audio].every(Array.isArray)) throw notOurs;
  const start = 4 + length;
  const entries = header.audio as Entry[];
  if (!entries.every(entry => typeof entry?.id === 'string' && [entry.offset, entry.length].every(n => Number.isSafeInteger(n) && n >= 0))) throw notOurs;
  if (entries.some(entry => start + entry.offset + entry.length > file.size)) throw new Error('This library file is incomplete. Export it again.');
  return {
    songs: header.songs,
    pads: header.pads,
    sets: header.sets,
    audio: entries.map(entry => [entry.id, file.slice(start + entry.offset, start + entry.offset + entry.length, entry.type)]),
  };
}
