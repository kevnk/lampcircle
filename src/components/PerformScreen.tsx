import { useEffect } from 'react';
import { PlaybackState, Song, SongPart } from '../types';
import { barBeatAt, beatsPerBar, partWindow, readPhase } from '../lib/songMap';
import { formatBarBeat, formatTime } from '../lib/utils';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { BackLink, PlayButton } from './FlowControls';

interface PerformScreenProps {
  song: Song;
  playlist: string[];
  songs: Song[];
  playback: PlaybackState;
  onToggle: () => void;
  onQueue: (partId: string) => void;
  onJump: (partId: string) => void;
  onArm: (partId: string) => void;
  onBack: () => void;
  onSong: (songId: string) => void;
  onMetronome: () => void;
}

export function PerformScreen({
  song,
  playlist,
  songs,
  playback,
  onToggle,
  onQueue,
  onJump,
  onArm,
  onBack,
  onSong,
  onMetronome,
}: PerformScreenProps) {
  const phase = readPhase(song.phase);
  const parts: SongPart[] = phase.kind === 'ready' ? phase.parts : [];
  const downbeats = phase.kind === 'ready' ? phase.downbeats : [];
  const perBar = beatsPerBar(song.timeSignature ?? '4/4');
  const position = barBeatAt(playback.currentTime, downbeats, perBar);
  const active = parts.find(part => part.id === playback.activePartId) ?? null;
  const queued = parts.find(part => part.id === playback.queuedPartId) ?? null;
  const queuedWindow = queued ? partWindow(queued, downbeats, perBar) : null;

  useEffect(() => {
    if (parts[0] && !playback.activePartId) onArm(parts[0].id);
  }, [song.id]);

  const keys: Record<string, () => void> = { ' ': onToggle, m: onMetronome };
  parts.slice(0, 9).forEach((part, index) => {
    keys[String(index + 1)] = () => onQueue(part.id);
  });
  useKeyboardShortcuts(keys, true);

  const place = playlist.indexOf(song.id);
  const nextSong = place >= 0 ? songs.find(item => item.id === playlist[place + 1]) : undefined;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <BackLink onClick={onBack} />
          {playlist.length > 1 && (
            <p className="text-sm text-gray-400">
              Song {place + 1} of {playlist.length}
            </p>
          )}
        </div>
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold">{song.name}</h1>
          <p className="text-2xl text-gray-300 mt-3 tabular-nums">
            {position ? `Bar ${formatBarBeat(position.bar, position.beat)}` : formatTime(playback.currentTime)}
          </p>
          <p className="text-xl text-gray-200 mt-2">{active ? active.name : 'Choose a part'}</p>
        </div>
        <div className="flex justify-center gap-3 mb-8">
          <PlayButton isPlaying={playback.isPlaying} onToggle={onToggle} />
          <button type="button" className="px-4 py-3 rounded-lg bg-gray-800" onClick={onMetronome}>
            Click {playback.metronomeEnabled ? 'on' : 'off'}
          </button>
          {nextSong && (
            <button type="button" className="px-4 py-3 rounded-lg bg-gray-800" onClick={() => onSong(nextSong.id)}>
              Next song
            </button>
          )}
        </div>
        <div className="mb-6 min-h-[6.25rem]">
          {queued && queuedWindow && (
            <div className="text-center bg-gray-900 rounded-xl px-4 py-3">
              <p className="text-gray-300 text-sm">Up next</p>
              <p className="text-2xl font-semibold text-white">{queued.name}</p>
              <p className="text-sm text-gray-300 mt-1">
                Fade {formatTime(queuedWindow.audioStart)}. Singers {formatTime(queuedWindow.singerStart)}. Lands {formatTime(queuedWindow.landing)}.
              </p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {parts.map((part, index) => {
            const current = part.id === playback.activePartId;
            const isQueued = part.id === playback.queuedPartId;
            return (
              <div key={part.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  className={`min-h-24 rounded-xl px-3 py-4 text-left ${current ? 'ring-2 ring-white' : ''} ${isQueued ? 'ring-2 ring-purple-400' : ''}`}
                  style={{ background: part.color }}
                  onClick={() => onQueue(part.id)}
                >
                  <span className="text-xs opacity-80">{index + 1}</span>
                  <span className="block text-xl font-bold">{part.name}</span>
                  <span className="block min-h-4 text-xs">{isQueued && 'Up next · tap to cancel'}</span>
                </button>
                <button type="button" className="text-xs text-gray-300" onClick={() => onJump(part.id)}>
                  Jump now
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
