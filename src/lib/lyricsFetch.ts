import type { Song, TimedLine } from '../types';

/** A caption file yt-dlp saved for a YouTube video. Manual files are named `.subs.`, auto ones `.auto.`. */
export interface CaptionTrack {
  kind: 'manual' | 'auto';
  lang: string;
  ext: 'json3' | 'vtt';
  text: string;
}

/** The same ids `lyrics.source` keeps in a .djw. */
export type LyricsSource = 'youtube-subs' | 'youtube-auto' | `lrclib:${number}`;

export interface FoundLyrics {
  lines: TimedLine[];
  source: LyricsSource;
  kind: TimedLine['kind'];
  /** Why the words or times need checking. */
  note?: string;
}

export interface LyricsDeps {
  /** Caption tracks for a song whose source is a YouTube link. */
  captions(song: Song): Promise<CaptionTrack[]>;
  fetch: typeof fetch;
}

const YOUTUBE = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)\S*$/i;
export const isYouTube = (url: string | undefined): url is string => Boolean(url && YOUTUBE.test(url.trim()));

/**
 * Words with times for a song: YouTube manual captions, then LRCLIB synced lyrics matching the recording's length,
 * then YouTube auto captions. Null when none has any. Never throws.
 */
export async function findLyrics(song: Song, deps: Partial<LyricsDeps> = {}): Promise<FoundLyrics | null> {
  const captions = deps.captions ?? appCaptions;
  const fetchFn: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  let tracks: CaptionTrack[] = [];
  if (isYouTube(song.source)) {
    try {
      tracks = await captions(song);
    } catch {
      // No captions: LRCLIB is next anyway.
    }
  }
  const manual = trackLines(tracks, 'manual');
  if (manual.length) return { lines: manual, source: 'youtube-subs', kind: 'manual' };
  const lrc = await lrclibLyrics(song, fetchFn);
  // A record with a note is far from this recording's length. Auto captions are timed to this audio, so they win over it.
  if (lrc && !lrc.note) return lrc;
  const auto = trackLines(tracks, 'auto');
  if (auto.length) return { lines: auto, source: 'youtube-auto', kind: 'auto', note: 'These are YouTube auto captions, so check the words.' };
  return lrc;
}

/** The song with where its words came from, and their times kept for placement. Blocks are placement's job, so any there stay. */
export function withFoundLyrics(song: Song, found: FoundLyrics): Song {
  return { ...song, lyrics: { ...song.lyrics, source: found.source, blocks: song.lyrics?.blocks ?? {} }, timedLyrics: found.lines };
}

/** Captions saved beside the song's download, else fetched now. Loads the platform only when the app runs it, so tests need neither. */
async function appCaptions(song: Song): Promise<CaptionTrack[]> {
  const { platform } = await import('../platform');
  const file = song.audioFile?.split(/[\\/]/).pop();
  const saved = file ? await platform.helper.savedCaptions(file).catch(() => []) : [];
  return saved.length ? saved : platform.helper.captions(song.source!);
}

const LANGS = ['en-orig', 'en', 'en-US', 'en-GB'];

/** Lines from the best track of a kind that has any: plain English first, json3 over vtt. */
function trackLines(tracks: CaptionTrack[], kind: CaptionTrack['kind']): TimedLine[] {
  const rank = (track: CaptionTrack) => (LANGS.indexOf(track.lang) + 1 || LANGS.length + 1) * 2 + (track.ext === 'json3' ? 0 : 1);
  for (const track of tracks.filter(item => item.kind === kind).sort((a, b) => rank(a) - rank(b))) {
    const lines = parseCaptions(track);
    if (lines.length) return lines;
  }
  return [];
}

export function parseCaptions(track: CaptionTrack): TimedLine[] {
  try {
    return track.ext === 'json3' ? parseJson3(track.text, track.kind) : parseVtt(track.text, track.kind);
  } catch {
    return [];
  }
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
}

/** YouTube json3: one event per caption, its words in `segs`, each offset from the event's start. */
export function parseJson3(text: string, kind: CaptionTrack['kind']): TimedLine[] {
  const events = ((JSON.parse(text) as { events?: Json3Event[] }).events ?? []).filter(
    event => !event.aAppend && event.segs?.length && typeof event.tStartMs === 'number',
  );
  const lines = events.flatMap((event, i) => {
    const t = event.tStartMs!;
    const first = event.segs!.find(seg => cleanText(seg.utf8 ?? ''));
    if (!first) return [];
    // An event is how long the caption stays up, which runs over the next one. The line is sung until the next starts.
    const next = events[i + 1]?.tStartMs ?? Infinity;
    const end = Math.min(t + (event.dDurationMs ?? 0), next > t ? next : Infinity);
    return [{ start: (t + (first.tOffsetMs ?? 0)) / 1000, end: end / 1000, text: event.segs!.map(seg => seg.utf8 ?? '').join(''), kind }];
  });
  return cleanLines(lines);
}

const STAMP = /^(?:(\d+):)?(\d+):(\d{2})[.,](\d+)$/;
function stamp(text: string): number {
  const match = STAMP.exec(text.trim());
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`) : NaN;
}
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

/**
 * WebVTT (SRT's comma timings read too). YouTube's auto captions roll: each cue repeats the last line of the cue
 * just before on top, so for auto captions that first line is skipped and each sung line comes out once.
 */
export function parseVtt(text: string, kind: CaptionTrack['kind']): TimedLine[] {
  const lines: TimedLine[] = [];
  let carried = '';
  let carriedUntil = -Infinity;
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const rows = block.split('\n');
    const at = rows.findIndex(row => row.includes('-->'));
    if (at < 0 || /^(NOTE|STYLE|REGION)\b/.test(rows[0])) continue;
    const [from, to] = rows[at].split('-->');
    const start = stamp(from);
    const end = stamp(to.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const texts = rows
      .slice(at + 1)
      .map(row => cleanText(row.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, name: string) => ENTITIES[name])));
    if (kind === 'manual') {
      lines.push({ start, end, text: texts.join(' '), kind });
      continue;
    }
    // Only a cue that follows straight on carries a line over. After a gap, the same words were sung again.
    const carries = start - carriedUntil < 0.1;
    texts.forEach((line, i) => {
      if (line && !(i === 0 && carries && line === carried)) lines.push({ start, end, text: line, kind });
    });
    carried = texts.filter(Boolean).pop() ?? '';
    carriedUntil = end;
  }
  return cleanLines(lines);
}

/**
 * LRC: `[mm:ss.xx]` stamps, several per line allowed. Tags like `[ar:]` are skipped, and `[offset:ms]` moves every
 * line earlier by that much. A line lasts until the next one, up to 8 s, and not past the song's end. The last lasts
 * to the song's end, else 5 s.
 */
export function parseLrc(text: string, duration?: number): TimedLine[] {
  const offset = Number(/^\s*\[offset:\s*([+-]?\d+)\s*\]/im.exec(text)?.[1] ?? 0) / 1000;
  const stamped: Array<{ start: number; text: string }> = [];
  for (const row of text.split(/\r?\n/)) {
    const stamps = /^(?:\s*\[\d+:\d+(?:[.:]\d+)?\])+/.exec(row)?.[0];
    if (!stamps) continue;
    // Word timing tags inside the line are dropped: placement works per line.
    const words = row.slice(stamps.length).replace(/<\d+:\d+(?:[.:]\d+)?>/g, '');
    for (const [, min, sec] of stamps.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)) {
      stamped.push({ start: Math.max(0, Number(min) * 60 + Number(sec.replace(':', '.')) - offset), text: words });
    }
  }
  stamped.sort((a, b) => a.start - b.start);
  // Empty stamped lines still end the line before them. cleanLines drops them after.
  return cleanLines(
    stamped.map((line, i) => {
      const ends = duration && duration > line.start ? duration : Infinity;
      const end = Math.min(stamped[i + 1]?.start ?? (ends < Infinity ? ends : line.start + 5), line.start + 8, ends);
      return { start: line.start, end, text: line.text, kind: 'lrc' as const };
    }),
  );
}

/** Caption noise out: [Music]-style tags, (music) notes and ♪ symbols. */
function cleanText(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\b(music|applause|instrumental|cheering|laughter)\b[^)]*\)/gi, ' ')
    .replace(/[♪♫♬♩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clean text, no empty lines, in time order, each line ending by the time the next starts. An auto caption line that
 * overlaps the one before and repeats it, or grows it word by word, is the same line.
 */
export function cleanLines(lines: TimedLine[]): TimedLine[] {
  const out: TimedLine[] = [];
  for (const line of [...lines].sort((a, b) => a.start - b.start)) {
    const text = cleanText(line.text);
    const prev = out[out.length - 1];
    if (prev && text && line.kind === 'auto' && prev.kind === 'auto' && line.start < prev.end && (text === prev.text || text.startsWith(`${prev.text} `))) {
      prev.text = text;
      prev.end = Math.max(prev.end, line.end);
      continue;
    }
    if (text) out.push({ ...line, text });
  }
  out.forEach((line, i) => {
    const next = out[i + 1]?.start;
    if (next !== undefined && next > line.start && (line.end > next || line.end <= line.start)) line.end = next;
    if (line.end <= line.start) line.end = line.start + 5;
  });
  return out;
}

const VERSION: string = import.meta.env?.VITE_APP_VERSION ?? 'dev';
/** LRCLIB asks every client to name itself. */
const CLIENT = `LampCircle/${VERSION} (https://github.com/kevnk/lampcircle)`;
/** Only Lrclib-Client in a webview: LRCLIB's CORS doesn't allow a User-Agent header, so a browser that sent one would fail. */
const LRCLIB_HEADERS: Record<string, string> = typeof document === 'undefined' ? { 'Lrclib-Client': CLIENT, 'User-Agent': CLIENT } : { 'Lrclib-Client': CLIENT };
const LRCLIB = 'https://lrclib.net/api';

interface LrclibRecord {
  id: number;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
}

/**
 * LRCLIB's synced lyrics: the record matching the recording's length (LRCLIB matches within 2 s), else the search
 * result closest in length, with a note when that's more than 2 s off. Null on a miss or any failure.
 */
export async function lrclibLyrics(song: Pick<Song, 'title' | 'artist' | 'duration'>, fetchFn: typeof fetch): Promise<FoundLyrics | null> {
  const { title, artist } = songQuery(song);
  if (!title) return null;
  const seconds = Math.round(song.duration);
  const query = (params: Record<string, string>) => new URLSearchParams(params).toString();
  if (artist && seconds > 0) {
    const hit = await lrclibGet(`/get?${query({ track_name: title, artist_name: artist, duration: String(seconds) })}`, fetchFn);
    if (isSynced(hit)) return fromRecord(hit, song.duration);
  }
  const searches: Array<Record<string, string>> = [...(artist ? [{ track_name: title, artist_name: artist }] : []), { track_name: title }];
  for (const params of searches) {
    const results = await lrclibGet(`/search?${query(params)}`, fetchFn);
    const synced = Array.isArray(results) ? results.filter(isSynced) : [];
    if (!synced.length) continue;
    return fromRecord(synced.reduce((a, b) => (gap(b, song.duration) < gap(a, song.duration) ? b : a)), song.duration);
  }
  return null;
}

function isSynced(value: unknown): value is LrclibRecord {
  const record = value as LrclibRecord | null;
  return typeof record === 'object' && record !== null && typeof record.id === 'number' && !record.instrumental && Boolean(record.syncedLyrics?.trim());
}

const gap = (record: LrclibRecord, duration: number) => (duration > 0 && typeof record.duration === 'number' ? Math.abs(record.duration - duration) : Infinity);

/** Lines from a record, with a note when its length is more than 2 s off the recording's, so its times may not fit. */
function fromRecord(record: LrclibRecord, duration: number): FoundLyrics | null {
  const lines = parseLrc(record.syncedLyrics!, duration > 0 ? duration : undefined);
  const off = gap(record, duration);
  const note =
    off <= 2
      ? undefined
      : Number.isFinite(off)
        ? `LRCLIB's closest synced lyrics are ${Math.round(off * 10) / 10} s off this recording's length, so the times may not fit.`
        : `LRCLIB's lyrics could not be matched to this recording's length, so the times may not fit.`;
  return lines.length ? { lines, source: `lrclib:${record.id}`, kind: 'lrc', ...(note ? { note } : {}) } : null;
}

/** One LRCLIB GET: its JSON, or null for anything else. After a 429 it waits once, only if asked to wait 5 s or less. */
async function lrclibGet(path: string, fetchFn: typeof fetch, retry = true): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8000);
  let response: Response;
  try {
    response = await fetchFn(`${LRCLIB}${path}`, { headers: LRCLIB_HEADERS, signal: abort.signal });
    if (response.ok) return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (response.status !== 429 || !retry) return null;
  const wait = Number(response.headers.get('Retry-After') ?? 1);
  if (!(wait >= 0 && wait <= 5)) return null;
  await new Promise(resolve => setTimeout(resolve, wait * 1000));
  return lrclibGet(path, fetchFn, false);
}

const NOISE = /\s*[([][^)\]]*\b(official|lyrics?|video|audio|live|visuali[sz]er|music|hd|4k)\b[^)\]]*[)\]]/gi;

/**
 * Title and artist to look a song up by. Video titles carry extras: "Housefires - Good Good Father ⧸⧸ feat. Pat
 * Barrett (Official Music Video)" is "Good Good Father" by Housefires. With no artist, the part after a ⧸⧸ or |
 * (or before a " - ") stands in.
 */
export function songQuery(song: Pick<Song, 'title' | 'artist'>): { title: string; artist: string } {
  const strip = (text: string) =>
    text
      .replace(NOISE, '')
      .replace(/(^|\s+)(feat\.?|ft\.?|featuring)\s.*$/i, '')
      .replace(/\b(official\s+)?(music\s+|lyric\s+|live\s+)?video\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+live$/i, '');
  const [first, ...rest] = song.title.split(/\s*(?:⧸⧸|\/\/|\||｜)\s*/).map(strip);
  let title = first;
  let artist = strip(song.artist.replace(/\s*(VEVO|- Topic)$/i, '')) || rest.find(Boolean) || '';
  const dash = title.indexOf(' - ');
  if (dash > 0) {
    const [a, b] = [title.slice(0, dash).trim(), title.slice(dash + 3).trim()];
    const same = (x: string) => x.toLowerCase() === artist.toLowerCase();
    if (!artist || same(a)) [artist, title] = [artist || a, b];
    else if (same(b)) title = a;
  }
  return { title, artist };
}
