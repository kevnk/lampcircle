import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Pause, Play } from 'lucide-react';
import type { Song } from '../types';
import { go, useStore } from '../store';
import { useFrame, useKeys } from '../ui';
import { PerformSession, audio, now, padSourceFor, perfSong, release, type PerfSong, type Snapshot } from '../audio/engine';
import { KEY_NAMES, numeral, padGroups, route } from '../lib/music';
import { barSeconds, clock, keyOf, planSeconds, sectionViews, songGrid, songKeys } from '../lib/songMap';
import type { JumpFade, Reason } from '../lib/performPlan';
import { livePad, songBpm } from './Sets';

type PadMode = 'simple' | 'guided' | 'advanced';
interface Prefs {
  mode: PadMode;
  changeOn: 'beat' | 'bar';
  crossfade: 'beat' | 'bar' | 'bars';
  countIn: boolean;
  keepPad: boolean;
  padVolume: number;
  jumpFade: JumpFade;
  fillGaps: boolean;
  fadePause: boolean;
}
const DEFAULT_PREFS: Prefs = { mode: 'advanced', changeOn: 'bar', crossfade: 'beat', countIn: true, keepPad: true, padVolume: 0.8, jumpFade: 'out', fillGaps: true, fadePause: true };
/** Bars that Pause fades out over and Resume fades back in over, when fading is on. */
const PAUSE_FADE = { out: 3, in: 2 };

const JUMP_FADES: Array<[JumpFade, string, string]> = [
  ['out', 'Match the fade-out', 'The section you pick fades in where this one fades out.'],
  ['in', 'Match the fade-in', 'This section fades out where the one you pick fades in.'],
  ['edited', 'As edited', 'Each section keeps the fades you set in Refine.'],
];

const option = (active: boolean) => `rounded-md border px-3.5 py-2.5 ${active ? 'border-stage-text bg-stage-text text-stage-bg' : 'border-stage-line hover:bg-stage-card'}`;

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('djw.perform') ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

const RULE_TEXT = { beat: 'at the next beat', bar: 'at the next bar', phrase: 'at end of phrase', section: 'at end of section' };

export function Perform({ setId, item }: { setId: string; item: number }) {
  const { sets, songs, pads } = useStore();
  const set = sets.find(entry => entry.id === setId);
  const items = useMemo(
    () => (set?.songIds ?? []).map(id => songs.find(song => song.id === id)).filter((song): song is Song => Boolean(song)),
    [set, songs],
  );
  const [current, setCurrent] = useState(item);
  const [started, setStarted] = useState(item % 2 === 1);
  const [loadedSongs, setLoadedSongs] = useState<Record<string, PerfSong>>({});
  const [prefs, setPrefs] = useState(loadPrefs);
  const [exitArmed, setExitArmed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(item % 2 === 1);
  const [startAt, setStartAt] = useState(0);
  const sessionRef = useRef<PerformSession | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const lastWalk = useRef(-1);
  useFrame(true);

  const savePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem('djw.perform', JSON.stringify(next));
    } catch {
      // Private mode: keep the choice for this visit only.
    }
    if (patch.padVolume !== undefined) sessionRef.current?.setPadVolume(patch.padVolume);
    if (sessionRef.current) Object.assign(sessionRef.current, { jumpFade: next.jumpFade, fillGaps: next.fillGaps });
  };

  useEffect(() => {
    const session = new PerformSession(padSourceFor(pads));
    sessionRef.current = session;
    session.setPadVolume(prefs.padVolume);
    Object.assign(session, { jumpFade: prefs.jumpFade, fillGaps: prefs.fillGaps });
    if (import.meta.env.DEV) Object.assign(window, { __djw: { ...(window as unknown as { __djw?: object }).__djw, session } });
    return () => session.dispose();
  }, []);

  // Only the song playing and the one after it stay decoded; each is about 100 MB.
  const songIndex = Math.floor(current / 2);
  useEffect(() => {
    let cancelled = false;
    const needed = [items[songIndex], items[songIndex + 1]].filter((song): song is Song => Boolean(song));
    const ids = needed.map(song => song.id);
    release(ids);
    setLoadedSongs(all => Object.fromEntries(Object.entries(all).filter(([id]) => ids.includes(id))));
    for (const song of needed) {
      void perfSong(song).then(ps => {
        if (!cancelled) setLoadedSongs(all => ({ ...all, [song.id]: ps }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [items, songIndex]);

  const session = sessionRef.current;
  const snap: Snapshot | null = session?.snapshot() ?? null;
  const have = new Set(pads.map(pad => pad.tonic));
  const isSong = current % 2 === 0;
  const song = isSong ? items[songIndex] : undefined;
  const left = !isSong ? items[songIndex] : undefined;
  const next = !isSong ? items[songIndex + 1] : undefined;
  const finished = current >= items.length * 2;
  const endTonic = (target: Song | undefined) => keyOf(songKeys(target!)?.end)?.tonic ?? 0;

  // A song that ends moves the set to its pad, and the pad starts if "Go to pad" was never pressed.
  useEffect(() => {
    if (!session) return;
    session.onSongEnd = () => {
      const index = currentRef.current;
      if (index % 2 !== 0) return;
      const ended = items[index / 2];
      if (!session.snapshot().pad && ended) {
        const bar = session.clock?.barLen ?? 2;
        void session.setPad(endTonic(ended), now(), bar);
      }
      setCurrent(index + 1);
      setMoreOpen(true);
    };
  });

  // Practice opens straight on a pad.
  useEffect(() => {
    if (!session || isSong || !left || session.clock || snap?.pad) return;
    const grid = songGrid(left);
    session.startClock(barSeconds(grid, grid.downbeats.length - 2), left.beatsPerBar);
    void session.setPad(endTonic(left), now(), 1);
  }, [session, isSong, left]);

  const ps = song ? loadedSongs[song.id] : undefined;
  const views = song ? sectionViews(song) : [];
  const later = items.slice(songIndex + 1).reduce((sum, entry) => sum + planSeconds(entry), 0);
  const setLeft = (isSong && started && snap?.song ? snap.song.secondsLeft : isSong && song ? planSeconds(song) : 0) + later;

  const startSong = () => {
    if (!session || !ps || ps.views.length === 0) return;
    session.startSong(ps, { from: 0 });
    setStarted(true);
  };
  const bringIn = () => {
    const target = next ? loadedSongs[next.id] : undefined;
    if (!session || !target || target.views.length === 0) return;
    session.startNext(target, {
      from: Math.min(startAt, target.views.length - 1),
      countIn: prefs.countIn,
      keepPad: prefs.keepPad,
      crossfade: crossfadeSeconds(),
    });
    setCurrent(current + 1);
    setStarted(true);
    setStartAt(0);
    setMoreOpen(false);
  };
  const crossfadeSeconds = () => {
    const bar = session?.clock?.barLen ?? 2;
    return prefs.crossfade === 'beat' ? bar / (session?.clock?.beatsPerBar ?? 4) : prefs.crossfade === 'bar' ? bar : 2 * bar;
  };
  const tapPad = (tonic: number) => {
    if (!session) return;
    void session.setPad(tonic, session.padBoundary(prefs.changeOn), crossfadeSeconds());
  };
  const fadeOutEnd = () => {
    if (!session) return;
    const bar = session.clock?.barLen ?? 2;
    session.fadePads(now(), now() + 2 * bar);
    setCurrent(current + 1);
  };
  const togglePause = () => {
    if (!session) return;
    if (session.paused) session.resume(prefs.fadePause ? PAUSE_FADE.in : 0);
    else session.pause(prefs.fadePause ? PAUSE_FADE.out : 0);
  };

  useEffect(() => {
    lastWalk.current = -1;
  }, [current]);

  // Simple mode walks the way in, one pad every 4 bars.
  const way = left ? route(keyOf(songKeys(left)?.end) ?? { tonic: 0, minor: false }, next ? keyOf(songKeys(next)?.start) : null).filter(tonic => have.has(tonic)) : [];
  useEffect(() => {
    if (!session || isSong || prefs.mode !== 'simple' || !snap?.clock || !snap.pad || snap.pad.next) return;
    const at = way.indexOf(snap.pad.tonic);
    const target = at < 0 ? way[0] : way[at + 1];
    if (target === undefined) return;
    if (lastWalk.current < 0) lastWalk.current = snap.clock.bar;
    if (snap.clock.bar - lastWalk.current >= 4) {
      lastWalk.current = snap.clock.bar;
      tapPad(target);
    }
  });

  useKeys(event => {
    if (finished) return;
    if (event.key === ' ') {
      event.preventDefault();
      if (isSong && !started) startSong();
      else togglePause();
    } else if (isSong && started && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      const idx = Number(event.key) - 1;
      if (idx < views.length) session?.pickSection(idx);
    } else if (isSong && event.key.toLowerCase() === 'h') {
      session?.toggleHold();
    } else if (isSong && event.key === 'Escape') {
      session?.cancel();
    } else if (!isSong && event.key === 'Enter') {
      event.preventDefault();
      if (next) bringIn();
    }
  });

  if (!set) return <p className="p-8">That set no longer exists.</p>;

  const position = isSong ? (snap?.song ? { bar: snap.song.bar, beat: snap.song.beat, per: snap.song.beatsPerBar } : null) : snap?.clock ? { bar: snap.clock.bar, beat: snap.clock.beat, per: snap.clock.beatsPerBar } : null;
  const keyNow = isSong ? (snap?.song ? views[snap.song.idx]?.key : views[0]?.key) : snap?.pad ? KEY_NAMES[snap.pad.tonic] : null;

  return (
    <div className="flex min-h-full flex-col bg-stage-bg text-stage-text">
      <header className="flex items-center gap-4 border-b border-stage-line px-6 py-3">
        <button
          type="button"
          className={`rounded-md border px-3.5 py-2 ${exitArmed ? 'border-stage-accent text-stage-accent' : 'border-stage-line hover:bg-stage-card'}`}
          onClick={() => {
            if (exitArmed || finished || (!started && isSong)) return go({ page: 'sets', id: set.id });
            setExitArmed(true);
            window.setTimeout(() => setExitArmed(false), 3000);
          }}
        >
          {exitArmed ? 'Tap again to stop' : 'Exit'}
        </button>
        <div className="ml-auto flex items-center gap-5">
          {(started || !isSong) && !finished && (
            <div className="flex items-center gap-3">
              <button type="button" className="flex items-center gap-2 rounded-md border border-stage-line px-4 py-2 hover:bg-stage-card" onClick={togglePause}>
                {snap?.paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
                {snap?.paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.fadePause}
                title={`Pause fades out over ${PAUSE_FADE.out} bars, and Resume fades back in over ${PAUSE_FADE.in}.`}
                className="flex items-center gap-2 py-2 text-sm text-stage-muted hover:text-stage-text"
                onClick={() => savePrefs({ fadePause: !prefs.fadePause })}
              >
                <span className={`relative h-5 w-9 rounded-full transition-colors ${prefs.fadePause ? 'bg-stage-accent' : 'bg-stage-line'}`}>
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-stage-text transition-transform ${prefs.fadePause ? 'translate-x-4' : ''}`} />
                </span>
                Fade
              </button>
            </div>
          )}
          <p className="font-mono text-3xl tabular" aria-label="Position">
            Bar {position && position.bar > 0 ? position.bar : '—'} · {position?.beat ?? '—'}
          </p>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: position?.per ?? 4 }, (_, i) => (
              <span key={i} className={`h-4 w-4 rounded-full ${position?.beat === i + 1 ? 'bg-stage-accent' : 'bg-stage-line'}`} />
            ))}
          </div>
          {isSong && (
            <>
              <Stat label="Key" value={keyNow ?? '—'} />
              <Stat label="Set left" value={`~${clock(setLeft)}`} />
            </>
          )}
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[200px_minmax(0,1fr)_290px] max-lg:grid-cols-[minmax(0,1fr)_260px]">
        <SetList items={items} current={current} />
        <main className="border-x border-stage-line px-6 py-6 max-lg:border-l-0">
          {finished ? (
            <div className="py-16 text-center">
              <p className="text-3xl font-bold">That is the set.</p>
              <button type="button" className="mt-6 rounded-md bg-stage-text px-5 py-3 font-medium text-stage-bg" onClick={() => go({ page: 'sets', id: set.id })}>
                Back to Sets
              </button>
            </div>
          ) : isSong && song ? (
            <SongPads song={song} snap={snap?.song ?? null} started={started} ready={Boolean(ps)} onStart={startSong} session={session} />
          ) : left ? (
            <PadPanel left={left} next={next} snap={snap} mode={prefs.mode} onMode={mode => savePrefs({ mode })} onPad={tapPad} way={way} have={have} />
          ) : null}
        </main>
        <aside className="px-5 py-6 max-lg:col-span-2 max-lg:border-t max-lg:border-stage-line">
          {finished ? null : isSong && song ? (
            <OnDeck song={song} next={items[songIndex + 1]} session={session} snap={snap} started={started} have={have} prefs={prefs} onPrefs={savePrefs} />
          ) : left ? (
            <BringIn
              left={left}
              next={next}
              loaded={next ? Boolean(loadedSongs[next.id]) : true}
              snap={snap}
              prefs={prefs}
              onPrefs={savePrefs}
              startAt={startAt}
              onStartAt={setStartAt}
              moreOpen={moreOpen}
              onMore={() => setMoreOpen(!moreOpen)}
              onBringIn={bringIn}
              onFadeOut={fadeOutEnd}
            />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="leading-tight">
      <p className="font-mono text-[11px] uppercase tracking-wider text-stage-muted">{label}</p>
      <p className="font-mono text-xl">{value}</p>
    </div>
  );
}

function SetList({ items, current }: { items: Song[]; current: number }) {
  return (
    <nav className="px-3 py-5 max-lg:hidden" aria-label="Set">
      <p className="mb-3 px-1 font-mono text-xs uppercase tracking-wider text-stage-muted">Set</p>
      <ol className="space-y-1">
        {items.flatMap((song, i) => {
          const pad = livePad(song, items[i + 1]);
          return [
            <Row key={song.id} index={2 * i} current={current} lead={String(i + 1)} title={song.title} tail={keysOf(song)} />,
            <Row key={`${song.id}-pad`} index={2 * i + 1} current={current} lead="pad" title={pad.to === 'end' ? `${pad.from} · end` : `${pad.from} → ${pad.to}`} mono />,
          ];
        })}
      </ol>
    </nav>
  );
}

function keysOf(song: Song): string {
  const keys = songKeys(song);
  return !keys ? '' : keys.start === keys.end ? keys.start : `${keys.start} → ${keys.end}`;
}

function Row({ index, current, lead, title, tail, mono }: { index: number; current: number; lead: string; title: string; tail?: string; mono?: boolean }) {
  const state = index < current ? 'done' : index === current ? 'now' : index === current + 1 ? 'deck' : 'later';
  const style = {
    done: 'text-stage-muted line-through',
    now: 'bg-stage-card',
    deck: 'border border-dashed border-stage-muted',
    later: '',
  }[state];
  return (
    <li className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm ${style}`} aria-current={state === 'now' ? 'step' : undefined}>
      <span className="w-7 shrink-0 font-mono text-xs text-stage-muted">{lead}</span>
      <span className={`min-w-0 flex-1 ${mono ? 'font-mono' : ''}`}>{title}</span>
      {tail && <span className="shrink-0 font-mono text-xs">{tail}</span>}
    </li>
  );
}

function SongPads({ song, snap, started, ready, onStart, session }: { song: Song; snap: Snapshot['song']; started: boolean; ready: boolean; onStart: () => void; session: PerformSession | null }) {
  const views = sectionViews(song);
  const current = snap ? views[snap.idx] : null;
  const next = snap?.next ?? null;
  const nextView = next ? views[next.idx] : null;
  const rule = current ? current.section.jumpAt : 'section';
  const when = (reason: Reason, bars: number, beats: number) => {
    const text = reason === 'pick' ? RULE_TEXT[rule] : 'at end of section';
    const count = bars > 0 ? `in ${bars} bar${bars === 1 ? '' : 's'}` : `in ${beats} beat${beats === 1 ? '' : 's'}`;
    return `${text} (${count})`;
  };
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-4xl font-bold">{song.title}</h1>
        {snap && current && (
          <p className="text-[17px]" aria-live="polite">
            Now: <b>{current.name}</b>
            {snap.hold ? ' · holding' : ` · pass ${snap.pass} of ${snap.repeats} · ${snap.barsLeft} bars left`}
          </p>
        )}
      </div>
      {!started && (
        <button type="button" disabled={!ready} className="mb-5 flex items-center gap-2 rounded-md bg-stage-accent px-6 py-4 text-lg font-semibold text-stage-bg disabled:opacity-50" onClick={onStart}>
          <Play className="h-5 w-5 fill-current" />
          {ready ? `Start ${views[0]?.name ?? 'song'}` : 'Loading…'}
        </button>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {views.map((view, i) => {
          const playing = snap?.idx === i;
          const queued = next?.idx === i && !playing;
          return (
            <button
              key={view.section.id}
              type="button"
              disabled={!started}
              onClick={() => session?.pickSection(i)}
              className={`min-h-[104px] rounded-lg border px-3.5 py-3 text-left transition-colors ${playing ? 'border-stage-accent bg-stage-accent text-stage-bg' : queued ? 'border-2 border-stage-accent bg-stage-card' : 'border-stage-line bg-stage-card hover:border-stage-muted'} disabled:cursor-default`}
            >
              <span className="flex justify-between font-mono text-xs">
                <span>{i + 1}</span>
                <span>{playing ? 'PLAYING' : queued ? 'NEXT' : ''}</span>
              </span>
              <span className="mt-2 block text-2xl font-semibold">{view.name}</span>
              <span className={`mt-1 block font-mono text-xs ${playing ? '' : 'text-stage-muted'}`}>
                {view.e - view.s} bars · {view.key ?? '—'}
              </span>
            </button>
          );
        })}
      </div>
      {snap && (
        <div className="mt-5 flex min-h-[78px] items-center justify-between gap-4 rounded-lg border border-stage-line px-4 py-3">
          <p aria-live="polite">
            {snap.hold && current
              ? `Holding ${current.name}. It loops until you pick a section or let go.`
              : nextView && next
                ? `Next: ${nextView.name} — ${when(next.reason, next.bars, next.beats)}.`
                : snap.ending
                  ? 'Last section. The song ends after this pass.'
                  : ''}
          </p>
          {next?.reason === 'pick' && (
            <button type="button" className="rounded-md border border-stage-line px-4 py-2 hover:bg-stage-card" onClick={() => session?.cancel()}>
              Cancel
            </button>
          )}
        </div>
      )}
      {snap && (
        <button
          type="button"
          aria-pressed={snap.hold}
          className={`mt-5 rounded-md border px-4 py-3 ${snap.hold ? 'border-stage-accent text-stage-accent' : 'border-stage-line hover:bg-stage-card'}`}
          onClick={() => session?.toggleHold()}
        >
          {snap.hold ? 'Holding · let go' : 'Hold here'}
        </button>
      )}
    </div>
  );
}

function OnDeck({
  song,
  next,
  session,
  snap,
  started,
  have,
  prefs,
  onPrefs,
}: {
  song: Song;
  next: Song | undefined;
  session: PerformSession | null;
  snap: Snapshot | null;
  started: boolean;
  have: Set<number>;
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
}) {
  const pad = livePad(song, next);
  const tonic = keyOf(songKeys(song)?.end)?.tonic ?? 0;
  const [open, setOpen] = useState(false);
  const nextBpm = next ? songBpm(next) : null;
  const nextStart = next ? sectionViews(next)[0]?.name : null;
  return (
    <div>
      <p className="mb-3 font-mono text-xs uppercase tracking-wider text-stage-muted">On deck</p>
      <div className="rounded-lg border border-dashed border-stage-muted p-4">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-semibold">Live pad</span>
          <span className="text-xs text-stage-muted">
            leaving {pad.from} · {next ? `next song in ${pad.to}` : 'end of the set'}
          </span>
        </p>
        <button
          type="button"
          disabled={!started || Boolean(snap?.pad) || !have.has(tonic)}
          className="mt-3 w-full rounded-md bg-stage-text px-4 py-3.5 text-lg font-semibold text-stage-bg disabled:opacity-60"
          onClick={() => session?.goToPad(tonic)}
        >
          {snap?.pad ? `Pad (${KEY_NAMES[snap.pad.tonic]}) is in` : `Go to pad (${pad.from})`}
        </button>
        <p className="mt-3 text-sm text-stage-muted">
          {have.has(tonic)
            ? `The ${pad.from} pad fades in under the song at the next phrase. The song keeps going until you let it end.`
            : `No pad in ${pad.from} yet. Get pads in Library, on the Pads tab.`}
        </p>
      </div>
      {next && (
        <div className="mt-4 rounded-lg border border-stage-line p-4">
          <p className="text-sm text-stage-muted">Then</p>
          <p className="font-semibold">{next.title}</p>
          <p className="mt-1 font-mono text-xs text-stage-muted">
            {nextBpm ?? '—'} BPM · {keysOf(next)} · enters on {nextStart ?? 'Intro'}
          </p>
        </div>
      )}
      <div className="mt-4 rounded-lg border border-stage-line p-4">
        <Choice title="Jumps to another section">
          {JUMP_FADES.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={prefs.jumpFade === value} className={option(prefs.jumpFade === value)} onClick={() => onPrefs({ jumpFade: value })}>
              {label}
            </button>
          ))}
        </Choice>
        <p className="mt-2 text-sm text-stage-muted">{JUMP_FADES.find(([value]) => value === prefs.jumpFade)?.[2]} Going on to the next section plays straight through.</p>
        <label className="mt-3 flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={prefs.fillGaps} onChange={event => onPrefs({ fillGaps: event.target.checked })} />
          <span>
            Fill any silence with a pad
            <span className="block text-xs text-stage-muted">In the key of the section coming in</span>
          </span>
        </label>
      </div>
      <button type="button" className="mt-4 flex items-center gap-1.5 px-1 py-1" aria-expanded={open} onClick={() => setOpen(!open)}>
        More <ChevronDown className={`h-4 w-4 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <button type="button" disabled={!started || snap?.song?.ending} className="w-full rounded-md border border-stage-line px-4 py-2.5 text-left hover:bg-stage-card disabled:opacity-50" onClick={() => session?.endSong(2)}>
            End song now (fade over 2 bars)
          </button>
        </div>
      )}
    </div>
  );
}

function PadPanel({ left, next, snap, mode, onMode, onPad, way, have }: { left: Song; next: Song | undefined; snap: Snapshot | null; mode: PadMode; onMode: (mode: PadMode) => void; onPad: (tonic: number) => void; way: number[]; have: Set<number> }) {
  const from = keyOf(songKeys(left)?.end) ?? { tonic: 0, minor: false };
  const to = next ? keyOf(songKeys(next)?.start) : null;
  const fromName = KEY_NAMES[from.tonic];
  const toName = to ? KEY_NAMES[to.tonic] : null;
  const sounding = snap?.pad?.tonic ?? null;
  const queued = snap?.pad?.next?.tonic ?? null;
  const at = sounding === null ? -1 : way.indexOf(sounding);
  const suggestion = queued ?? (at < 0 ? (way[0] === from.tonic ? way[1] : way[0]) : way[at + 1]);
  const groups = padGroups(from, to);
  const label = (tonic: number) => {
    const a = numeral(tonic, from);
    const b = to ? numeral(tonic, to) : null;
    if (a && b) return `${a} in ${fromName} · ${b} in ${toName}`;
    if (a) return `${a} in ${fromName}`;
    if (b) return `${b} in ${toName}`;
    return next ? 'outside both keys' : `outside ${fromName}`;
  };
  const tile = (tonic: number, wide = false) => {
    const isNow = tonic === sounding;
    const isNext = !isNow && tonic === suggestion;
    const missing = !have.has(tonic);
    return (
      <button
        key={tonic}
        type="button"
        disabled={missing}
        onClick={() => onPad(tonic)}
        className={`rounded-lg border px-4 py-3 text-left ${wide ? 'min-h-[88px]' : 'min-h-[92px]'} ${isNow ? 'border-stage-text bg-stage-text text-stage-bg' : isNext ? 'border-2 border-stage-accent bg-stage-card' : 'border-stage-line bg-stage-card hover:border-stage-muted'} disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-50`}
        aria-label={`Pad ${KEY_NAMES[tonic]}, ${label(tonic)}${isNow ? ', sounding now' : isNext ? ', suggested next' : ''}`}
      >
        <span className="block h-4 font-mono text-[10px]">{isNow ? 'NOW' : isNext ? 'NEXT' : ''}</span>
        <span className="block font-mono text-2xl font-bold">{KEY_NAMES[tonic]}</span>
        <span className={`mt-1 block text-xs ${isNow ? '' : 'text-stage-muted'}`}>{missing ? 'no pad yet' : label(tonic)}</span>
      </button>
    );
  };
  const group = (title: string, tonics: number[]) =>
    tonics.length > 0 && (
      <div key={title}>
        <p className="mb-2 mt-4 text-sm text-stage-muted">{title}</p>
        <div className={`grid gap-3 ${tonics.length <= 2 ? 'grid-cols-2' : 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]'}`}>{tonics.map(tonic => tile(tonic, tonics.length <= 2))}</div>
      </div>
    );
  const guided = [...new Set([...way.slice(1), ...groups.both])];
  const elapsed = snap?.pad ? Math.max(0, now() - snap.pad.since) : 0;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex rounded-lg border border-stage-line p-1" role="radiogroup" aria-label="Pad view">
          {(
            [
              ['simple', 'Simple', 'app plays it'],
              ['guided', 'Guided', 'a few good ways'],
              ['advanced', 'Advanced', 'every pad'],
            ] as const
          ).map(([value, title, sub]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className={`rounded-md px-4 py-1.5 text-left ${mode === value ? 'border border-stage-muted bg-stage-card' : 'text-stage-muted hover:text-stage-text'}`}
              onClick={() => onMode(value)}
            >
              <span className="block font-semibold">{title}</span>
              <span className="block text-xs">{sub}</span>
            </button>
          ))}
        </div>
        <p className="text-sm">{left.title} ended. The pad keeps playing until you move.</p>
      </div>

      <p className="mt-6 font-mono text-xs uppercase tracking-wider text-stage-muted">Now sounding</p>
      <p className="font-mono text-6xl font-bold">{sounding === null ? '—' : KEY_NAMES[sounding]}</p>
      <p className="font-mono text-sm text-stage-muted">
        {sounding !== null ? `Pad in ${KEY_NAMES[sounding]} · ${clock(elapsed)}` : have.size === 0 ? 'No pads in your library yet. Get them in Library, on the Pads tab.' : `No pad in ${fromName} yet. Pick one below.`}
      </p>

      {mode === 'simple' ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-stage-muted">The app moves along this way in, one pad every 4 bars, then waits on {toName ?? fromName}.</p>
          <div className="flex flex-wrap items-center gap-3">
            {way.map((tonic, i) => (
              <span key={`${tonic}-${i}`} className={`rounded-lg border px-5 py-3 font-mono text-2xl font-bold ${tonic === sounding ? 'border-stage-text bg-stage-text text-stage-bg' : 'border-stage-line'}`}>
                {KEY_NAMES[tonic]}
              </span>
            ))}
          </div>
        </div>
      ) : mode === 'guided' ? (
        <div>{group('A few good ways in', guided)}</div>
      ) : (
        <div>
          <p className="mt-6 font-mono text-xs uppercase tracking-wider text-stage-muted">All pads</p>
          {next ? group('Fits both', groups.both) : null}
          {group(`Fits the song you left, ${fromName}`, next ? groups.from : [...groups.both, ...groups.from])}
          {next && group(`Fits the next song, ${toName}`, groups.to)}
          {group('Other keys', groups.other)}
        </div>
      )}
    </div>
  );
}

function BringIn(props: {
  left: Song;
  next: Song | undefined;
  loaded: boolean;
  snap: Snapshot | null;
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
  startAt: number;
  onStartAt: (index: number) => void;
  moreOpen: boolean;
  onMore: () => void;
  onBringIn: () => void;
  onFadeOut: () => void;
}) {
  const { next, snap, prefs, onPrefs, startAt } = props;
  if (!next) {
    return (
      <div>
        <p className="mb-3 font-mono text-xs uppercase tracking-wider text-stage-muted">End of the set</p>
        <div className="rounded-lg border border-stage-line p-4">
          <p className="text-sm text-stage-muted">Play the pad as long as the room needs it.</p>
          <button type="button" className="mt-3 w-full rounded-md bg-stage-text px-4 py-3.5 font-semibold text-stage-bg" onClick={props.onFadeOut}>
            Fade out the pad
          </button>
        </div>
        <Mix prefs={prefs} onPrefs={onPrefs} />
      </div>
    );
  }
  const views = sectionViews(next);
  const start = views[startAt] ?? views[0];
  const startKey = start ? keyOf(start.key) : null;
  const offKey = startKey && snap?.pad && snap.pad.tonic !== startKey.tonic;
  return (
    <div>
      <p className="mb-3 font-mono text-xs uppercase tracking-wider text-stage-muted">Bring in next song</p>
      <div className="rounded-lg border border-stage-line p-4">
        <p className="text-lg font-semibold">{next.title}</p>
        <p className="font-mono text-xs text-stage-muted">
          {songBpm(next) ?? '—'} BPM · starts in {start?.key ?? '—'}
        </p>
        {offKey && <p className="mt-3 rounded-md bg-stage-warn px-3 py-2 text-sm">Not on {start?.key} yet. You can still start whenever you want.</p>}
        <button type="button" disabled={!props.loaded} className="mt-3 w-full rounded-md bg-stage-text px-4 py-3.5 text-lg font-semibold text-stage-bg disabled:opacity-50" onClick={props.onBringIn}>
          {props.loaded ? `Start ${start?.name ?? 'song'} on next bar` : 'Loading…'}
        </button>
      </div>
      <button type="button" className="mt-4 flex items-center gap-1.5 px-1 py-1" aria-expanded={props.moreOpen} onClick={props.onMore}>
        More <ChevronDown className={`h-4 w-4 ${props.moreOpen ? 'rotate-180' : ''}`} />
      </button>
      {props.moreOpen && (
        <div className="mt-3 space-y-4 border-t border-stage-line pt-4">
          <Choice title="Change on">
            {(['beat', 'bar'] as const).map(value => (
              <button key={value} type="button" aria-pressed={prefs.changeOn === value} className={option(prefs.changeOn === value)} onClick={() => onPrefs({ changeOn: value })}>
                Next {value}
              </button>
            ))}
          </Choice>
          <Choice title="Pad-to-pad crossfade">
            {(
              [
                ['beat', '1 beat'],
                ['bar', '1 bar'],
                ['bars', '2 bars'],
              ] as const
            ).map(([value, text]) => (
              <button key={value} type="button" aria-pressed={prefs.crossfade === value} className={option(prefs.crossfade === value)} onClick={() => onPrefs({ crossfade: value })}>
                {text}
              </button>
            ))}
          </Choice>
          <Choice title="Start at">
            {views.slice(0, 3).map((view, i) => (
              <button key={view.section.id} type="button" aria-pressed={startAt === i} className={option(startAt === i)} onClick={() => props.onStartAt(i)}>
                {view.name}
              </button>
            ))}
          </Choice>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={prefs.countIn} onChange={event => onPrefs({ countIn: event.target.checked })} />
            <span>
              1-bar count-in click (in ears only)
              {!audio().ears && <span className="block text-xs text-stage-muted">No separate ear output found, so the room hears it too.</span>}
            </span>
          </label>
          <Mix prefs={prefs} onPrefs={onPrefs} />
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={prefs.keepPad} onChange={event => onPrefs({ keepPad: event.target.checked })} />
            Keep pad under the song, fade over 8 bars
          </label>
        </div>
      )}
    </div>
  );
}

function Choice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-wider text-stage-muted">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Mix({ prefs, onPrefs }: { prefs: Prefs; onPrefs: (patch: Partial<Prefs>) => void }) {
  return (
    <div className="mt-4">
      <p className="mb-2 font-mono text-xs uppercase tracking-wider text-stage-muted">Mix</p>
      <label className="block">
        Pad
        <input type="range" min={0} max={1} step={0.01} value={prefs.padVolume} onChange={event => onPrefs({ padVolume: Number(event.target.value) })} className="mt-2 block w-full accent-[#EE8A4F]" />
      </label>
    </div>
  );
}
