import {
  Song,
  PlaybackState,
  LoopSnapMode,
  LoopOverlapBeats,
  FadeCurve,
} from '../types';
import { Play, Pause, SkipBack, SkipForward, Volume2, Repeat, List } from 'lucide-react';
import { formatTime } from '../lib/utils';
import { LoopSettingsControl } from './LoopSettingsControl';

interface TransportControlsProps {
  song: Song;
  playbackState: PlaybackState;
  onPlayPause: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
  onLoopToggle: () => void;
  onMetronomeToggle: () => void;
  onSnapModeChange: (mode: LoopSnapMode) => void;
  onOverlapChange: (beats: LoopOverlapBeats) => void;
  onFadeCurveChange: (curve: FadeCurve) => void;
  onPersistLoopSettings?: () => void;
}

export function TransportControls({
  song,
  playbackState,
  onPlayPause,
  onSeek,
  onVolumeChange,
  onLoopToggle,
  onMetronomeToggle,
  onSnapModeChange,
  onOverlapChange,
  onFadeCurveChange,
  onPersistLoopSettings,
}: TransportControlsProps) {
  const skipBackward = () => {
    onSeek(Math.max(0, playbackState.currentTime - 5));
  };

  const skipForward = () => {
    onSeek(Math.min(song.duration, playbackState.currentTime + 5));
  };

  return (
    <div className="transport-controls bg-gray-800 p-4 rounded-lg border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={skipBackward}
            className="p-2 text-white hover:bg-gray-700 rounded transition-colors"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={onPlayPause}
            className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full transition-colors"
          >
            {playbackState.isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6" />
            )}
          </button>

          <button
            onClick={skipForward}
            className="p-2 text-white hover:bg-gray-700 rounded transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          <button
            onClick={onLoopToggle}
            className={`p-2 rounded transition-colors ${
              playbackState.loop.enabled
                ? 'bg-blue-600 text-white'
                : 'text-white hover:bg-gray-700'
            }`}
            title="Toggle loop"
          >
            <Repeat className="w-5 h-5" />
          </button>

          <button
            onClick={onMetronomeToggle}
            className={`p-2 rounded transition-colors ${
              playbackState.metronomeEnabled
                ? 'bg-green-600 text-white'
                : 'text-white hover:bg-gray-700'
            }`}
            title="Toggle metronome"
          >
            <List className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <Volume2 className="w-5 h-5 text-white" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={playbackState.volume}
            onChange={e => onVolumeChange(parseFloat(e.target.value))}
            className="w-24"
          />
        </div>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
        <span className="text-white font-mono">
          {formatTime(playbackState.currentTime)}
        </span>
        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{
              width: `${(playbackState.currentTime / song.duration) * 100}%`,
            }}
          />
        </div>
        <span className="font-mono">{formatTime(song.duration)}</span>
      </div>

      <div className="border-t border-gray-700 pt-3">
        <div className="text-gray-500 text-xs mb-1.5 uppercase tracking-wide">
          Loop Settings
        </div>
        <LoopSettingsControl
          playbackState={playbackState}
          compact
          onSnapModeChange={onSnapModeChange}
          onOverlapChange={onOverlapChange}
          onFadeCurveChange={onFadeCurveChange}
          onPersist={onPersistLoopSettings}
        />
      </div>

      {playbackState.loop.enabled && (
        <div className="mt-3 p-2 bg-blue-900 bg-opacity-30 rounded text-sm text-blue-300">
          Loop: {formatTime(playbackState.loop.start)} →{' '}
          {formatTime(playbackState.loop.end)}
          {playbackState.loopOverlapBeats > 0 && (
            <span className="ml-2 text-blue-400">
              · overlap {playbackState.loopOverlapBeats} beat
              {playbackState.loopOverlapBeats === 1 ? '' : 's'} (
              {playbackState.fadeCurve})
            </span>
          )}
          {playbackState.loop.count > 0 && (
            <span className="ml-2">
              ({playbackState.loop.currentIteration + 1}/
              {playbackState.loop.count})
            </span>
          )}
        </div>
      )}

      {playbackState.queuedRegion && (
        <div className="mt-2 p-2 bg-green-900 bg-opacity-30 rounded text-sm text-green-300">
          Next:{' '}
          {song.regions.find(r => r.id === playbackState.queuedRegion)?.name}
        </div>
      )}
    </div>
  );
}
