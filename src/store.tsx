import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Pad, Song, WorshipSet } from './types';
import * as db from './lib/db';
import { unpackLibrary } from './lib/backup';
import { analyzeBlob, helper, importJob, type Job } from './lib/library';
import { uid } from './lib/songMap';

export type Route =
  | { page: 'library' }
  | { page: 'sets'; id?: string }
  | { page: 'song'; id: string; step: 'tap' | 'refine' | 'export' }
  | { page: 'perform'; setId: string; item: number };

export function parseRoute(hash: string): Route {
  const [page, a, b] = hash.replace(/^#\/?/, '').split('/').map(part => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (page === 'sets') return { page: 'sets', ...(a ? { id: a } : {}) };
  if (page === 'song' && a) return { page: 'song', id: a, step: b === 'refine' || b === 'export' ? b : 'tap' };
  if (page === 'perform' && a) return { page: 'perform', setId: a, item: Number(b) || 0 };
  return { page: 'library' };
}

export function hrefOf(route: Route): string {
  switch (route.page) {
    case 'library':
      return '#/library';
    case 'sets':
      return route.id ? `#/sets/${route.id}` : '#/sets';
    case 'song':
      return `#/song/${route.id}/${route.step}`;
    case 'perform':
      return `#/perform/${route.setId}/${route.item}`;
  }
}

export function go(route: Route) {
  window.location.hash = hrefOf(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

interface Store {
  loaded: boolean;
  loadError: string | null;
  songs: Song[];
  pads: Pad[];
  sets: WorshipSet[];
  /** `touch: false` keeps updatedAt, for saves that do not change the map. */
  saveSong: (song: Song, options?: { touch: boolean }) => void;
  addSong: (song: Song) => void;
  removeSong: (id: string) => Promise<void>;
  addPad: (pad: Pad) => void;
  savePad: (pad: Pad) => void;
  removePad: (id: string) => Promise<void>;
  saveSet: (set: WorshipSet) => void;
  removeSet: (id: string) => Promise<void>;
  newSet: () => WorshipSet;
  addToSet: (songId: string) => WorshipSet;
  /** Adds what a library file has that this library does not, by id. Nothing here is changed. */
  importLibrary: (file: Blob) => Promise<{ songs: number; pads: number; sets: number; audio: number }>;
  jobs: Job[];
  helperDown: boolean;
  refreshJobs: () => void;
}

const StoreContext = createContext<Store | null>(null);

// A song record carries about 10k numbers, so taps and live marking write at most every 400 ms.
const pending = new Map<string, Song>();
let flushTimer = 0;
function flush() {
  window.clearTimeout(flushTimer);
  flushTimer = 0;
  for (const song of pending.values()) void db.putSong(song);
  pending.clear();
}
function writeSoon(song: Song) {
  pending.set(song.id, song);
  if (!flushTimer) flushTimer = window.setTimeout(flush, 400);
}
window.addEventListener('pagehide', flush);

function fresh<T extends { id: string }>(items: T[], have: T[]): T[] {
  const ids = new Set(have.map(item => item.id));
  return items.filter(item => !ids.has(item.id));
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
}

export function nextSundayName(from = new Date()): string {
  const date = new Date(from);
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  return `Sunday · ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const latestSongs = useRef(songs);
  latestSongs.current = songs;
  const [pads, setPads] = useState<Pad[]>([]);
  const [sets, setSets] = useState<WorshipSet[]>([]);

  useEffect(() => {
    db.loadAll()
      .then(async all => {
        setSongs(all.songs);
        setPads(all.pads);
        setSets(all.sets);
        setLoaded(true);
        for (const song of all.songs.filter(item => item.peaks.length === 0)) {
          const blob = await db.getAudio(song.id);
          const analysis = blob ? await analyzeBlob(blob).catch(() => null) : null;
          // Merge into the song as it is now, so edits made while this ran are kept.
          const latest = latestSongs.current.find(item => item.id === song.id);
          if (analysis && latest) saveSong({ ...latest, ...analysis }, { touch: false });
        }
      })
      .catch(error => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [helperDown, setHelperDown] = useState(false);
  const [importing] = useState(() => new Set<string>());
  const [failed] = useState(() => new Map<string, string>());
  const [poll, setPoll] = useState(0);
  const refreshJobs = useCallback(() => setPoll(value => value + 1), []);

  useEffect(() => {
    if (!loaded) return;
    let stopped = false;
    // ponytail: two tabs open at once can both import a finished job; claim jobs on the server if that ever matters.
    const check = async () => {
      const list = await helper.jobs().catch(() => null);
      if (stopped) return;
      setHelperDown(list === null);
      if (!list) return setJobs([]);
      setJobs(list);
      for (const job of list.filter(item => item.status === 'done' && !importing.has(item.id))) {
        importing.add(job.id);
        try {
          const item = await importJob(job);
          if ('tonic' in item) setPads(all => [...all, item].sort((a, b) => a.tonic - b.tonic));
          else setSongs(all => [item, ...all]);
          await helper.remove(job.id);
        } catch (error) {
          failed.set(job.id, error instanceof Error ? error.message : 'Could not add this download.');
        }
      }
    };
    void check();
    const timer = window.setInterval(check, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [loaded, poll, importing, failed]);

  const saveSong = useCallback((song: Song, options = { touch: true }) => {
    const next = options.touch ? { ...song, updatedAt: Date.now() } : song;
    setSongs(list => list.map(item => (item.id === next.id ? next : item)));
    latestSongs.current = latestSongs.current.map(item => (item.id === next.id ? next : item));
    writeSoon(next);
  }, []);

  const saveSet = useCallback((set: WorshipSet) => {
    const next = { ...set, updatedAt: Date.now() };
    setSets(list => [next, ...list.filter(item => item.id !== next.id)]);
    void db.putSet(next);
  }, []);

  const newSet = useCallback((): WorshipSet => {
    const set = { id: uid(), name: nextSundayName(), songIds: [], updatedAt: Date.now() };
    saveSet(set);
    return set;
  }, [saveSet]);

  const store = useMemo<Store>(
    () => ({
      loaded,
      loadError,
      songs,
      pads,
      sets,
      saveSong,
      addSong: song => setSongs(list => [song, ...list]),
      removeSong: async id => {
        await db.removeSong(id, sets);
        setSongs(list => list.filter(item => item.id !== id));
        setSets(list => list.map(set => ({ ...set, songIds: set.songIds.filter(songId => songId !== id) })));
      },
      addPad: pad => setPads(list => [...list, pad].sort((a, b) => a.tonic - b.tonic)),
      savePad: pad => {
        setPads(list => list.map(item => (item.id === pad.id ? pad : item)).sort((a, b) => a.tonic - b.tonic));
        void db.putPad(pad);
      },
      removePad: async id => {
        await db.removePad(id);
        setPads(list => list.filter(item => item.id !== id));
      },
      saveSet,
      removeSet: async id => {
        await db.removeSet(id);
        setSets(list => list.filter(item => item.id !== id));
      },
      newSet,
      addToSet: songId => {
        const set = sets[0] ?? { id: uid(), name: nextSundayName(), songIds: [], updatedAt: 0 };
        const next = set.songIds.includes(songId) ? set : { ...set, songIds: [...set.songIds, songId] };
        saveSet(next);
        return next;
      },
      importLibrary: async file => {
        const backup = await unpackLibrary(file);
        const added = { songs: [] as Song[], pads: [] as Pad[], sets: [] as WorshipSet[], audio: 0 };
        // Recordings first, so a song is never stored without its audio. If it stops part way, show what was stored.
        try {
          for (const [id, blob] of backup.audio) {
            if (await db.getAudio(id)) continue;
            // WebKit stores a slice of a picked file as the whole file, so store a copy of just its bytes.
            await db.putAudio(id, new Blob([await blob.arrayBuffer()], { type: blob.type }));
            added.audio++;
          }
          for (const song of fresh(backup.songs, songs)) await db.putSong(song).then(() => added.songs.push(song));
          for (const pad of fresh(backup.pads, pads)) await db.putPad(pad).then(() => added.pads.push(pad));
          for (const set of fresh(backup.sets, sets)) await db.putSet(set).then(() => added.sets.push(set));
        } finally {
          setSongs(list => [...list, ...fresh(added.songs, list)].sort((a, b) => b.addedAt - a.addedAt));
          setPads(list => [...list, ...fresh(added.pads, list)].sort((a, b) => a.tonic - b.tonic));
          setSets(list => [...list, ...fresh(added.sets, list)].sort((a, b) => b.updatedAt - a.updatedAt));
        }
        return { songs: added.songs.length, pads: added.pads.length, sets: added.sets.length, audio: added.audio };
      },
      jobs: jobs.map(job => (failed.has(job.id) ? { ...job, status: 'error' as const, error: failed.get(job.id) } : job)),
      helperDown,
      refreshJobs,
    }),
    [loaded, loadError, songs, pads, sets, saveSong, saveSet, newSet, jobs, helperDown, refreshJobs, failed],
  );

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
