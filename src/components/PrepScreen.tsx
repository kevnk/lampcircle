import { useMemo, useState } from 'react';
import { Song, SongPart } from '../types';
import { beatsPerBar, clampPickup, expandDownbeats, partWindow, partsFromMarks, readPhase } from '../lib/songMap';
import { serializeDjw } from '../lib/djw';
import { downloadFile, formatTime } from '../lib/utils';
import { BackLink, PlayButton } from './FlowControls';

interface PrepScreenProps {
  song: Song;
  currentTime: number;
  isPlaying: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
  onSong: (song: Song) => void;
  onBack: () => void;
  onRetap: () => void;
  onPerform: () => void;
}

function startingParts(song: Song): SongPart[] {
  const phase = readPhase(song.phase);
  if (phase.kind === 'ready') return phase.parts;
  if (phase.kind === 'tapped') return partsFromMarks(phase.marks, phase.downbeats.length);
  return [];
}

function gridOf(song: Song): { downbeats: number[]; taps: number[]; lockedBpm: number | null } {
  const phase = readPhase(song.phase);
  if (phase.kind === 'needs-tap') return { downbeats: [], taps: [], lockedBpm: null };
  return { downbeats: phase.downbeats, taps: phase.taps, lockedBpm: phase.lockedBpm };
}

export function PrepScreen({ song, currentTime, isPlaying, onToggle, onSeek, onSong, onBack, onRetap, onPerform }: PrepScreenProps) {
  const map = gridOf(song);
  const perBar = beatsPerBar(song.timeSignature ?? '4/4');
  const [parts, setParts] = useState<SongPart[]>(() => startingParts(song));
  const [selectedId, setSelectedId] = useState<string | null>(parts[0]?.id ?? null);
  const selected = parts.find(part => part.id === selectedId) ?? null;

  const span = useMemo(() => {
    if (map.downbeats.length < 2) return 1;
    return map.downbeats[map.downbeats.length - 1] - map.downbeats[0] || song.duration;
  }, [map.downbeats, song.duration]);

  const updatePart = (id: string, patch: Partial<SongPart>) => {
    setParts(current => current.map(part => (part.id === id ? { ...part, ...patch } : part)));
  };

  const save = (goPerform: boolean) => {
    const beats = expandDownbeats(map.downbeats, perBar);
    const regions = parts.flatMap(part => {
      const window = partWindow(part, map.downbeats, perBar);
      if (!window) return [];
      return [{
        id: part.id,
        name: part.name,
        start: window.landing,
        end: part.endBar >= map.downbeats.length ? song.duration : window.musicalEnd,
        color: part.color,
      }];
    });
    const next: Song = {
      ...song,
      beats: beats.length > 0 ? beats : song.beats,
      regions,
      bpm: map.lockedBpm ?? song.bpm,
      phase: {
        kind: 'ready',
        downbeats: map.downbeats,
        taps: map.taps,
        lockedBpm: map.lockedBpm,
        parts,
      },
    };
    onSong(next);
    if (goPerform) onPerform();
    else onBack();
  };

  const exportMap = () => {
    const yaml = serializeDjw({
      title: song.name,
      meter: song.timeSignature ?? '4/4',
      audioFile: song.name,
      source: song.sourceUrl,
      downbeats: map.downbeats,
      parts: parts.map(part => ({
        name: part.name,
        startBar: part.startBar,
        endBar: part.endBar,
        pickupBeats: part.pickupBeats,
        fadeInBeats: part.fadeInBeats,
        fadeOutBeats: part.fadeOutBeats,
        loop: part.loop,
      })),
    });
    downloadFile(yaml, `${song.name}.djw`, 'application/yaml');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <BackLink onClick={onBack} />
        <div className="flex gap-2">
          <button type="button" className="px-3 py-2 rounded bg-gray-700 text-sm" onClick={exportMap}>Export .djw</button>
          <button type="button" className="px-3 py-2 rounded bg-gray-700 text-sm" onClick={() => save(false)} disabled={parts.length === 0}>
            Save · mark ready
          </button>
          <button type="button" className="px-3 py-2 rounded bg-emerald-600 text-sm" onClick={() => save(true)} disabled={parts.length === 0}>
            Perform
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">{song.name}</h2>
          <p className="text-gray-400 text-sm mt-1">
            {map.downbeats.length} bars · {map.lockedBpm ? `${map.lockedBpm} BPM locked` : 'tap grid'} · {song.timeSignature ?? '4/4'} ·{' '}
            <button type="button" className="text-gray-300" onClick={onRetap}>Re-tap</button>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PlayButton isPlaying={isPlaying} onToggle={onToggle} />
          <span className="text-gray-300 tabular-nums">{formatTime(currentTime)}</span>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 overflow-x-auto">
        <div className="relative h-28 min-w-full" style={{ width: Math.max(640, map.downbeats.length * 36) }}>
          {map.downbeats.map((time, index) => {
            const left = span === 0 ? 0 : ((time - map.downbeats[0]) / span) * 100;
            return (
              <button
                key={`${time}-${index}`}
                type="button"
                className="absolute top-0 h-full border-l border-gray-600 text-[10px] text-gray-500"
                style={{ left: `${left}%` }}
                onClick={() => {
                  onSeek(time);
                  const owner = parts.find(part => index + 1 >= part.startBar && index + 1 < part.endBar);
                  if (owner) setSelectedId(owner.id);
                }}
              >
                <span className="pl-1">{index + 1}</span>
              </button>
            );
          })}
          {parts.map(part => {
            const start = map.downbeats[part.startBar - 1];
            const endIndex = Math.min(map.downbeats.length - 1, part.endBar - 1);
            const end = map.downbeats[endIndex];
            if (start === undefined || end === undefined) return null;
            const left = ((start - map.downbeats[0]) / span) * 100;
            const width = Math.max(2, ((end - start) / span) * 100);
            return (
              <button
                key={part.id}
                type="button"
                className={`absolute top-8 h-12 rounded text-left px-2 text-sm font-medium ${selectedId === part.id ? 'ring-2 ring-white' : ''}`}
                style={{ left: `${left}%`, width: `${width}%`, background: part.color }}
                onClick={() => setSelectedId(part.id)}
              >
                {part.name}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-sm text-gray-300">
            Name
            <input
              className="mt-1 w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              value={selected.name}
              onChange={event => updatePart(selected.id, { name: event.target.value })}
            />
          </label>
          <label className="text-sm text-gray-300">
            Pickup beats
            <input
              type="number"
              min={0}
              max={16}
              step={0.5}
              className="mt-1 w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              value={selected.pickupBeats}
              onChange={event => updatePart(selected.id, { pickupBeats: clampPickup(Number(event.target.value)) })}
            />
          </label>
          <label className="text-sm text-gray-300">
            Fade in beats
            <input
              type="number"
              min={0}
              max={16}
              step={0.5}
              className="mt-1 w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              value={selected.fadeInBeats}
              onChange={event => updatePart(selected.id, { fadeInBeats: clampPickup(Number(event.target.value)) })}
            />
          </label>
          <label className="text-sm text-gray-300">
            Fade out beats
            <input
              type="number"
              min={0}
              max={16}
              step={0.5}
              className="mt-1 w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white"
              value={selected.fadeOutBeats}
              onChange={event => updatePart(selected.id, { fadeOutBeats: clampPickup(Number(event.target.value)) })}
            />
          </label>
          <p className="text-sm text-gray-400 md:col-span-2">
            {describePart(selected, map.downbeats, perBar)}
          </p>
          <label className="text-sm text-gray-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected.loop}
              onChange={event => updatePart(selected.id, { loop: event.target.checked })}
            />
            Loop this part
          </label>
          <button
            type="button"
            className="text-sm text-red-300 justify-self-start"
            onClick={() => {
              setParts(current => current.filter(part => part.id !== selected.id));
              setSelectedId(null);
            }}
          >
            Delete part
          </button>
        </div>
      )}
    </div>
  );
}

function describePart(part: SongPart, downbeats: number[], perBar: number): string {
  const window = partWindow(part, downbeats, perBar);
  if (!window) return 'This part needs a downbeat on its end bar.';
  const fadeBeat = part.fadeInBeats > 0 ? `Fade starts ${formatTime(window.audioStart)}.` : 'No fade in.';
  const singer = part.pickupBeats > 0 ? ` Singers enter ${formatTime(window.singerStart)}.` : '';
  return `${fadeBeat}${singer} Lands at ${formatTime(window.landing)}.`;
}
