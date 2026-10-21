import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, MousePointer2, Pause, Play, Scissors, Undo2, X } from 'lucide-react';
import type { Section, SectionType, Song, Tap } from '../types';
import { go, useStore } from '../store';
import { Button, Card, LinkButton, Menu, MenuItem, SongHeader, StepPills, Stepper, beatsLabel, shadeClass, useFrame, useKeys, type StepName } from '../ui';
import { transport } from '../audio/engine';
import { KEY_NAMES, detectKey, keyName } from '../lib/music';
import { sectionChroma, snapToOnset, type Onsets } from '../lib/analysis';
import { onsetsOf } from '../lib/library';
import {
  MIN_TAPS,
  SECTION_TYPES,
  barBeatAt,
  barSeconds,
  beatPos,
  beatTime,
  bpmOf,
  clock,
  cutBar,
  cutSection,
  liveBpm,
  mapTaps,
  markSection,
  moveSection,
  sectionViews,
  songGrid,
  unmarked,
  type SectionView,
} from '../lib/songMap';

type Tool = 'select' | 'cut';
const TOOLS = [
  ['select', 'Select', MousePointer2, 'V', 'Click a section to change it'],
  ['cut', 'Cut', Scissors, 'C', 'Click a section to split it at the nearest bar'],
] as const;

/** The section last opened on Tap or Refine, by song id, so the other screen opens on the same one. */
export const focusedSection = new Map<string, string>();

export function stepNav(song: Song) {
  return (step: StepName) => go({ page: 'song', id: song.id, step: step === 'sections' ? 'tap' : step });
}

export function doneSteps(song: Song): StepName[] {
  return [
    ...(song.sections.length ? (['tap'] as const) : []),
    ...(song.refined ? (['refine'] as const) : []),
    ...(song.exportedAt ? (['export'] as const) : []),
  ];
}

export function SongTap({ song }: { song: Song }) {
  const store = useStore();
  const [loaded, setLoaded] = useState(false);
  const [env, setEnv] = useState<Onsets | null>(null);
  const [flash, setFlash] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** Re-tapping: taps outside [start, end) are ignored, each new tap replaces the old taps before it, and playback stops at `stop`. */
  const [retap, setRetap] = useState<{ label: string; start: number; end: number; stop: number; half: number; fresh: Set<Tap> } | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const latest = useRef(song);
  latest.current = song;
  const history = useRef<Song[]>([]);
  const playing = useSyncExternalStore(transport.subscribe, () => transport.playing);
  const frame = useFrame(playing);

  useEffect(() => {
    let live = true;
    setEnv(null);
    void transport.load(song.id).then(async () => {
      setLoaded(true);
      const buffer = transport.buffer;
      const found = buffer && (await onsetsOf(buffer).catch(() => null));
      if (live) setEnv(found);
    });
    return () => {
      live = false;
      transport.pause();
    };
  }, [song.id]);

  useEffect(() => {
    if (!playing) setRetap(null);
  }, [playing]);

  useEffect(() => {
    if (!selectedId) return;
    focusedSection.set(song.id, selectedId);
    const close = (event: MouseEvent) => {
      if (!trackRef.current?.contains(event.target as Node)) setSelectedId(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [selectedId]);

  const save = (next: Song, undoable = true) => {
    if (next === latest.current) return;
    if (undoable) history.current = [...history.current.slice(-199), latest.current];
    latest.current = next;
    store.saveSong(next);
  };
  const undo = () => {
    const previous = history.current.pop();
    if (previous) save(previous, false);
  };
  const pos = loaded ? transport.position() : 0;
  const grid = songGrid(song);
  const views = sectionViews(song);
  const at = barBeatAt(grid, pos);
  const bpm = liveBpm(grid);
  const rest = unmarked(song);
  const mapped = song.taps.some(item => item.auto);
  const last = views[views.length - 1];
  // Before any taps, left and right step 5 seconds.
  const bars = grid.downbeats.length ? grid.downbeats : Array.from({ length: Math.ceil(song.duration / 5) }, (_, i) => i * 5);
  const starts = [...views.map(view => view.start), ...(rest ? [rest.start] : [])];
  const selected = views.find(view => view.section.id === selectedId);
  const pickTool = (next: Tool) => {
    setTool(next);
    setSelectedId(null);
  };

  useEffect(() => {
    if (!transport.playing) return;
    const t = transport.position();
    if (retap && t >= retap.stop) {
      transport.pause();
      return;
    }
    // Sections cover what you have listened through, so only a playhead that just crossed the end extends it.
    const current = latest.current;
    if (current.sections.length > 0 && t - current.marksEnd >= 0.5 && t - current.marksEnd < 2) save({ ...current, marksEnd: t }, false);
  }, [frame]);

  /** `stamp` is the key or click event's time, so a busy frame does not make the tap late. */
  const tap = (one: boolean, stamp?: number) => {
    if (!loaded) return;
    const heard = transport.heard() - (transport.playing && stamp !== undefined ? Math.max(0, performance.now() - stamp) / 1000 : 0);
    // A tap while it plays moves onto the drum hit or strum it was reaching for, if one is close.
    const t = (transport.playing && env ? snapToOnset(env, heard) : null) ?? heard;
    if (retap && (t < retap.start || t >= retap.end)) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 90);
    const current = latest.current;
    const added = { t, one };
    // Old taps go only as new ones reach them, so the bars, and the sections on them, never disappear.
    const kept = retap ? current.taps.filter(item => retap.fresh.has(item) || item.t < retap.start || item.t >= Math.min(t + retap.half, retap.end)) : current.taps;
    retap?.fresh.add(added);
    save({ ...current, taps: [...kept, added] });
  };
  const mark = (type: SectionType, name?: string) => {
    const current = latest.current;
    if (songGrid(current).downbeats.length === 0) return setHint('Tap a few beats first, so the app knows where the bars are.');
    setHint(null);
    save(markSection(current, type, transport.heard(), name));
  };
  const startOver = (clear: Partial<Song>) => {
    transport.pause();
    transport.seek(0);
    setHint(null);
    save({ ...latest.current, ...clear });
  };
  const beginRetap = (label: string, start: number, end: number, half: number, from: number) => {
    setHint(null);
    setRetap({ label, start, end, stop: end + 2 * half, half, fresh: new Set() });
    transport.seek(from);
    transport.play();
  };
  /** Plays one section from a bar early so it can be tapped again. */
  const retapSection = (view: SectionView) => {
    const half = barSeconds(grid, view.s) / song.beatsPerBar / 2;
    beginRetap(`${view.name}, bars ${view.s + 1}–${view.e}`, view.start - half, view.end - half, half, Math.max(0, view.start - barSeconds(grid, view.s - 1)));
  };
  const jump = (times: number[], direction: -1 | 1) => {
    const t = transport.position();
    // Back lands on the start of the current bar or section, or the one before if the playhead just passed it.
    const target = direction < 0 ? (times.filter(time => time <= t - 0.3).pop() ?? 0) : times.find(time => time > t + 0.05);
    if (target !== undefined) transport.seek(target);
  };

  useKeys(event => {
    if (event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) tap(event.shiftKey, event.timeStamp);
    } else if (/^[1-8]$/.test(event.key)) {
      event.preventDefault();
      mark(SECTION_TYPES[Number(event.key) - 1].type);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      undo();
    } else if (event.key === 'p' || event.key === 'Enter') {
      event.preventDefault();
      transport.toggle();
      setHint(null);
    } else if (event.key === 'v' || event.key === 'c') {
      pickTool(event.key === 'v' ? 'select' : 'cut');
    } else if (event.key === 'Escape') {
      setSelectedId(null);
    } else if (event.key === '0' || event.key === 'Home') {
      event.preventDefault();
      transport.seek(0);
    } else if (event.key.startsWith('Arrow') && !(event.target instanceof HTMLSelectElement)) {
      event.preventDefault();
      const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      jump(event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? bars : starts, back ? -1 : 1);
    }
  });

  return (
    <div>
      <SongHeader song={song} meta={`${song.artist || 'Unknown artist'} · ${clock(song.duration)}`}>
        <StepPills current={['tap', 'sections']} done={doneSteps(song)} onStep={stepNav(song)} />
      </SongHeader>

      <Card className="px-5 pb-5 pt-4">
        <div className="mb-4 flex items-center gap-5">
          <Button tone="lantern" className="px-5" onClick={() => transport.toggle()} disabled={!loaded} aria-label={transport.playing ? 'Pause' : 'Play'}>
            {transport.playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            {transport.playing ? 'Pause' : 'Play'}
          </Button>
          <p className="tabular text-xl font-medium" aria-live="off">
            {clock(pos)}
            {at && at.bar > 0 ? ` · bar ${at.bar} · beat ${at.beat}` : ''}
          </p>
          <div className="ml-auto flex items-center gap-1">
            <div className="mr-2 inline-flex rounded-full border border-line p-1" role="group" aria-label="Section tool">
              {TOOLS.map(([value, label, Icon, key, help]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tool === value}
                  title={`${help} (${key})`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${tool === value ? 'bg-accent-soft text-amber ring-1 ring-inset ring-accent/50' : 'text-muted hover:bg-raised hover:text-ink'}`}
                  onClick={() => pickTool(value)}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 hover:bg-raised disabled:text-faint disabled:hover:bg-transparent"
              onClick={undo}
              disabled={history.current.length === 0}
              title="Undo the last change (Backspace)"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Undo
            </button>
            <Menu label="Start over">
              <MenuItem onClick={() => beginRetap('the whole song', 0, Infinity, 30 / (bpmOf(grid) ?? 120), 0)} disabled={!loaded || song.taps.length === 0}>
                Re-tap the beat
                <span className="block text-xs text-muted">Plays from 0:00. Each new tap replaces the old ones. Sections stay.</span>
              </MenuItem>
              <MenuItem onClick={() => startOver({ sections: [], marksEnd: 0, refined: false })} disabled={song.sections.length === 0}>
                Re-mark the sections
                <span className="block text-xs text-muted">Clears sections. Your taps stay.</span>
              </MenuItem>
              <MenuItem
                onClick={() => startOver({ taps: [], fill: false, sections: [], marksEnd: 0, refined: false })}
                disabled={song.taps.length === 0 && song.sections.length === 0}
              >
                Clear taps and sections
                <span className="block text-xs text-muted">Back to a blank song. Undo brings it back.</span>
              </MenuItem>
            </Menu>
            <Menu label="More">
              <p className="px-3 pb-1 pt-2 caps text-muted">Meter</p>
              {[3, 4, 6].map(count => (
                <MenuItem key={count} onClick={() => save({ ...latest.current, beatsPerBar: count })}>
                  {song.beatsPerBar === count ? '✓ ' : ''}
                  {count}/{count === 6 ? 8 : 4}
                </MenuItem>
              ))}
              <hr className="my-1.5 border-line" />
              <MenuItem onClick={() => last && save({ ...latest.current, marksEnd: song.duration })} disabled={!last || !rest}>
                Run {last?.name ?? 'the last section'} to the end
              </MenuItem>
              <hr className="my-1.5 border-line" />
              <MenuItem
                danger
                onClick={() => {
                  if (confirm(`Delete ${song.title} from your library?`)) void store.removeSong(song.id).then(() => go({ page: 'library' }));
                }}
              >
                Delete song
              </MenuItem>
            </Menu>
          </div>
        </div>
        <div ref={trackRef} className="relative">
          <Track
            song={song}
            views={views}
            pos={pos}
            restStart={rest?.start ?? null}
            onSeek={t => transport.seek(t)}
            tool={tool}
            selectedId={selected?.section.id ?? null}
            onSelect={setSelectedId}
            onCut={t => save(cutSection(latest.current, t))}
          />
          {selected && <SectionInspector song={song} view={selected} save={save} loaded={loaded} onRetap={() => retapSection(selected)} onClose={() => setSelectedId(null)} />}
        </div>
        <p className="mt-3 text-right text-xs text-muted">
          V select · C cut · ← → bar · ↑ ↓ section · 0 or Home start of song · Enter play or pause · Backspace undo
        </p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,354px)_minmax(0,1fr)]">
        <Card className="self-start p-5">
          <h2 className="mb-4 text-xl font-bold"><span className="text-amber">1</span> · Tap the beat</h2>
          <button
            type="button"
            className={`w-full rounded-2xl border-2 px-3 py-7 text-center transition ${flash ? 'border-accent bg-accent-soft shadow-glow' : 'border-accent/40 bg-well hover:border-accent/70'}`}
            onClick={event => tap(event.shiftKey, event.timeStamp)}
            disabled={!loaded}
          >
            <span className="block pl-[0.3em] text-4xl font-black tracking-[0.3em] text-amber">TAP</span>
            <span className="mt-3 block whitespace-nowrap text-[13px] text-muted">Space on every beat · Shift+Space on beat 1</span>
          </button>
          {retap && (
            <p className="mt-3 text-sm text-amber" aria-live="polite">
              Re-tapping {retap.label}. New taps replace the old ones as you go. <LinkButton onClick={() => transport.pause()}>Stop</LinkButton>
            </p>
          )}
          <p className="mt-6 text-sm text-muted">Tempo</p>
          <p className="tabular text-2xl font-bold" aria-live="polite">
            {bpm ? `${bpm.toFixed(1)} BPM` : '—'}
          </p>
          <Button
            className="mt-4"
            aria-pressed={mapped}
            disabled={!env || (!mapped && grid.tapped.filter(Boolean).length < MIN_TAPS)}
            title={env ? undefined : 'Listening to the song…'}
            onClick={() => {
              const current = latest.current;
              const taps = mapped ? current.taps.filter(item => !item.auto) : env && mapTaps(current, env);
              if (taps) save({ ...current, taps, fill: false });
            }}
          >
            {mapped ? 'Mapped from the song ✓' : 'Map the rest from the song'}
          </Button>
          <p className="mt-4 text-sm text-muted">
            Tap {MIN_TAPS} beats or more where the beat is clear, with Shift on a beat 1. Then map the rest: the app follows the
            recording from your taps, drift and all. Gray ticks are beats the app placed.
          </p>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-bold"><span className="text-amber">2</span> · Mark sections</h2>
            <p className="text-sm text-muted">Press a label (or 1–8) while it plays. It starts at the nearest bar.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SECTION_TYPES.map((item, i) => (
              <Button key={item.type} className="px-3.5" onClick={() => mark(item.type)}>
                <span className="text-xs font-bold text-amber">{i + 1}</span>
                {item.label}
              </Button>
            ))}
            {custom === null ? (
              <Button className="px-3.5" onClick={() => setCustom('')}>
                <span className="text-xs font-bold text-amber">+</span>
                Custom
              </Button>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={event => {
                  event.preventDefault();
                  if (custom.trim()) mark('custom', custom.trim());
                  setCustom(null);
                }}
              >
                <input autoFocus value={custom} onChange={event => setCustom(event.target.value)} placeholder="Name, then Enter" aria-label="Custom section name" className="rounded-full border border-edge bg-well px-4" />
                <Button type="submit" tone="lantern">
                  Mark
                </Button>
              </form>
            )}
          </div>
          {hint && <p className="mt-3 text-sm text-amber">{hint}</p>}

          <table className="mt-6 w-full text-left">
            <thead>
              <tr className="caps border-b border-line text-muted">
                <th className="py-2">Section</th>
                <th className="py-2">Key (found by the app)</th>
                <th className="w-44 py-2">
                  <span className="sr-only">Adjust</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {views.map(view => (
                <SectionRow key={view.section.id} song={song} view={view} save={save} loaded={loaded} selected={view === selected} onRetap={() => retapSection(view)} />
              ))}
              {rest && (
                <tr className="border-b border-line text-muted">
                  <td className="py-2">[next mark]</td>
                  <td className="py-2 tabular text-ink">
                    {rest.key ?? '—'}
                    {rest.change ? ' · key change found' : ''}
                  </td>
                  <td />
                </tr>
              )}
              {views.length === 0 && !rest && (
                <tr>
                  <td colSpan={3} className="py-4 text-sm text-muted">
                    Tap a few beats, then press a label while the song plays.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-6 flex justify-end">
            <Button tone="primary" onClick={() => go({ page: 'song', id: song.id, step: 'refine' })} disabled={views.length === 0}>
              Next: Transitions
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

interface Edit {
  song: Song;
  view: SectionView;
  save: (song: Song) => void;
}

function patched(song: Song, view: SectionView, patch: Partial<Section>): Song {
  return { ...song, sections: song.sections.map(item => (item.id === view.section.id ? { ...item, ...patch } : item)) };
}

function TypeSelect({ song, view, save }: Edit) {
  const setType = (type: SectionType) => {
    const name = type === 'custom' ? window.prompt('Name this section', view.section.name ?? '')?.trim() : undefined;
    if (type === 'custom' && !name) return;
    save(patched(song, view, { type, name }));
  };
  return (
    <select
      aria-label={`Label of ${view.name}`}
      value={view.section.type}
      onChange={event => setType(event.target.value as SectionType)}
      title="Change the label"
      className="-ml-1 cursor-pointer appearance-none rounded-md bg-transparent px-1 py-0.5 font-semibold [field-sizing:content] hover:bg-raised"
    >
      {SECTION_TYPES.map(item => (
        <option key={item.type} value={item.type}>
          {item.type === view.section.type ? view.name : item.label}
        </option>
      ))}
      <option value="custom">{view.section.type === 'custom' ? view.name : 'Custom…'}</option>
    </select>
  );
}

function KeySelect({ song, view, save }: Edit) {
  const detected = detectKey(sectionChroma(song.chroma, view.start, view.end));
  const found = detected ? keyName(detected) : null;
  return (
    <select
      aria-label={`Key of ${view.name}`}
      value={view.section.key ?? ''}
      onChange={event => save(patched(song, view, { key: event.target.value || undefined }))}
      title="Change the key"
      className="-ml-1 cursor-pointer appearance-none rounded-md bg-transparent px-1 py-0.5 font-medium hover:bg-raised"
    >
      <option value="">{found ?? '—'}</option>
      {KEY_NAMES.flatMap(name => [name, `${name}m`]).map(name => (
        <option key={name} value={name}>
          {name} (set by me)
        </option>
      ))}
    </select>
  );
}

/** The Select tool's panel for one section, under the track. */
function SectionInspector({ song, view, save, loaded, onRetap, onClose }: Edit & { loaded: boolean; onRetap: () => void; onClose: () => void }) {
  const center = ((view.start + view.end) / 2 / (song.duration || 1)) * 100;
  const { pickupBeats } = view.section;
  const icon = 'rounded-full p-1 text-muted hover:bg-raised hover:text-ink';
  const action = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 hover:bg-raised disabled:text-faint';
  return (
    <div
      role="dialog"
      aria-label={`${view.name} settings`}
      className="absolute top-full z-20 mt-2 w-80 rounded-2xl border border-edge bg-panel p-4 shadow-2xl shadow-navy/15 dark:shadow-black/60"
      style={{ left: `clamp(0px, calc(${center}% - 10rem), calc(100% - 20rem))` }}
    >
      <div className="mb-3 flex items-center gap-2">
        <TypeSelect song={song} view={view} save={save} />
        <span className="tabular text-xs text-muted">
          bars {view.s + 1}–{view.e}
        </span>
        <button type="button" className={`ml-auto ${icon}`} aria-label="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 text-sm">
        <span className="text-muted">Starts on</span>
        <div className="flex items-center gap-1 tabular">
          <button type="button" className={icon} aria-label={`Move ${view.name} a bar earlier`} onClick={() => save(moveSection(song, view.section.id, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          bar {view.s + 1}
          <button type="button" className={icon} aria-label={`Move ${view.name} a bar later`} onClick={() => save(moveSection(song, view.section.id, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="col-span-2">
          <p className="mb-1.5 text-muted">Fade in ends</p>
          <Stepper
            name="fade-in end"
            value={pickupBeats}
            min={0}
            max={16}
            step={0.5}
            label={pickupBeats ? `${beatsLabel(pickupBeats)} early` : 'on the 1'}
            onChange={value => save(patched(song, view, { pickupBeats: value }))}
          />
          <p className="mt-1.5 text-xs text-muted">Earlier for a sung pickup. The same setting as Fade in ends in Transitions.</p>
        </div>
        <span className="text-muted">Key</span>
        <div>
          <KeySelect song={song} view={view} save={save} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1 border-t border-line pt-3 text-sm">
        <button
          type="button"
          className={action}
          disabled={!loaded}
          onClick={() => {
            transport.seek(view.start);
            transport.play();
          }}
        >
          <Play className="h-4 w-4" aria-hidden />
          Play
        </button>
        <button type="button" className={action} title="Play this section and tap it again" disabled={!loaded} onClick={onRetap}>
          Re-tap
        </button>
        <button
          type="button"
          className={`ml-auto text-danger ${action}`}
          title="Its bars join the section before it"
          onClick={() => save({ ...song, sections: song.sections.filter(item => item.id !== view.section.id) })}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function SectionRow({ song, view, save, loaded, selected, onRetap }: Edit & { loaded: boolean; selected: boolean; onRetap: () => void }) {
  return (
    <tr className={`border-b border-line ${selected ? 'bg-accent-soft shadow-[inset_3px_0_0_rgb(var(--accent))]' : ''}`}>
      <td className="py-2">
        <TypeSelect song={song} view={view} save={save} />
        <span className="ml-2 tabular text-xs text-muted">
          bars {view.s + 1}–{view.e}
        </span>
      </td>
      <td className="py-2">
        <KeySelect song={song} view={view} save={save} />
      </td>
      <td className="py-2">
        <div className="flex items-center justify-end text-muted">
          <button
            type="button"
            className="rounded-full p-1.5 hover:bg-raised hover:text-ink"
            aria-label={`Play ${view.name}`}
            disabled={!loaded}
            onClick={() => {
              transport.seek(view.start);
              transport.play();
            }}
          >
            <Play className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-full p-1.5 hover:bg-raised hover:text-ink" aria-label={`Move ${view.name} a bar earlier`} onClick={() => save(moveSection(song, view.section.id, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-full p-1.5 hover:bg-raised hover:text-ink" aria-label={`Move ${view.name} a bar later`} onClick={() => save(moveSection(song, view.section.id, 1))}>
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="whitespace-nowrap rounded-full px-2.5 py-1 text-sm hover:bg-raised hover:text-ink"
            aria-label={`Re-tap ${view.name}`}
            title="Play this section and tap it again"
            disabled={!loaded}
            onClick={onRetap}
          >
            Re-tap
          </button>
          <button
            type="button"
            className="rounded-full p-1.5 hover:bg-raised hover:text-ink"
            aria-label={`Remove ${view.name}`}
            onClick={() => save({ ...song, sections: song.sections.filter(item => item.id !== view.section.id) })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

const BARS = 170;

function Track({
  song,
  views,
  pos,
  restStart,
  onSeek,
  tool,
  selectedId,
  onSelect,
  onCut,
}: {
  song: Song;
  views: SectionView[];
  pos: number;
  restStart: number | null;
  onSeek: (t: number) => void;
  tool: Tool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCut: (t: number) => void;
}) {
  const grid = songGrid(song);
  const duration = song.duration || 1;
  const strip = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const timeAt = (clientX: number) => {
    const rect = strip.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };
  const cut = tool === 'cut' && hover !== null ? cutBar(song, hover) : null;
  const bars = useMemo(() => {
    const out: number[] = [];
    const size = song.peaks.length / BARS;
    for (let i = 0; i < BARS; i++) {
      const chunk = song.peaks.slice(Math.floor(i * size), Math.max(Math.floor(i * size) + 1, Math.floor((i + 1) * size)));
      out.push(Math.max(0.04, ...chunk));
    }
    return out;
  }, [song.peaks]);
  const ticks = useMemo(
    () =>
      grid.beats.map((t, i) => ({
        x: (t / duration) * 1000,
        // Beats the app placed stay dim; tapped beats light up, and beat 1 glows amber.
        tone: !grid.tapped[i] ? 'stroke-edge' : grid.beatInBar[i] === 1 ? 'stroke-accent' : 'stroke-muted',
        tall: grid.beatInBar[i] === 1,
      })),
    [grid, duration],
  );
  const rulers = grid.downbeats.filter((_, i) => i % 16 === 0).map((t, i) => ({ t, bar: i * 16 + 1 }));
  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration);
  };
  const played = pos / duration;

  return (
    <div>
      <div className="relative mb-1 h-4 tabular text-[11px] text-muted" aria-hidden>
        {rulers.map(ruler => (
          <span key={ruler.bar} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${(ruler.t / duration) * 100}%` }}>
            {ruler.bar === 1 ? 'bar 1' : ruler.bar}
          </span>
        ))}
      </div>
      <div className="relative">
        <div
          className="cursor-pointer touch-none select-none"
          role="slider"
          aria-label="Song position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(pos)}
          aria-valuetext={clock(pos)}
          tabIndex={0}
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekAt(event);
          }}
          onPointerMove={event => {
            // Only a drag that started on the waveform seeks, not one that wandered in from a section.
            if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event);
          }}
        >
          <svg viewBox={`0 0 ${BARS * 6} 120`} preserveAspectRatio="none" className="block h-[120px] w-full rounded-xl bg-wave-bg">
            {bars.map((peak, i) => (
              <rect key={i} x={i * 6 + 1} width={4} y={60 - peak * 56} height={peak * 112} rx={2} className={i / BARS < played ? 'fill-accent' : 'fill-wave-rest'} />
            ))}
          </svg>
          <svg viewBox="0 0 1000 14" preserveAspectRatio="none" className="mt-1 block h-3.5 w-full" aria-hidden>
            {ticks.map((tick, i) => (
              <line key={i} x1={tick.x} x2={tick.x} y1={tick.tall ? 0 : 4} y2={14} className={tick.tone} strokeWidth={2.4} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        </div>
        <div
          ref={strip}
          className="relative mt-1 h-8"
          onPointerMove={event => tool === 'cut' && setHover(timeAt(event.clientX))}
          onPointerLeave={() => setHover(null)}
        >
          {views.map(view => {
            const width = ((view.end - view.start) / duration) * 100;
            const selected = view.section.id === selectedId;
            const pointer =
              tool === 'cut'
                ? cut?.view.section.id === view.section.id
                  ? 'cursor-crosshair'
                  : 'cursor-not-allowed'
                : selected
                  ? 'z-10 ring-2 ring-accent ring-offset-2 ring-offset-panel'
                  : 'hover:brightness-125';
            return (
              <button
                key={view.section.id}
                type="button"
                className={`absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-md border-r-2 border-panel text-xs font-semibold ${shadeClass(view)} ${pointer}`}
                style={{ left: `${(view.start / duration) * 100}%`, width: `${width}%` }}
                title={`${view.name} · bars ${view.s + 1}–${view.e}`}
                aria-label={`${view.name}, bars ${view.s + 1}–${view.e}`}
                aria-pressed={tool === 'select' ? selected : undefined}
                // A click without a pointer (a screen reader) cuts at the middle of the section.
                onClick={event => (tool === 'cut' ? onCut(event.detail ? timeAt(event.clientX) : (view.start + view.end) / 2) : onSelect(selected ? null : view.section.id))}
              >
                {width > 6 ? view.name.replace(/^Chorus/, 'Ch').replace(/^Verse /, 'V') : view.short}
              </button>
            );
          })}
          {views
            .filter(view => view.section.pickupBeats > 0)
            .map(view => {
              const from = Math.max(0, beatTime(grid, beatPos(grid, view.start) - view.section.pickupBeats));
              return (
                <div
                  key={`pickup-${view.section.id}`}
                  className="pointer-events-none absolute top-0 z-10 h-1.5 rounded-full bg-accent ring-1 ring-page"
                  style={{ left: `${(from / duration) * 100}%`, width: `${((view.start - from) / duration) * 100}%` }}
                  data-pickup={view.name}
                  aria-hidden
                />
              );
            })}
          {restStart !== null && (
            <div
              className={`hatch absolute inset-y-0 flex items-center justify-center rounded-md border border-dashed border-faint text-xs text-muted ${tool === 'cut' ? 'cursor-not-allowed' : ''}`}
              style={{ left: `${(restStart / duration) * 100}%`, right: 0 }}
              onClick={() => onSelect(null)}
            >
              unmarked
            </div>
          )}
        </div>
        {cut && (
          <div
            className="pointer-events-none absolute -top-1 bottom-0 border-l-2 border-dashed border-accent"
            style={{ left: `${(grid.downbeats[cut.bar] / duration) * 100}%` }}
            data-cut-bar={cut.bar + 1}
            aria-hidden
          >
            <span className="absolute left-1 top-1 flex items-center gap-1 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-navy">
              <Scissors className="h-3 w-3" />
              bar {cut.bar + 1}
            </span>
          </div>
        )}
        <div className="pointer-events-none absolute -top-1 bottom-0 z-20 w-0.5 bg-ink" style={{ left: `${played * 100}%` }} aria-hidden />
      </div>
    </div>
  );
}
