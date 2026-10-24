import { useEffect, useState } from 'react';
import { ListMusic, ListOrdered, Play, Share } from 'lucide-react';
import type { JumpAt, Song, WorshipSet } from '../types';
import { go, parseRoute, useStore, type Route } from '../store';
import { Button, Card, SongHeader, StepPills, beatsLabel } from '../ui';
import { audio } from '../audio/engine';
import { mobile, platform } from '../platform';
import { serializeDjw } from '../lib/djw';
import { fileNameFor } from '../lib/library';
import { bpmOf, checks, isReady, keysText, sectionViews, songGrid, songKeys, uid } from '../lib/songMap';
import { openFiles } from '../screens/Library';
import { doneSteps, stepNav } from '../screens/SongTap';

/**
 * The iPhone and iPad app's own wiring, mounted only there: audio that wakes on the first tap,
 * the set the Perform tab opens, and the debug seed for simulator screenshots.
 */
export function Mobile() {
  const { loaded, saveSet } = useStore();
  useEffect(() => wakeAudioOnTap(), []);
  useEffect(() => {
    rememberSet();
    window.addEventListener('hashchange', rememberSet);
    return () => window.removeEventListener('hashchange', rememberSet);
  }, []);
  useEffect(() => {
    if (loaded) void seed(saveSet);
  }, [loaded, saveSet]);
  return null;
}

/** WebKit keeps audio suspended until a tap. The first one resumes it, and plays a moment of silence to be sure. */
function wakeAudioOnTap(): () => void {
  const events = ['touchend', 'click', 'keydown'];
  const stop = () => events.forEach(type => window.removeEventListener(type, wake, true));
  function wake() {
    const { ctx } = audio();
    if (ctx.state === 'running') return stop();
    const silence = ctx.createBufferSource();
    silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silence.connect(ctx.destination);
    silence.start();
    void ctx.resume().then(() => ctx.state === 'running' && stop());
  }
  events.forEach(type => window.addEventListener(type, wake, true));
  return stop;
}

const LAST_SET = 'lampcircle.lastSet';

/** The set last opened in Sets or Perform, for the Perform tab. */
function rememberSet() {
  const route = parseRoute(window.location.hash);
  const id = route.page === 'perform' ? route.setId : route.page === 'sets' ? route.id : undefined;
  try {
    if (id) localStorage.setItem(LAST_SET, id);
  } catch {
    // Storage is blocked: the Perform tab opens the newest set.
  }
}

function lastSet(): string | null {
  try {
    return localStorage.getItem(LAST_SET);
  } catch {
    return null;
  }
}

let seeded = false;

/** Debug builds only: adds <app data>/dev-seed's files, puts their songs in a set, and opens the screen route.txt names. */
async function seed(saveSet: (set: WorshipSet) => void) {
  if (seeded) return;
  seeded = true;
  // Release builds have no take_dev_seed, so there this rejects and nothing happens.
  const found = await mobile.takeDevSeed().catch(() => null);
  if (!found?.files.length) return;
  const songs = await openFiles(found.files);
  if (!songs.length) return;
  const set = { id: uid(), name: 'Dev seed set', songIds: songs.map(song => song.id), updatedAt: Date.now() };
  saveSet(set);
  if (found.route === 'tap') go({ page: 'song', id: songs[0].id, step: 'tap' });
  if (found.route === 'perform') go({ page: 'perform', setId: set.id, item: 0 });
}

const TABS = [
  ['Library', ListMusic],
  ['Sets', ListOrdered],
  ['Perform', Play],
] as const;

/** The iPhone and iPad navigation, in place of the Mac's sidebar. Perform covers it while a set plays. */
export function TabBar({ route }: { route: Route }) {
  const { sets, songs } = useStore();
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 4000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  /** The set you used last, else the newest. Not ready yet, it opens in Sets to show what is missing. */
  const perform = () => {
    const set = sets.find(item => item.id === lastSet()) ?? sets[0];
    if (!set) {
      go({ page: 'sets' });
      return setHint('Make a set first, then Perform plays it here.');
    }
    const items = set.songIds.map(id => songs.find(song => song.id === id)).filter((song): song is Song => Boolean(song));
    if (items.length > 0 && items.every(isReady)) return go({ page: 'perform', setId: set.id, item: 0 });
    go({ page: 'sets', id: set.id });
    setHint(items.length ? `Finish the songs in ${set.name}, then Perform plays it.` : `Add ready songs to ${set.name}, then Perform plays it.`);
  };

  const active = { Library: route.page === 'library' || route.page === 'song', Sets: route.page === 'sets', Perform: false };
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-side/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {hint && (
        <p role="status" className="absolute inset-x-4 bottom-full mb-3 rounded-xl border border-accent/40 bg-panel px-4 py-3 text-sm shadow-lg shadow-navy/15 dark:shadow-black/50">
          {hint}
        </p>
      )}
      <ul className="grid grid-cols-3 px-[max(0.5rem,env(safe-area-inset-left))]">
        {TABS.map(([label, Icon]) => (
          <li key={label}>
            <button
              type="button"
              aria-current={active[label] ? 'page' : undefined}
              className={`flex w-full flex-col items-center gap-0.5 pb-1.5 pt-2 text-xs ${active[label] ? 'font-semibold text-amber' : 'text-ink/70'}`}
              onClick={() => (label === 'Perform' ? perform() : go({ page: label === 'Library' ? 'library' : 'sets' }))}
            >
              <Icon className={`h-6 w-6 ${active[label] ? 'drop-shadow-[0_0_6px_rgb(var(--accent)/var(--glow))]' : ''}`} aria-hidden />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const JUMP_TEXT: Record<JumpAt, string> = { beat: 'the next beat', bar: 'the next bar', phrase: 'the end of a phrase', section: 'the end of the section' };

/** Transitions and Export on iPhone and iPad: the map to read and a .djw to share. Editing stays on the Mac. */
export function ReadOnlyMap({ song, step }: { song: Song; step: 'refine' | 'export' }) {
  const store = useStore();
  const [status, setStatus] = useState<string | null>(null);
  const views = sectionViews(song);
  const list = checks(song);
  const passing = list.filter(check => check.ok).length;
  const bpm = bpmOf(songGrid(song));
  const meta = [song.artist || 'Unknown artist', bpm ? `${Math.round(bpm)} BPM` : null, keysText(songKeys(song))].filter(Boolean).join(' · ');

  const share = async () => {
    setStatus(null);
    try {
      if (!(await platform.saveText(serializeDjw(song, { includeAudioPath: false }), fileNameFor(song.title)))) return;
      const stamp = Date.now();
      store.saveSong({ ...song, exportedAt: stamp, updatedAt: stamp }, { touch: false });
      setStatus('Shared.');
    } catch (problem) {
      setStatus(problem instanceof Error ? problem.message : String(problem));
    }
  };

  return (
    <div>
      <SongHeader song={song} meta={meta}>
        <StepPills current={[step]} done={doneSteps(song)} onStep={stepNav(song)} />
      </SongHeader>
      <p className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">Transitions and Export are read-only here. Edit on your Mac.</p>
      <Card>
        <ol>
          {views.map(view => (
            <li key={view.section.id} className="border-b border-line px-4 py-3 last:border-0">
              <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-lg font-bold">{view.name}</span>
                <span className="tabular text-sm text-muted">
                  bars {view.s + 1}–{view.e} · {view.key ?? '—'}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted">
                Plays ×{view.section.repeats}. A jump waits for {JUMP_TEXT[view.section.jumpAt]}. Fades in over {beatsLabel(view.section.fadeInBeats)}, out over {beatsLabel(view.section.fadeOutBeats)}
                {view.section.pickupBeats ? `, from ${beatsLabel(view.section.pickupBeats)} early` : ''}.
              </p>
            </li>
          ))}
          {views.length === 0 && <li className="px-4 py-6 text-muted">No sections yet. Map the song first.</li>}
        </ol>
      </Card>
      <Card className="mt-4 p-4">
        <p className="font-medium" role="status">
          {passing === list.length ? `Ready: all ${list.length} checks pass` : `${passing} of ${list.length} checks pass`}
        </p>
        {passing < list.length && (
          <ul className="mt-2 space-y-1 text-sm">
            {list
              .filter(check => !check.ok)
              .map(check => (
                <li key={check.id}>
                  <span className="text-danger">✗</span> {check.text}
                </li>
              ))}
          </ul>
        )}
        <div className="mt-4 grid gap-3">
          <Button tone="primary" onClick={() => void share()}>
            <Share className="h-4 w-4" aria-hidden />
            Share .djw
          </Button>
          {isReady(song) && <Button onClick={() => go({ page: 'sets', id: store.addToSet(song.id).id })}>Add to set</Button>}
        </div>
        {status && <p className="mt-3 text-sm">{status}</p>}
      </Card>
    </div>
  );
}
