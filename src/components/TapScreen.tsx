import { Song, SectionMark } from '../types';
import { assessTempo, beatsPerBar, downbeatsFromBeats, lockDownbeats, readPhase } from '../lib/songMap';
import { snapToNearestBeat } from '../lib/beatDetection';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { formatTime } from '../lib/utils';
import { useState } from 'react';
import { BackLink, PlayButton } from './FlowControls';

const SECTION_KEYS: Record<string, string> = {
  i: 'Intro',
  v: 'Verse',
  c: 'Chorus',
  b: 'Bridge',
  t: 'Tag',
  o: 'Other',
};

interface TapScreenProps {
  song: Song;
  currentTime: number;
  isPlaying: boolean;
  onToggle: () => void;
  onSong: (song: Song) => void;
  onBack: () => void;
  onPrep: () => void;
}

function tappedOf(song: Song): { downbeats: number[]; taps: number[]; lockedBpm: number | null; marks: SectionMark[] } {
  const phase = readPhase(song.phase);
  if (phase.kind === 'tapped') return phase;
  if (phase.kind === 'ready') {
    return {
      downbeats: phase.downbeats,
      taps: phase.taps,
      lockedBpm: phase.lockedBpm,
      marks: phase.parts.map(part => ({ bar: part.startBar, name: part.name })),
    };
  }
  return { downbeats: [], taps: [], lockedBpm: null, marks: [] };
}

export function TapScreen({ song, currentTime, isPlaying, onToggle, onSong, onBack, onPrep }: TapScreenProps) {
  const initial = tappedOf(song);
  const [taps, setTaps] = useState<number[]>(initial.taps.length ? initial.taps : initial.downbeats);
  const [grid, setGrid] = useState<number[]>(initial.downbeats);
  const [lockedBpm, setLockedBpm] = useState<number | null>(initial.lockedBpm);
  const [marks, setMarks] = useState<SectionMark[]>(initial.marks);
  const [snapHits, setSnapHits] = useState(true);
  const [meter, setMeter] = useState(song.timeSignature ?? '4/4');
  const perBar = beatsPerBar(meter);
  const verdict = assessTempo(taps, perBar);

  const persist = (next: { taps: number[]; grid: number[]; lockedBpm: number | null; marks: SectionMark[]; meter?: string }) => {
    const songNext: Song = {
      ...song,
      timeSignature: next.meter ?? meter,
      phase: {
        kind: 'tapped',
        downbeats: next.grid,
        taps: next.taps,
        lockedBpm: next.lockedBpm,
        marks: next.marks,
      },
    };
    onSong(songNext);
  };

  const tap = () => {
    const raw = snapHits && song.beats.length > 0 ? snapToNearestBeat(currentTime, song.beats) : currentTime;
    const nextTaps = [...taps, raw].sort((a, b) => a - b);
    const nextGrid = lockedBpm === null ? nextTaps : grid;
    setTaps(nextTaps);
    setGrid(nextGrid);
    persist({ taps: nextTaps, grid: nextGrid, lockedBpm, marks });
  };

  const markSection = (name: string) => {
    if (grid.length === 0) return;
    let nearest = 1;
    let best = Infinity;
    grid.forEach((time, index) => {
      const distance = Math.abs(time - currentTime);
      if (distance < best) {
        best = distance;
        nearest = index + 1;
      }
    });
    const count = marks.filter(mark => mark.name === name || mark.name.startsWith(`${name} `)).length;
    const label = count === 0 ? name : `${name} ${count + 1}`;
    const nextMarks = [...marks.filter(mark => mark.bar !== nearest), { bar: nearest, name: label }];
    setMarks(nextMarks);
    persist({ taps, grid, lockedBpm, marks: nextMarks });
  };

  useKeyboardShortcuts(
    {
      ' ': tap,
      i: () => markSection(SECTION_KEYS.i),
      v: () => markSection(SECTION_KEYS.v),
      c: () => markSection(SECTION_KEYS.c),
      b: () => markSection(SECTION_KEYS.b),
      t: () => markSection(SECTION_KEYS.t),
      o: () => markSection(SECTION_KEYS.o),
    },
    true
  );

  const useDetected = () => {
    const detected = downbeatsFromBeats(song.beats);
    setTaps(detected);
    setGrid(detected);
    setLockedBpm(null);
    persist({ taps: detected, grid: detected, lockedBpm: null, marks });
  };

  const lock = () => {
    if (verdict.kind !== 'steady') return;
    const filled = lockDownbeats(taps[0] ?? 0, verdict.barSeconds, song.duration);
    setGrid(filled);
    setLockedBpm(verdict.bpm);
    persist({ taps, grid: filled, lockedBpm: verdict.bpm, marks });
  };

  const useTaps = () => {
    setGrid(taps);
    setLockedBpm(null);
    persist({ taps, grid: taps, lockedBpm: null, marks });
  };

  const undo = () => {
    const nextTaps = taps.slice(0, -1);
    const nextGrid = lockedBpm === null ? nextTaps : grid;
    setTaps(nextTaps);
    setGrid(nextGrid);
    persist({ taps: nextTaps, grid: nextGrid, lockedBpm, marks });
  };

  const verdictText =
    lockedBpm !== null
      ? `Locked at ${lockedBpm} BPM.`
      : verdict.kind === 'keep-tapping'
        ? `Keep tapping. ${verdict.bars} bar${verdict.bars === 1 ? '' : 's'} so far.`
        : verdict.kind === 'steady'
          ? `Steady ${verdict.bpm} BPM. Likely a click track.`
          : `Drifts ${verdict.bpmMin}–${verdict.bpmMax} BPM. Using your taps.`;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <BackLink onClick={onBack} />
        <button
          type="button"
          className="px-4 py-2 rounded bg-gray-700 text-sm disabled:opacity-40"
          disabled={grid.length < 2}
          onClick={onPrep}
        >
          Prep
        </button>
      </div>
      <div>
        <h2 className="text-3xl font-bold">{song.name}</h2>
        <p className="text-gray-400 mt-1">Tap the 1 of each bar. Space taps. I V C B T O mark a section on the nearest 1.</p>
      </div>
      <div className="flex items-center gap-3">
        <PlayButton isPlaying={isPlaying} onToggle={onToggle} />
        <span className="text-gray-300 tabular-nums">{formatTime(currentTime)}</span>
        <label className="text-sm text-gray-300 flex items-center gap-2">
          Meter
          <select
            className="bg-gray-800 border border-gray-600 rounded px-2 py-1"
            value={meter}
            onChange={event => {
              const next = event.target.value;
              setMeter(next);
              persist({ taps, grid, lockedBpm, marks, meter: next });
            }}
          >
            <option>4/4</option>
            <option>3/4</option>
            <option>6/8</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        className="w-full py-16 rounded-2xl bg-blue-700 text-3xl font-bold hover:bg-blue-600"
        onClick={tap}
      >
        Tap the 1
      </button>
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 space-y-3">
        <p className="text-lg">{verdictText}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="px-3 py-2 rounded bg-gray-700 text-sm" onClick={useDetected}>
            Use detected grid
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded bg-gray-700 text-sm disabled:opacity-40"
            disabled={verdict.kind !== 'steady'}
            onClick={lock}
          >
            {verdict.kind === 'steady' ? `Lock to ${verdict.bpm} BPM` : 'Lock'}
          </button>
          {lockedBpm !== null && (
            <button type="button" className="px-3 py-2 rounded bg-gray-700 text-sm" onClick={useTaps}>
              Use my taps
            </button>
          )}
          <button type="button" className="px-3 py-2 rounded bg-gray-700 text-sm" onClick={undo} disabled={taps.length === 0}>
            Undo
          </button>
          <label className="text-sm text-gray-300 flex items-center gap-2 px-2">
            <input type="checkbox" checked={snapHits} onChange={event => setSnapHits(event.target.checked)} />
            Snap to detected hits
          </label>
        </div>
      </div>
      <div>
        <h3 className="font-medium mb-2">Sections</h3>
        <ul className="text-sm text-gray-300 space-y-1">
          {marks
            .slice()
            .sort((a, b) => a.bar - b.bar)
            .map(mark => (
              <li key={`${mark.bar}-${mark.name}`}>
                {mark.name} · bar {mark.bar}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
