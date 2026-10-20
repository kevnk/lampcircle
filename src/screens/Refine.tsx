import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Play, Repeat, Square } from 'lucide-react';
import type { JumpAt, Section, Song } from '../types';
import { go, useStore } from '../store';
import { Button, Card, SongHeader, StepPills, Stepper, beatsLabel, useFrame } from '../ui';
import { PerformSession, audio, loadBuffer, now, padSourceFor, perfSong, transport } from '../audio/engine';
import { SECTION_TYPES, beatPos, beatTime, bpmOf, keysText, sectionViews, songGrid, songKeys, type Grid, type SectionView } from '../lib/songMap';
import { fadeOutSpan, leadIn, seamEnd } from '../lib/performPlan';
import { doneSteps, stepNav } from './SongTap';

const JUMPS: Array<[JumpAt, string]> = [
  ['beat', 'Next beat'],
  ['bar', 'Next bar'],
  ['phrase', 'End of phrase (4 bars)'],
  ['section', 'End of section'],
];

const MAX_BEATS = 16;
const clampBeats = (beats: number) => Math.min(MAX_BEATS, Math.max(0, beats));

export function Refine({ song }: { song: Song }) {
  const store = useStore();
  const views = sectionViews(song);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const view = views.find(item => item.section.id === selectedId) ?? views[0];
  const bpm = bpmOf(songGrid(song));
  const meta = [song.artist || 'Unknown artist', bpm ? `${Math.round(bpm)} BPM` : null, keysText(songKeys(song))].filter(Boolean).join(' · ');

  const update = (patch: Partial<Section>, ids = [view.section.id]) =>
    store.saveSong({ ...song, sections: song.sections.map(item => (ids.includes(item.id) ? { ...item, ...patch } : item)) });

  if (!view) {
    return (
      <div>
        <SongHeader song={song} meta={meta}>
          <StepPills current={['refine']} done={doneSteps(song)} onStep={stepNav(song)} />
        </SongHeader>
        <Card className="p-6">
          <p className="mb-4">Mark the sections first. Refine shapes each one.</p>
          <Button tone="primary" onClick={() => go({ page: 'song', id: song.id, step: 'tap' })}>
            Mark sections
          </Button>
        </Card>
      </div>
    );
  }

  const siblings = views.filter(item => item.section.type === view.section.type && item !== view);
  const typeLabel = SECTION_TYPES.find(item => item.type === view.section.type)?.label.toLowerCase();
  const plural = typeLabel ? (typeLabel.endsWith('s') ? `${typeLabel}es` : `${typeLabel}s`) : null;
  const { pickupBeats, fadeInBeats, fadeOutBeats, fadeOutEndBeats = 0, repeats, jumpAt } = view.section;

  return (
    <div>
      <SongHeader song={song} meta={meta}>
        <StepPills current={['refine']} done={doneSteps(song)} onStep={stepNav(song)} />
      </SongHeader>

      <Card className="p-3">
        <div className="flex gap-2 overflow-x-auto" role="listbox" aria-label="Sections">
          {views.map(item => {
            const selected = item === view;
            const sibling = !selected && item.section.type === view.section.type;
            return (
              <button
                key={item.section.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`min-w-[7.5rem] flex-1 rounded-md border px-3 py-2 text-left ${selected ? 'border-2 border-accent bg-accent-soft' : sibling ? 'border-line bg-[#E4E4DF]' : 'border-line bg-white hover:bg-paper'}`}
                onClick={() => setSelectedId(item.section.id)}
              >
                <span className="block font-medium">{item.name}</span>
                <span className="block font-mono text-xs text-muted">
                  {item.e - item.s} bars · {item.key ?? '—'}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="mb-5 text-2xl font-bold">
          {view.name} · bars {view.s + 1}–{view.e}
        </h2>
        <div className="flex flex-wrap gap-x-10 gap-y-6">
          <div>
            <p className="mb-2 font-medium">Default repeats live</p>
            <Stepper name="repeats" value={repeats} min={1} max={8} label={`×${repeats}`} onChange={value => update({ repeats: value })} />
            <p className="mt-1.5 text-sm text-muted">Perform plays it this many times</p>
          </div>
          <fieldset>
            <legend className="mb-2 font-medium">When I tap a different section, jump at…</legend>
            <div className="flex flex-wrap gap-2">
              {JUMPS.map(([value, label]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 ${jumpAt === value ? 'border-2 border-ink' : 'border-faint hover:bg-paper'}`}
                >
                  <input type="radio" name="jump" className="h-4 w-4 accent-[#2563EB]" checked={jumpAt === value} onChange={() => update({ jumpAt: value })} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <Seam song={song} view={view} onChange={patch => update(patch)} />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {siblings.length > 0 && plural && (
            <Button onClick={() => update({ pickupBeats, fadeInBeats, fadeOutBeats, fadeOutEndBeats, repeats, jumpAt }, siblings.map(item => item.section.id))}>
              Copy settings to all {plural}
            </Button>
          )}
          <Button
            tone="primary"
            className="ml-auto"
            onClick={() => {
              store.saveSong({ ...song, refined: true });
              go({ page: 'song', id: song.id, step: 'export' });
            }}
          >
            Next: Export .djw
          </Button>
        </div>
      </Card>
    </div>
  );
}

type Mode = 'transition' | 'loop';

/** How the end of a pass hands over to its start, with the controls to shape it and hear it. */
function Seam({ song, view, onChange }: { song: Song; view: SectionView; onChange: (patch: Partial<Section>) => void }) {
  const grid = songGrid(song);
  const buffer = useBuffer(song.id);
  const { pickupBeats: pickup, fadeInBeats: fadeIn, fadeOutBeats: fadeOut, fadeOutEndBeats: fadeOutEnd = 0 } = view.section;
  const bar = song.beatsPerBar;
  // The view holds its zoom while a handle is dragged, so the handle stays under the pointer.
  const [held, setHeld] = useState<{ before: number; after: number } | null>(null);
  const { before, after } = held ?? {
    before: (Math.ceil(Math.max(pickup + fadeIn, fadeOut - fadeOutEnd, 1) / bar) + 1) * bar,
    after: Math.ceil((Math.max(0, fadeOutEnd) + 1) / bar) * bar,
  };
  const seam = seamEnd(view, grid, song.duration);
  const listen = useListen(song, view, before, after);
  const fadeOutStart = fadeOutEnd - fadeOut;
  const { heard, snap, mode, repeat } = listen;
  // Beats from the loop point: the end of the pass counts up to it, and the next pass counts on from it.
  const rel = heard === null ? null : beatPos(grid, heard) - beatPos(grid, heard > (view.start + seam) / 2 ? seam : view.start);

  return (
    <div className="mt-8">
      <p className="font-medium">Loop seam</p>
      <p className="mb-2 text-sm text-muted">How this section loops back to its own start. In Perform, going on to the next section plays straight through, and jumps to another section follow the Jumps setting there.</p>
      <SeamView grid={grid} buffer={buffer} view={view} seam={seam} before={before} after={after} bar={bar} rel={rel} onHold={setHeld} onChange={onChange} />

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-5">
        <div>
          <p className="mb-1.5 text-sm font-medium">Fade out</p>
          <Stepper name="fade out" value={fadeOut} min={0} max={MAX_BEATS} step={0.5} label={beatsLabel(fadeOut)} onChange={value => onChange({ fadeOutBeats: value })} />
          <p className="mt-1.5 text-sm text-muted">
            Starts {fadeOutStart ? `${beatsLabel(Math.abs(fadeOutStart))} ${fadeOutStart < 0 ? 'before' : 'after'}` : 'at'} the loop point
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Fade out ends</p>
          <Stepper
            name="fade-out end"
            value={fadeOutEnd}
            min={-MAX_BEATS}
            max={MAX_BEATS}
            step={0.5}
            label={fadeOutEnd ? `${beatsLabel(Math.abs(fadeOutEnd))} ${fadeOutEnd > 0 ? 'late' : 'early'}` : 'on the 1'}
            onChange={value => onChange({ fadeOutEndBeats: value })}
          />
          <p className="mt-1.5 text-sm text-muted">Later lets the end ring over the loop point</p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Fade in</p>
          <Stepper name="fade in" value={fadeIn} min={0} max={MAX_BEATS} step={0.5} label={beatsLabel(fadeIn)} onChange={value => onChange({ fadeInBeats: value })} />
          <p className="mt-1.5 text-sm text-muted">
            Starts {beatsLabel(pickup + fadeIn)} before bar {view.s + 1}
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Fade in ends</p>
          <Stepper name="pickup" value={pickup} min={0} max={MAX_BEATS} step={0.5} label={pickup ? `${beatsLabel(pickup)} early` : 'on the 1'} onChange={value => onChange({ pickupBeats: value })} />
          <p className="mt-1.5 text-sm text-muted">Earlier for a sung pickup</p>
        </div>
      </div>

      <div className="mb-2 mt-8 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">Listen</p>
        {snap && (
          <p className="font-mono text-sm text-muted" aria-live="polite">
            pass {snap.pass}
            {mode === 'loop' && !repeat ? ' of 2' : ''} · bar {snap.bar}
          </p>
        )}
      </div>
      <PassWave grid={grid} buffer={buffer} view={view} seam={seam} heard={heard} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button tone="dark" onClick={() => listen.toggle('transition')}>
          {mode === 'transition' ? <Square className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {mode === 'transition' ? 'Stop' : 'Play transition'}
        </Button>
        <Button onClick={() => listen.toggle('loop')}>
          {mode === 'loop' ? `Stop · pass ${snap?.pass ?? 1}${repeat ? '' : ' of 2'} · bar ${snap?.bar ?? ''}` : repeat ? 'Audition loop' : 'Audition loop ×2'}
        </Button>
        <Button tone={repeat ? 'dark' : 'quiet'} aria-pressed={repeat} onClick={listen.toggleRepeat}>
          <Repeat className="h-4 w-4" aria-hidden />
          Repeat
        </Button>
      </div>
    </div>
  );
}

/** The two passes around the loop point: the end fading out on top, the start fading in below. Drag the dots to move the fades. */
function SeamView({
  grid,
  buffer,
  view,
  seam,
  before,
  after,
  bar,
  rel,
  onHold,
  onChange,
}: {
  grid: Grid;
  buffer: AudioBuffer | null | undefined;
  view: SectionView;
  seam: number;
  before: number;
  after: number;
  bar: number;
  rel: number | null;
  onHold: (window: { before: number; after: number } | null) => void;
  onChange: (patch: Partial<Section>) => void;
}) {
  const { pickupBeats: pickup, fadeInBeats: fadeIn, fadeOutBeats: fadeOut, fadeOutEndBeats: fadeOutEnd = 0 } = view.section;
  const box = useRef<HTMLDivElement>(null);
  const span = before + after;
  const x = (beat: number) => ((beat + before) / span) * 1000;
  const waves = useMemo(() => {
    if (!buffer) return null;
    const edges = (anchor: number) => Array.from({ length: COLUMNS + 1 }, (_, i) => beatTime(grid, anchor - before + (i * span) / COLUMNS));
    const out = peaks(buffer, edges(beatPos(grid, seam)));
    const into = peaks(buffer, edges(beatPos(grid, view.start)));
    const top = Math.max(1e-6, ...out, ...into);
    return { out: out.map(value => value / top), into: into.map(value => value / top) };
  }, [buffer, grid, seam, view.start, before, span]);
  const beatOf = (i: number) => -before + ((i + 0.5) / COLUMNS) * span;
  // The engine's equal-power fades: a quarter sine from silent to full.
  const rise = (share: number) => Math.sin((share * Math.PI) / 2);
  const gainOut = (beat: number) => (beat >= fadeOutEnd ? 0 : beat <= fadeOutEnd - fadeOut ? 1 : rise((fadeOutEnd - beat) / fadeOut));
  const gainIn = (beat: number) => (beat >= -pickup ? 1 : beat <= -pickup - fadeIn ? 0 : rise((beat + pickup + fadeIn) / fadeIn));
  // A lane's gain line runs from full at its top + 10 to silent at its top + 90.
  const gainLine = (gain: (beat: number) => number, top: number, corners: number[]) =>
    [...Array.from({ length: COLUMNS + 1 }, (_, i) => -before + (i * span) / COLUMNS), ...corners]
      .sort((a, b) => a - b)
      .map(beat => `${x(beat).toFixed(1)},${(top + 90 - gain(beat) * 80).toFixed(1)}`)
      .join(' ');
  const ticks: number[] = [];
  for (let beat = -before; beat <= after; beat++) ticks.push(beat);
  const barName = (beat: number) => (beat < 0 ? view.e + beat / bar + 1 : view.s + 1 + beat / bar);

  const fromLoop = (beat: number) => (beat ? `${beatsLabel(Math.abs(beat))} ${beat < 0 ? 'before' : 'after'} the loop point` : 'at the loop point');
  const save = (patch: Partial<Section>) => {
    if (Object.entries(patch).some(([key, value]) => view.section[key as keyof Section] !== value)) onChange(patch);
  };
  const handles = [
    {
      label: 'Fade-out start',
      beat: fadeOutEnd - fadeOut,
      top: '5%',
      color: '#1C1C1A',
      text: fromLoop(fadeOutEnd - fadeOut),
      move: (beat: number) => save({ fadeOutBeats: clampBeats(fadeOutEnd - beat) }),
    },
    {
      label: 'Fade-out end',
      beat: fadeOutEnd,
      top: '45%',
      color: '#1C1C1A',
      text: fromLoop(fadeOutEnd),
      // The start stays put while the end moves.
      move: (beat: number) => {
        const next = Math.min(MAX_BEATS, Math.max(-MAX_BEATS, beat));
        save({ fadeOutEndBeats: next, fadeOutBeats: clampBeats(next - fadeOutEnd + fadeOut) });
      },
    },
    {
      label: 'Fade-in start',
      beat: -pickup - fadeIn,
      top: '95%',
      color: '#C2410C',
      text: `${beatsLabel(pickup + fadeIn)} before bar ${view.s + 1}`,
      move: (beat: number) => save({ fadeInBeats: clampBeats(-beat - pickup) }),
    },
    {
      label: 'Fade-in end',
      beat: -pickup,
      top: '55%',
      color: '#C2410C',
      text: pickup ? `${beatsLabel(pickup)} before bar ${view.s + 1}` : `on bar ${view.s + 1}`,
      // The start stays put while the end moves.
      move: (beat: number) => {
        const next = clampBeats(-beat);
        save({ pickupBeats: next, fadeInBeats: clampBeats(pickup + fadeIn - next) });
      },
    },
  ];
  const beatAt = (event: PointerEvent<HTMLElement>) => {
    const rect = box.current!.getBoundingClientRect();
    const beat = ((event.clientX - rect.left) / rect.width) * span - before;
    return Math.round(Math.min(after, Math.max(-before, beat)) * 2) / 2;
  };

  return (
    <div>
      <div ref={box} className="relative h-[176px] select-none overflow-hidden rounded-md border border-line">
        <svg
          viewBox="0 0 1000 200"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={`The end of ${view.name} fades out over ${beatsLabel(fadeOut)}. Its start fades in over ${beatsLabel(fadeIn)} and is at full volume ${pickup ? `${beatsLabel(pickup)} early` : 'on the 1'}.`}
        >
          <rect width={1000} height={100} fill="#F4F4F1" />
          <rect width={1000} y={100} height={100} fill="#FFFFFF" />
          <rect x={x(fadeOutEnd - fadeOut)} width={x(fadeOutEnd) - x(fadeOutEnd - fadeOut)} height={100} fill="#E4E4DF" />
          <rect x={x(-pickup - fadeIn)} y={100} width={x(-pickup) - x(-pickup - fadeIn)} height={100} fill="#FBE3D6" />
          {ticks.map(beat => (
            <line
              key={beat}
              x1={x(beat)}
              x2={x(beat)}
              y1={0}
              y2={200}
              stroke={beat === 0 ? '#6B6B66' : beat % bar === 0 ? '#C6C6C0' : '#ECECE7'}
              strokeDasharray={beat === 0 ? '5 4' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {waves && (
            <>
              <path d={wavePath(waves.out, 0, () => 1)} fill="#DADAD4" />
              <path d={wavePath(waves.out, 0, i => gainOut(beatOf(i)))} fill="#1C1C1A" />
              <path d={wavePath(waves.into, 100, () => 1)} fill="#DADAD4" />
              <path d={wavePath(waves.into, 100, i => gainIn(beatOf(i)))} fill="#C2410C" />
            </>
          )}
          <line x1={0} x2={1000} y1={100} y2={100} stroke="#D4D4CE" vectorEffect="non-scaling-stroke" />
          <polyline points={gainLine(gainOut, 0, [fadeOutEnd - fadeOut, fadeOutEnd])} fill="none" stroke="#1C1C1A" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <polyline points={gainLine(gainIn, 100, [-pickup - fadeIn, -pickup])} fill="none" stroke="#C2410C" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-white/85 px-1 font-mono text-xs text-muted">end of pass · bar {view.e}</span>
        <span className="pointer-events-none absolute left-1.5 top-[calc(50%+6px)] rounded bg-white/85 px-1 font-mono text-xs text-muted">next pass · bar {view.s + 1}</span>
        {buffer === null && <span className="absolute inset-0 flex items-center justify-center text-sm text-muted">This song has no audio.</span>}
        {rel !== null && rel >= -before && rel <= after && (
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#2563EB]" style={{ left: `${x(rel) / 10}%` }} data-playhead="seam" aria-hidden />
        )}
        {handles.map(handle => (
          <div
            key={handle.label}
            role="slider"
            tabIndex={0}
            aria-label={handle.label}
            aria-valuemin={-before}
            aria-valuemax={after}
            aria-valuenow={handle.beat}
            aria-valuetext={handle.text}
            title={`${handle.label}: ${handle.text}`}
            className="absolute z-10 -ml-3.5 -mt-3.5 flex h-7 w-7 cursor-ew-resize touch-none items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2563EB]"
            style={{ left: `${x(handle.beat) / 10}%`, top: handle.top }}
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId);
              onHold({ before, after });
            }}
            onPointerMove={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) handle.move(beatAt(event));
            }}
            onPointerUp={() => onHold(null)}
            onPointerCancel={() => onHold(null)}
            onKeyDown={(event: KeyboardEvent) => {
              const step = event.key === 'ArrowLeft' ? -0.5 : event.key === 'ArrowRight' ? 0.5 : 0;
              if (!step) return;
              event.preventDefault();
              handle.move(handle.beat + step);
            }}
          >
            <span className="h-3.5 w-3.5 rounded-full border-2 bg-white" style={{ borderColor: handle.color }} />
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4 font-mono text-[11px] text-muted" aria-hidden>
        {ticks
          .filter(beat => beat % bar === 0)
          .map(beat => (
            <span key={beat} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${x(beat) / 10}%` }}>
              {beat === 0 ? `↻ ${barName(beat)}` : barName(beat)}
            </span>
          ))}
      </div>
    </div>
  );
}

/** One whole pass, from the start of its fade-in to the loop point, with the playhead while it plays. */
function PassWave({ grid, buffer, view, seam, heard }: { grid: Grid; buffer: AudioBuffer | null | undefined; view: SectionView; seam: number; heard: number | null }) {
  const { audioStart: start, singerStart } = leadIn(view, grid);
  const fade = fadeOutSpan(view, grid, seam);
  const length = Math.max(0.01, seam - start);
  const x = (t: number) => ((t - start) / length) * 100;
  const bars = useMemo(() => {
    if (!buffer) return null;
    const values = peaks(buffer, Array.from({ length: COLUMNS + 1 }, (_, i) => start + (i * length) / COLUMNS));
    const top = Math.max(1e-6, ...values);
    return values.map(value => Math.max(0.02, value / top));
  }, [buffer, start, length]);
  const played = heard === null ? -1 : (heard - start) / length;
  const downbeats = grid.downbeats.slice(view.s, view.e).map((t, i) => ({ t, bar: view.s + i + 1 }));
  const every = downbeats.length > 16 ? 4 : 1;

  return (
    <div className="relative h-20 select-none overflow-hidden rounded-md border border-line bg-wave-bg" aria-hidden>
      <div className="absolute inset-y-0 bg-accent-soft" style={{ left: 0, width: `${x(singerStart)}%` }} />
      <div className="absolute inset-y-0 bg-[#E4E4DF]" style={{ left: `${x(fade.start)}%`, width: `${Math.max(0, x(Math.min(fade.end, seam)) - x(fade.start))}%` }} />
      {downbeats.map(item => (
        <div key={item.bar} className="absolute inset-y-0 border-l border-line" style={{ left: `${x(item.t)}%` }}>
          {(item.bar - view.s - 1) % every === 0 && <span className="absolute left-1 top-0.5 font-mono text-[10px] text-muted">{item.bar}</span>}
        </div>
      ))}
      {bars && (
        <svg viewBox={`0 0 ${COLUMNS} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {bars.map((peak, i) => (
            <rect key={i} x={i + 0.15} width={0.7} y={56 - peak * 40} height={peak * 80} fill={(i + 0.5) / COLUMNS < played ? '#1C1C1A' : '#A6A6A0'} />
          ))}
        </svg>
      )}
      {heard !== null && heard >= start && heard <= seam && <div className="absolute inset-y-0 w-0.5 bg-[#2563EB]" style={{ left: `${x(heard)}%` }} data-playhead="pass" />}
    </div>
  );
}

const COLUMNS = 240;

/** The loudest sample between each pair of neighbouring times, in seconds. */
function peaks(buffer: AudioBuffer, edges: number[]): number[] {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  return edges.slice(1).map((end, i) => {
    let max = 0;
    const last = Math.min(data.length, Math.ceil(end * rate));
    for (let k = Math.max(0, Math.floor(edges[i] * rate)); k < last; k++) max = Math.max(max, Math.abs(data[k]));
    return max;
  });
}

/** A waveform mirrored around the middle of a 100-high lane at `top`, each column scaled by `gain`. */
function wavePath(values: number[], top: number, gain: (i: number) => number): string {
  const mid = top + 50;
  const at = (i: number) => (((i + 0.5) / values.length) * 1000).toFixed(1);
  const upper = values.map((value, i) => `${at(i)},${(mid - value * gain(i) * 42).toFixed(1)}`);
  const lower = values.map((value, i) => `${at(i)},${(mid + value * gain(i) * 42).toFixed(1)}`).reverse();
  return `M${upper.join('L')}L${lower.join('L')}Z`;
}

/** The decoded song, or null when it has no audio. Undefined while it loads. */
function useBuffer(id: string): AudioBuffer | null | undefined {
  const [buffer, setBuffer] = useState<AudioBuffer | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setBuffer(undefined);
    loadBuffer(id).then(
      value => live && setBuffer(value),
      () => live && setBuffer(null),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return buffer;
}

/** Plays the transition (the loop point, a few bars either side) or the whole loop, once or on repeat. */
function useListen(song: Song, view: SectionView, before: number, after: number) {
  const { pads } = useStore();
  const session = useRef<PerformSession | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [repeat, setRepeat] = useState(false);
  const latest = useRef({ song, view, before, after, repeat });
  latest.current = { song, view, before, after, repeat };
  useFrame(mode !== null);

  const stop = () => {
    session.current?.dispose();
    session.current = null;
    setMode(null);
  };
  useEffect(() => stop, [view.section.id]);
  // Fade edits reach the next loop point that is not scheduled yet, about 3 seconds out.
  useEffect(() => {
    const live = session.current;
    if (live?.ps) live.ps = { ...live.ps, song, views: sectionViews(song) };
  }, [song]);

  const start = async (next: Mode) => {
    transport.pause();
    session.current?.dispose();
    const live = new PerformSession(padSourceFor(pads));
    session.current = live;
    if (import.meta.env.DEV) Object.assign(window, { __djw: { ...(window as unknown as { __djw?: object }).__djw, session: live } });
    live.onSongEnd = () => (latest.current.repeat ? void start(next) : stop());
    const ps = await perfSong(latest.current.song);
    if (session.current !== live) return;
    const { view, before, after, repeat } = latest.current;
    if (next === 'loop') {
      live.startSong(ps, { from: view.index, passes: repeat ? Infinity : 2 });
    } else {
      const seam = seamEnd(view, ps.grid, ps.buffer.duration);
      const from = Math.max(leadIn(view, ps.grid).audioStart, beatTime(ps.grid, beatPos(ps.grid, seam) - before));
      live.startSong(ps, {
        from: view.index,
        passes: 2,
        landingCtx: now() + 0.1 - (from - view.start),
        until: beatTime(ps.grid, beatPos(ps.grid, view.start) + after),
      });
    }
    setMode(next);
  };

  const snap = mode ? (session.current?.snapshot().song ?? null) : null;
  // What the listener hears lags the audio clock by the output latency, which is large over Bluetooth.
  const lag = snap ? (audio().ctx.baseLatency || 0) + (audio().ctx.outputLatency || 0) : 0;
  return {
    mode,
    repeat,
    snap,
    heard: snap ? snap.pos - lag : null,
    toggle: (next: Mode) => (mode === next ? stop() : void start(next)),
    toggleRepeat: () => {
      setRepeat(!repeat);
      if (mode === 'loop') session.current?.setPasses(repeat ? 2 : Infinity);
    },
  };
}
