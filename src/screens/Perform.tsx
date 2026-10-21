import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Pause, Play, Square } from 'lucide-react';
import type { Song, WorshipSet } from '../types';
import { go, useStore } from '../store';
import { useFrame, useKeys } from '../ui';
import { PerformSession, now, padSourceFor, perfSong, release, type PerfSong, type Snapshot } from '../audio/engine';
import { KEY_NAMES, padFit, padGroups } from '../lib/music';
import { barSeconds, clock, keyOf, planSeconds, sectionViews, songGrid, songKeys, type SectionView } from '../lib/songMap';
import type { JumpFade, Reason } from '../lib/performPlan';
import { livePad, songBpm, wayIn } from './Sets';

type PadMode = 'simple' | 'guided' | 'advanced';
interface Prefs {
  mode: PadMode;
  changeOn: 'beat' | 'bar';
  crossfade: 'beat' | 'bar' | 'bars';
  keepPad: boolean;
  padVolume: number;
  jumpFade: JumpFade;
  fillGaps: boolean;
  fadePause: boolean;
}
const DEFAULT_PREFS: Prefs = { mode: 'advanced', changeOn: 'bar', crossfade: 'beat', keepPad: true, padVolume: 0.8, jumpFade: 'out', fillGaps: true, fadePause: true };
/** Bars that Pause fades out over and Resume fades back in over, when fading is on. */
const PAUSE_FADE = { out: 3, in: 2 };

const JUMP_FADES: Array<[JumpFade, string, string]> = [
  ['out', 'Match the fade-out', 'The section you pick fades in where this one fades out.'],
  ['in', 'Match the fade-in', 'This section fades out where the one you pick fades in.'],
  ['edited', 'As edited', 'Each section keeps the fades you set in Transitions.'],
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
  /** The song on screen when it is not the one playing: paging lets you look at any song while the set plays on. */
  const [viewing, setViewing] = useState<number | null>(null);
  const sessionRef = useRef<PerformSession | null>(null);
  const currentRef = useRef(current);
  currentRef.current = current;
  const lastWalk = useRef(-1);
  /** Simple mode's place in the gap's pads. It counts steps, so a key can come back later on. Null reads it from the pad sounding. */
  const walkStep = useRef<number | null>(null);
  /** Set when you turn the pad off, so the song playing ends without one. Bringing in a pad or a song clears it. */
  const padOff = useRef(false);
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
    if (sessionRef.current) Object.assign(sessionRef.current, { jumpFade: next.jumpFade, fillGaps: next.fillGaps, padCrossfade: next.crossfade });
  };

  useEffect(() => {
    const session = new PerformSession(padSourceFor(pads));
    sessionRef.current = session;
    session.setPadVolume(prefs.padVolume);
    Object.assign(session, { jumpFade: prefs.jumpFade, fillGaps: prefs.fillGaps, padCrossfade: prefs.crossfade });
    if (import.meta.env.DEV) Object.assign(window, { __djw: { ...(window as unknown as { __djw?: object }).__djw, session } });
    return () => session.dispose();
  }, []);

  // Only the song playing, the one after it and the one on screen stay decoded; each is about 100 MB.
  const songIndex = Math.floor(current / 2);
  const browsed = viewing === null ? undefined : items[viewing];
  useEffect(() => {
    let cancelled = false;
    const live = [items[songIndex], items[songIndex + 1]].filter((song): song is Song => Boolean(song));
    const ids = [...live, browsed].map(song => song?.id);
    release(ids.filter((id): id is string => Boolean(id)));
    setLoadedSongs(all => Object.fromEntries(Object.entries(all).filter(([id]) => ids.includes(id))));
    const load = (song: Song) =>
      void perfSong(song).then(ps => {
        if (!cancelled) setLoadedSongs(all => ({ ...all, [song.id]: ps }));
      });
    live.forEach(load);
    // Paging past a song should not decode it, so wait until the page stays put.
    const timer = browsed && window.setTimeout(() => load(browsed), 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer || undefined);
    };
  }, [items, songIndex, browsed]);

  const session = sessionRef.current;
  const snap: Snapshot | null = session?.snapshot() ?? null;
  const have = new Set(pads.map(pad => pad.tonic));
  const isSong = current % 2 === 0;
  const song = isSong ? items[songIndex] : undefined;
  const left = !isSong ? items[songIndex] : undefined;
  const next = !isSong ? items[songIndex + 1] : undefined;
  const finished = current >= items.length * 2;
  /** The pad after the last song. Pause gives way to End set here. */
  const lastItem = current === items.length * 2 - 1;
  const endTonic = (target: Song | undefined) => keyOf(songKeys(target!)?.end)?.tonic ?? 0;
  /** The pads planned for the gap after a song that are in the library, in play order. */
  const gapPads = (from: Song | undefined, to: Song | undefined) => (from ? wayIn(set, from, to).tonics.filter(tonic => have.has(tonic)) : []);
  /** The pad a gap opens on: the first pad you picked that is in the library, or the key the song ends in. */
  const firstPad = (from: Song, to: Song | undefined) => (wayIn(set, from, to).picked ? gapPads(from, to)[0] : undefined) ?? endTonic(from);

  // A song that ends moves the set to its pad. The pad starts unless one is in already, or you turned it off.
  useEffect(() => {
    if (!session) return;
    session.onSongEnd = () => {
      const index = currentRef.current;
      if (index % 2 !== 0) return;
      const ended = items[index / 2];
      if (!session.snapshot().pad && ended && !padOff.current) {
        const bar = session.clock?.barLen ?? 2;
        void session.setPad(firstPad(ended, items[index / 2 + 1]), now(), bar);
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
    void session.setPad(firstPad(left, next), now(), 1);
  }, [session, isSong, left]);

  const ps = song ? loadedSongs[song.id] : undefined;
  const views = song ? sectionViews(song) : [];
  const later = items.slice(songIndex + 1).reduce((sum, entry) => sum + planSeconds(entry), 0);
  const setLeft = (isSong && started && snap?.song ? snap.song.secondsLeft : isSong && song ? planSeconds(song) : 0) + later;

  const startSong = (from: number) => {
    if (!session || !ps || from >= ps.views.length) return;
    session.startSong(ps, { from });
    padOff.current = false;
    setStarted(true);
  };
  const crossfadeSeconds = () => {
    const bar = session?.clock?.barLen ?? 2;
    return prefs.crossfade === 'beat' ? bar / (session?.clock?.beatsPerBar ?? 4) : prefs.crossfade === 'bar' ? bar : 2 * bar;
  };
  /** Bring in a section of any song in the set, from a song, a pad, or silence. The set goes on from that song. */
  const jumpTo = (index: number, section: number) => {
    const target = items[index] ? loadedSongs[items[index].id] : undefined;
    if (!session || !target || section >= target.views.length) return;
    const landing = session.switchSong(target, section, { keepPad: prefs.keepPad, crossfade: crossfadeSeconds() });
    if (landing === null) return;
    padOff.current = false;
    setCurrent(2 * index);
    setStarted(true);
    setViewing(null);
    setStartAt(0);
    setMoreOpen(false);
  };
  const upNext = items[songIndex + 1];
  const bringIn = () => upNext && jumpTo(songIndex + 1, Math.min(startAt, sectionViews(upNext).length - 1));
  /** The song one page away, or null at either end of the set. From a pad, back is the song that just ended. */
  const pageTo = (dir: 1 | -1) => {
    const to = viewing !== null ? viewing + dir : isSong ? songIndex + dir : songIndex + (dir > 0 ? 1 : 0);
    return to >= 0 && to < items.length ? to : null;
  };
  const show = (index: number | null) => setViewing(index !== null && isSong && index === songIndex ? null : index);
  const tapPad = (tonic: number) => {
    if (!session) return;
    padOff.current = false;
    void session.setPad(tonic, session.padBoundary(prefs.changeOn), crossfadeSeconds());
  };
  /** A pad picked by hand: Simple mode goes on from it after 4 bars of its own. */
  const pickPad = (tonic: number) => {
    walkStep.current = way.indexOf(tonic);
    lastWalk.current = -1;
    tapPad(tonic);
  };
  const padMoves = {
    /** Leave the song: it fades out over 2 bars as the pad comes in. */
    go: (tonic: number) => {
      padOff.current = false;
      session?.leaveForPad(tonic);
    },
    /** The pad comes in under the song at its next phrase, and the song plays on. */
    under: (tonic: number) => {
      padOff.current = false;
      session?.goToPad(tonic);
    },
    /** Bring in or change the pad under the song on the next bar or beat. */
    change: (tonic: number) => {
      padOff.current = false;
      session?.changePadUnder(tonic, prefs.changeOn);
    },
    off: () => {
      if (!session) return;
      padOff.current = true;
      session.fadePads(now(), now() + 2 * session.barLen(), true);
    },
  };
  const fadeOutEnd = () => {
    if (!session) return;
    const bar = session.clock?.barLen ?? 2;
    session.fadePads(now(), now() + 2 * bar, true);
    setCurrent(current + 1);
  };
  const togglePause = () => {
    if (!session) return;
    if (session.paused) session.resume(prefs.fadePause ? PAUSE_FADE.in : 0);
    else session.pause(prefs.fadePause ? PAUSE_FADE.out : 0);
  };

  useEffect(() => {
    lastWalk.current = -1;
    walkStep.current = null;
  }, [current]);

  // Simple mode walks the way in, one pad every 4 bars.
  const way = gapPads(left, next);
  useEffect(() => {
    if (!session || isSong || prefs.mode !== 'simple' || !snap?.clock || !snap.pad || snap.pad.next) return;
    walkStep.current ??= way.indexOf(snap.pad.tonic);
    const target = way[walkStep.current + 1];
    if (target === undefined) return;
    if (lastWalk.current < 0) lastWalk.current = snap.clock.bar;
    if (snap.clock.bar - lastWalk.current >= 4) {
      lastWalk.current = snap.clock.bar;
      walkStep.current += 1;
      tapPad(target);
    }
  });

  useKeys(event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      // A focused slider keeps its arrows.
      if (event.target instanceof HTMLInputElement) return;
      event.preventDefault();
      const to = pageTo(event.key === 'ArrowLeft' ? -1 : 1);
      if (to !== null) show(to);
      return;
    }
    if (browsed && event.key === 'Escape') return setViewing(null);
    if (browsed && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      return jumpTo(viewing!, Number(event.key) - 1);
    }
    if (finished) return;
    if (event.key === ' ') {
      event.preventDefault();
      if (isSong && !started) startSong(0);
      else if (lastItem) fadeOutEnd();
      else togglePause();
    } else if (isSong && /^[1-9]$/.test(event.key)) {
      event.preventDefault();
      const idx = Number(event.key) - 1;
      if (!started) startSong(idx);
      else if (idx < views.length) session?.pickSection(idx);
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

  const live = snap?.song ? `${snap.song.title} · ${views[snap.song.idx]?.name ?? ''}` : snap?.pad ? `the ${KEY_NAMES[snap.pad.tonic]} pad` : null;
  const pagePrev = pageTo(-1);
  const pageNext = pageTo(1);
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
          {lastItem ? (
            <button type="button" className="flex items-center gap-2 rounded-md border border-stage-line px-4 py-2 hover:bg-stage-card" onClick={fadeOutEnd}>
              <Square className="h-4 w-4 fill-current" />
              End set
            </button>
          ) : (started || !isSong) && !finished && (
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
        <SetList set={set} items={items} current={current} viewing={viewing} onView={show} />
        <main className="border-x border-stage-line px-6 py-6 max-lg:border-l-0">
          <Pager
            label={viewing !== null ? `Song ${viewing + 1} of ${items.length}` : finished ? 'End of the set' : isSong ? `Song ${songIndex + 1} of ${items.length}` : `Pad after song ${songIndex + 1}`}
            prev={pagePrev === null ? undefined : items[pagePrev]}
            next={pageNext === null ? undefined : items[pageNext]}
            onPage={dir => show(pageTo(dir))}
          />
          {browsed ? (
            <BrowseSong
              song={browsed}
              ready={Boolean(loadedSongs[browsed.id])}
              arriving={snap?.song?.arriving ? snap.song.title : null}
              live={live}
              onBack={() => setViewing(null)}
              onPick={section => jumpTo(viewing!, section)}
            />
          ) : finished ? (
            <div className="py-16 text-center">
              <p className="text-3xl font-bold">That is the set.</p>
              <button type="button" className="mt-6 rounded-md bg-stage-text px-5 py-3 font-medium text-stage-bg" onClick={() => go({ page: 'sets', id: set.id })}>
                Back to Sets
              </button>
            </div>
          ) : isSong && song ? (
            <SongPads song={song} snap={snap?.song ?? null} started={started} ready={Boolean(ps)} onStart={startSong} session={session} />
          ) : left ? (
            <PadPanel left={left} next={next} snap={snap} mode={prefs.mode} onMode={mode => savePrefs({ mode })} onPad={pickPad} onPadOff={padMoves.off} way={way} picked={wayIn(set, left, next).picked} opener={firstPad(left, next)} step={walkStep.current} have={have} />
          ) : null}
        </main>
        <aside className="px-5 py-6 max-lg:col-span-2 max-lg:border-t max-lg:border-stage-line">
          {finished ? null : isSong && song ? (
            <OnDeck
              song={song}
              next={upNext}
              nextLoaded={upNext ? Boolean(loadedSongs[upNext.id]) : false}
              startAt={startAt}
              onStartAt={setStartAt}
              onNext={bringIn}
              pads={padMoves}
              gapPad={firstPad(song, upNext)}
              plan={wayIn(set, song, upNext)}
              padOff={padOff.current}
              session={session}
              snap={snap}
              started={started}
              have={have}
              prefs={prefs}
              onPrefs={savePrefs}
            />
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

function SetList({ set, items, current, viewing, onView }: { set: WorshipSet; items: Song[]; current: number; viewing: number | null; onView: (index: number) => void }) {
  return (
    <nav className="px-3 py-5 max-lg:hidden" aria-label="Set">
      <p className="mb-3 px-1 font-mono text-xs uppercase tracking-wider text-stage-muted">Set</p>
      <ol className="space-y-1">
        {items.flatMap((song, i) => {
          const pad = livePad(song, items[i + 1]);
          const way = wayIn(set, song, items[i + 1]);
          return [
            <Row key={song.id} index={2 * i} current={current} lead={String(i + 1)} title={song.title} tail={keysOf(song)} viewing={viewing === i} onClick={() => onView(i)} />,
            <Row key={`${song.id}-pad`} index={2 * i + 1} current={current} lead="pad" title={way.picked ? way.tonics.map(tonic => KEY_NAMES[tonic]).join(' · ') : pad.to === 'end' ? `${pad.from} · end` : `${pad.from} → ${pad.to}`} mono />,
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

function Row(props: { index: number; current: number; lead: string; title: string; tail?: string; mono?: boolean; viewing?: boolean; onClick?: () => void }) {
  const { index, current, lead, title, tail, mono, viewing, onClick } = props;
  const state = index < current ? 'done' : index === current ? 'now' : index === current + 1 ? 'deck' : 'later';
  const style = {
    done: 'text-stage-muted line-through',
    now: 'bg-stage-card',
    deck: 'border border-dashed border-stage-muted',
    later: '',
  }[state];
  const className = `flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm ${style} ${viewing ? 'ring-2 ring-inset ring-stage-accent' : ''}`;
  const body = (
    <>
      <span className="w-7 shrink-0 font-mono text-xs text-stage-muted">{lead}</span>
      <span className={`min-w-0 flex-1 ${mono ? 'font-mono' : ''}`}>{title}</span>
      {tail && <span className="shrink-0 font-mono text-xs">{tail}</span>}
    </>
  );
  return (
    <li aria-current={state === 'now' ? 'step' : undefined}>
      {onClick ? (
        <button type="button" className={`${className} hover:bg-stage-card`} aria-pressed={viewing} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

function Pager({ label, prev, next, onPage }: { label: string; prev?: Song; next?: Song; onPage: (dir: 1 | -1) => void }) {
  const button = 'flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-stage-line px-3 py-2 text-sm hover:bg-stage-card disabled:invisible';
  return (
    <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
      <button type="button" className={`${button} justify-self-start`} disabled={!prev} aria-label={prev && `Previous song, ${prev.title}`} onClick={() => onPage(-1)}>
        <ChevronLeft className="h-4 w-4 shrink-0" />
        <span className="truncate">{prev?.title}</span>
      </button>
      <p className="shrink-0 font-mono text-xs uppercase tracking-wider text-stage-muted">{label}</p>
      <button type="button" className={`${button} justify-self-end`} disabled={!next} aria-label={next && `Next song, ${next.title}`} onClick={() => onPage(1)}>
        <span className="truncate">{next?.title}</span>
        <ChevronRight className="h-4 w-4 shrink-0" />
      </button>
    </div>
  );
}

/** Another song in the set, while the set plays on. A section tapped here comes in on a bar line of what is playing. */
function BrowseSong(props: { song: Song; ready: boolean; arriving: string | null; live: string | null; onBack: () => void; onPick: (section: number) => void }) {
  const { song, ready, arriving, live } = props;
  return (
    <div>
      <div className="mb-5 flex min-h-[64px] items-center justify-between gap-4 rounded-lg border border-stage-accent px-4 py-3">
        <p aria-live="polite">{live ? <>Now playing: <b>{live}</b></> : 'Nothing is playing yet.'}</p>
        <button type="button" className="shrink-0 rounded-md border border-stage-line px-4 py-2 hover:bg-stage-card" onClick={props.onBack}>
          Back to it
        </button>
      </div>
      <h1 className="text-4xl font-bold">{song.title}</h1>
      <p className="mb-5 mt-2 text-stage-muted">
        {!ready ? 'Loading…' : arriving ? `Wait for ${arriving} to come in.` : `Tap a section to bring it in on the next bar.${live ? ' What is playing fades out.' : ''}`}
      </p>
      <SectionTiles views={sectionViews(song)} disabled={!ready || Boolean(arriving)} onPick={props.onPick} />
    </div>
  );
}

function SectionTiles({ views, playing, queued, disabled, onPick }: { views: SectionView[]; playing?: number; queued?: number; disabled: boolean; onPick: (index: number) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      {views.map((view, i) => {
        const isPlaying = playing === i;
        const isQueued = queued === i && !isPlaying;
        return (
          <button
            key={view.section.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(i)}
            className={`min-h-[104px] rounded-lg border px-3.5 py-3 text-left transition-colors ${isPlaying ? 'border-stage-accent bg-stage-accent text-stage-bg' : isQueued ? 'border-2 border-stage-accent bg-stage-card' : 'border-stage-line bg-stage-card hover:border-stage-muted'} disabled:cursor-default`}
          >
            <span className="flex justify-between font-mono text-xs">
              <span>{i + 1}</span>
              <span>{isPlaying ? 'PLAYING' : isQueued ? 'NEXT' : ''}</span>
            </span>
            <span className="mt-2 block text-2xl font-semibold">{view.name}</span>
            <span className={`mt-1 block font-mono text-xs ${isPlaying ? '' : 'text-stage-muted'}`}>
              {view.e - view.s} bars · {view.key ?? '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SongPads(props: { song: Song; snap: Snapshot['song']; started: boolean; ready: boolean; onStart: (from: number) => void; session: PerformSession | null }) {
  const { song, snap, started, ready, onStart, session } = props;
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
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <button type="button" disabled={!ready} className="flex items-center gap-2 rounded-md bg-stage-accent px-6 py-4 text-lg font-semibold text-stage-bg disabled:opacity-50" onClick={() => onStart(0)}>
            <Play className="h-5 w-5 fill-current" />
            {ready ? `Start ${views[0]?.name ?? 'song'}` : 'Loading…'}
          </button>
          {ready && <p className="text-stage-muted">Or tap any section to start there.</p>}
        </div>
      )}
      <SectionTiles views={views} playing={snap?.idx} queued={next?.idx} disabled={!ready} onPick={i => (started ? session?.pickSection(i) : onStart(i))} />
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

function OnDeck(props: {
  song: Song;
  next: Song | undefined;
  nextLoaded: boolean;
  startAt: number;
  onStartAt: (index: number) => void;
  onNext: () => void;
  pads: { go: (tonic: number) => void; under: (tonic: number) => void; change: (tonic: number) => void; off: () => void };
  /** The first pad planned for the gap after this song. Go to pad leaves for it; a pad under the song stays in the song's key. */
  gapPad: number;
  plan: { tonics: number[]; picked: boolean };
  /** You turned the pad off, so a pad still fading is on its way out. */
  padOff: boolean;
  session: PerformSession | null;
  snap: Snapshot | null;
  started: boolean;
  have: Set<number>;
  prefs: Prefs;
  onPrefs: (patch: Partial<Prefs>) => void;
}) {
  const { song, next, pads, session, snap, started, have, prefs, onPrefs } = props;
  const pad = livePad(song, next);
  /** The pad under the song starts in the key of the section playing. */
  const sectionKey = keyOf(sectionViews(song)[snap?.song?.idx ?? 0]?.key ?? songKeys(song)?.end)?.tonic ?? 0;
  const [open, setOpen] = useState(false);
  const padIn = snap?.pad ?? null;
  const canPad = Boolean(padIn) || have.has(sectionKey);
  // A pad kept under this song fades for 8 bars, and can still be turned off.
  const tail = !padIn && snap?.padFading;
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
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-stage-muted">
          {props.plan.picked ? 'Your pads' : 'Way in'}
          {props.plan.tonics.map((key, k) => (
            <span key={`${key}-${k}`} className={`rounded border px-1.5 py-0.5 font-mono ${have.has(key) ? 'border-stage-line text-stage-text' : 'border-dashed border-stage-line'}`}>
              {KEY_NAMES[key]}
            </span>
          ))}
        </p>
        <button
          type="button"
          disabled={!started || !(padIn || have.has(props.gapPad)) || snap?.song?.forced}
          className="mt-3 w-full rounded-md bg-stage-text px-4 py-3.5 text-lg font-semibold text-stage-bg disabled:opacity-60"
          onClick={() => pads.go(props.gapPad)}
        >
          Go to pad ({KEY_NAMES[padIn ? padIn.tonic : props.gapPad]})
        </button>
        <p className="mt-3 text-sm text-stage-muted">
          {padIn || have.has(props.gapPad) ? 'Go to pad fades the song out over 2 bars as the pad comes in.' : `No pad in ${KEY_NAMES[props.gapPad]} yet. Get pads in Library, on the Pads tab.`}
        </p>
      </div>
      <div className="mt-4 rounded-lg border border-stage-line p-4">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-semibold">Under the song</span>
          <span className="text-xs text-stage-muted">{padIn ? `${KEY_NAMES[padIn.tonic]} pad now` : `this section is in ${KEY_NAMES[sectionKey]}`}</span>
        </p>
        <button
          type="button"
          disabled={!started || (tail ? props.padOff : !canPad)}
          className="mt-3 w-full rounded-md border border-stage-line px-4 py-2.5 hover:bg-stage-card disabled:opacity-50"
          onClick={() => (padIn || tail ? pads.off() : pads.under(sectionKey))}
        >
          {padIn || (tail && !props.padOff) ? 'Turn pad off' : tail ? 'Pad fading out' : `Pad under the song (${KEY_NAMES[sectionKey]})`}
        </button>
        <p className="mt-3 text-sm text-stage-muted">It comes in at the next phrase and follows each section&apos;s key. Tap a key to change it until the next section.</p>
        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {KEY_NAMES.map((name, key) => {
            const isNow = padIn?.tonic === key;
            const isSection = key === sectionKey;
            return (
              <button
                key={name}
                type="button"
                disabled={!started || !have.has(key) || snap?.song?.forced}
                aria-pressed={isNow}
                aria-label={`Pad under the song in ${name}${isNow ? ', sounding now' : isSection ? ", this section's key" : ''}`}
                className={`rounded-md border py-2 font-mono text-sm ${isNow ? 'border-stage-text bg-stage-text text-stage-bg' : isSection ? 'border-stage-accent hover:bg-stage-card' : 'border-stage-line hover:bg-stage-card'} disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-40`}
                onClick={() => pads.change(key)}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      {next && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-stage-muted">Then</p>
          <NextSong
            next={next}
            startAt={props.startAt}
            onStartAt={props.onStartAt}
            loaded={props.nextLoaded}
            waiting={snap?.song?.arriving ? snap.song.title : null}
            onStart={props.onNext}
          />
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
          <button type="button" disabled={!started || snap?.song?.forced} className="w-full rounded-md border border-stage-line px-4 py-2.5 text-left hover:bg-stage-card disabled:opacity-50" onClick={() => session?.endSong(2)}>
            End song now (fade over 2 bars)
          </button>
        </div>
      )}
    </div>
  );
}

function PadPanel(props: {
  left: Song;
  next: Song | undefined;
  snap: Snapshot | null;
  mode: PadMode;
  onMode: (mode: PadMode) => void;
  onPad: (tonic: number) => void;
  onPadOff: () => void;
  /** The gap's pads that are in the library, in play order. */
  way: number[];
  /** The way is the pads you picked in Sets. */
  picked: boolean;
  /** The pad that turning the pad back on starts with. */
  opener: number;
  /** Where the walk is in the way, once known. A key can come up twice. */
  step: number | null;
  have: Set<number>;
}) {
  const { left, next, snap, mode, onMode, onPad, way, have } = props;
  const from = keyOf(songKeys(left)?.end) ?? { tonic: 0, minor: false };
  const to = next ? keyOf(songKeys(next)?.start) : null;
  const fromName = KEY_NAMES[from.tonic];
  const toName = to ? KEY_NAMES[to.tonic] : null;
  const sounding = snap?.pad?.tonic ?? null;
  const queued = snap?.pad?.next?.tonic ?? null;
  const at = props.step ?? (sounding === null ? -1 : way.indexOf(sounding));
  const suggestion = queued ?? (at < 0 ? (way[0] === from.tonic ? way[1] : way[0]) : way[at + 1]);
  const groups = padGroups(from, to);
  const label = (tonic: number) => padFit(tonic, from, to);
  const opener = have.has(props.opener) ? props.opener : null;
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
  const guided = [...new Set([...(props.picked ? way : way.slice(1)), ...groups.both])];
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

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-stage-muted">Now sounding</p>
          <p className="font-mono text-6xl font-bold">{sounding === null ? '—' : KEY_NAMES[sounding]}</p>
          <p className="font-mono text-sm text-stage-muted">
            {sounding !== null
              ? `Pad in ${KEY_NAMES[sounding]} · ${clock(elapsed)}`
              : have.size === 0
                ? 'No pads in your library yet. Get them in Library, on the Pads tab.'
                : opener !== null
                  ? 'Pad off.'
                  : `No pad in ${fromName} yet. Pick one below.`}
          </p>
        </div>
        {sounding !== null ? (
          <button type="button" className="rounded-md border border-stage-line px-4 py-2.5 hover:bg-stage-card" onClick={props.onPadOff}>
            Turn pad off
          </button>
        ) : (
          opener !== null && (
            <button type="button" className="rounded-md border border-stage-line px-4 py-2.5 hover:bg-stage-card" onClick={() => onPad(opener)}>
              Turn pad on ({KEY_NAMES[opener]})
            </button>
          )
        )}
      </div>

      {mode === 'simple' ? (
        <div className="mt-6">
          <p className="mb-3 text-sm text-stage-muted">The app moves along {props.picked ? 'your pads' : 'this way in'}, one pad every 4 bars, then waits on {way.length ? KEY_NAMES[way[way.length - 1]] : (toName ?? fromName)}.</p>
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
          {props.picked && group('Your pads, from Sets', [...new Set(way)])}
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
}) {
  const { next, snap, prefs, onPrefs, startAt } = props;
  if (!next) {
    return (
      <div>
        <p className="mb-3 font-mono text-xs uppercase tracking-wider text-stage-muted">End of the set</p>
        <div className="rounded-lg border border-stage-line p-4">
          <p className="text-sm text-stage-muted">Play the pad as long as the room needs it, then End set fades it out.</p>
        </div>
        <Mix prefs={prefs} onPrefs={onPrefs} />
      </div>
    );
  }
  const start = sectionViews(next)[startAt];
  const startKey = start ? keyOf(start.key) : null;
  const offKey = startKey && snap?.pad && snap.pad.tonic !== startKey.tonic;
  return (
    <div>
      <p className="mb-3 font-mono text-xs uppercase tracking-wider text-stage-muted">Bring in next song</p>
      <NextSong next={next} startAt={startAt} onStartAt={props.onStartAt} loaded={props.loaded} onStart={props.onBringIn}>
        {offKey && <p className="mt-3 rounded-md bg-stage-warn px-3 py-2 text-sm">Not on {start?.key} yet. You can still start whenever you want.</p>}
      </NextSong>
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

/** The next song in the set, and the section to start it from. */
function NextSong(props: {
  next: Song;
  startAt: number;
  onStartAt: (index: number) => void;
  loaded: boolean;
  /** The song still coming in, which has to land first. */
  waiting?: string | null;
  onStart: () => void;
  children?: React.ReactNode;
}) {
  const { next, startAt } = props;
  const views = sectionViews(next);
  const start = views[startAt] ?? views[0];
  return (
    <div className="rounded-lg border border-stage-line p-4">
      <p className="text-lg font-semibold">{next.title}</p>
      <p className="font-mono text-xs text-stage-muted">
        {songBpm(next) ?? '—'} BPM · starts in {start?.key ?? '—'}
      </p>
      {props.children}
      <div className="mt-3">
        <Choice title="Start at">
          {views.map((view, i) => (
            <button key={view.section.id} type="button" aria-pressed={start === view} className={option(start === view)} onClick={() => props.onStartAt(i)}>
              {view.name}
            </button>
          ))}
        </Choice>
      </div>
      <button type="button" disabled={!props.loaded || Boolean(props.waiting)} className="mt-3 w-full rounded-md bg-stage-text px-4 py-3.5 text-lg font-semibold text-stage-bg disabled:opacity-50" onClick={props.onStart}>
        {!props.loaded ? 'Loading…' : props.waiting ? `Wait for ${props.waiting} to come in` : `Start ${start?.name ?? 'song'} on next bar`}
      </button>
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
