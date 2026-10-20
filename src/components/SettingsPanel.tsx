import { useState } from 'react';
import {
  Song,
  PlaybackState,
  LoopSnapMode,
  LoopOverlapBeats,
  FadeCurve,
  DEFAULT_LOOP_SETTINGS,
} from '../types';
import { Download } from 'lucide-react';
import { exportSessionPreset, exportBeatGrid, downloadFile } from '../lib/utils';
import { LoopSettingsControl } from './LoopSettingsControl';

interface SettingsPanelProps {
  song: Song;
  playbackState: PlaybackState;
  onSongUpdate: (song: Song) => void;
  onSnapModeChange: (mode: LoopSnapMode) => void;
  onOverlapChange: (beats: LoopOverlapBeats) => void;
  onFadeCurveChange: (curve: FadeCurve) => void;
  onCrossfadeDurationChange?: (ms: number) => void;
}

export function SettingsPanel({
  song,
  playbackState,
  onSongUpdate,
  onSnapModeChange,
  onOverlapChange,
  onFadeCurveChange,
  onCrossfadeDurationChange,
}: SettingsPanelProps) {
  const [lyrics, setLyrics] = useState(song.lyrics || '');
  const [crossfadeMs, setCrossfadeMs] = useState(
    playbackState.crossfadeDuration
  );

  const handleExportSession = () => {
    const preset = exportSessionPreset(song);
    downloadFile(preset, `${song.name}-session.json`, 'application/json');
  };

  const handleExportBeats = () => {
    const beatCSV = exportBeatGrid(song.beats);
    downloadFile(beatCSV, `${song.name}-beats.csv`, 'text/csv');
  };

  const handleSaveLyrics = () => {
    onSongUpdate({ ...song, lyrics });
  };

  const persistLoopSettings = (
    patch: Partial<NonNullable<Song['loopSettings']>> = {}
  ) => {
    const next = {
      ...(song.loopSettings ?? DEFAULT_LOOP_SETTINGS),
      snapMode: playbackState.loopSnapMode,
      overlapBeats: playbackState.loopOverlapBeats,
      fadeCurve: playbackState.fadeCurve,
      ...patch,
    };
    onSongUpdate({ ...song, loopSettings: next });
  };

  return (
    <div className="settings-panel space-y-6">
      <div>
        <h3 className="text-white font-semibold mb-3">Song Information</h3>
        <div className="bg-gray-800 p-4 rounded-lg space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Duration:</span>
            <span className="text-white">{song.duration.toFixed(1)}s</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">BPM:</span>
            <span className="text-white">{song.bpm || 'Unknown'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Time Signature:</span>
            <span className="text-white">{song.timeSignature || '4/4'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Beats Detected:</span>
            <span className="text-white">{song.beats.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Regions:</span>
            <span className="text-white">{song.regions.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Lyric lines on grid:</span>
            <span className="text-white">{song.lyricLines?.length ?? 0}</span>
          </div>
        </div>
      </div>

      <LoopSettingsControl
        playbackState={playbackState}
        onSnapModeChange={mode => {
          onSnapModeChange(mode);
          persistLoopSettings({ snapMode: mode });
        }}
        onOverlapChange={beats => {
          onOverlapChange(beats);
          persistLoopSettings({ overlapBeats: beats });
        }}
        onFadeCurveChange={curve => {
          onFadeCurveChange(curve);
          persistLoopSettings({ fadeCurve: curve });
        }}
      />

      <div>
        <h3 className="text-white font-semibold mb-3">Crossfade (legacy ms)</h3>
        <div className="bg-gray-800 p-4 rounded-lg space-y-2 text-sm border border-gray-700">
          <p className="text-gray-500 text-xs">
            Beat overlap above is the primary loop crossfade. This value is kept
            for session presets / compatibility.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="500"
              step="10"
              value={crossfadeMs}
              onChange={e => setCrossfadeMs(parseInt(e.target.value, 10))}
              className="flex-1"
            />
            <span className="text-white font-mono w-14">{crossfadeMs}ms</span>
            <button
              type="button"
              className="btn-secondary text-xs py-1 px-2"
              onClick={() => {
                onCrossfadeDurationChange?.(crossfadeMs);
                onSongUpdate({
                  ...song,
                  sessionPreset: {
                    tempoAdjust: song.sessionPreset?.tempoAdjust ?? 0,
                    pitchShift: song.sessionPreset?.pitchShift ?? 0,
                    crossfadeDuration: crossfadeMs,
                    metronomeEnabled:
                      song.sessionPreset?.metronomeEnabled ?? false,
                    metronomeVolume: song.sessionPreset?.metronomeVolume ?? 0.3,
                    countInBars: song.sessionPreset?.countInBars ?? 0,
                    regionHotkeys: song.sessionPreset?.regionHotkeys ?? {},
                    defaultQueue: song.sessionPreset?.defaultQueue ?? [],
                  },
                });
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-white font-semibold mb-3">Lyrics (plain text)</h3>
        <p className="text-gray-500 text-xs mb-2">
          Saved as song text. Use Beat Grid → Distribute to place words on beats.
        </p>
        <textarea
          value={lyrics}
          onChange={e => setLyrics(e.target.value)}
          placeholder="Paste lyrics here..."
          className="w-full h-48 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none resize-none"
        />
        <button onClick={handleSaveLyrics} className="mt-2 btn-primary">
          Save Lyrics
        </button>
      </div>

      <div>
        <h3 className="text-white font-semibold mb-3">Export</h3>
        <div className="space-y-2">
          <button
            onClick={handleExportSession}
            className="w-full btn-secondary inline-flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Session Preset
          </button>
          <button
            onClick={handleExportBeats}
            className="w-full btn-secondary inline-flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Export Beat Grid (CSV)
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-white font-semibold mb-3">Keyboard Shortcuts</h3>
        <div className="bg-gray-800 p-4 rounded-lg space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Play/Pause</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">Space</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Jump to Region</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">1-9</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Toggle Loop</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">L</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Set Loop Start</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">[</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Set Loop End</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">]</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Toggle Metronome</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">M</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Queue Region</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">Q</kbd>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Stage Mode</span>
            <kbd className="px-2 py-1 bg-gray-700 rounded text-white">F</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
