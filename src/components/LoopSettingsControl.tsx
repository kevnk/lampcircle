import {
  PlaybackState,
  LoopSnapMode,
  LoopOverlapBeats,
  FadeCurve,
} from '../types';

interface LoopSettingsControlProps {
  playbackState: PlaybackState;
  compact?: boolean;
  onSnapModeChange: (mode: LoopSnapMode) => void;
  onOverlapChange: (beats: LoopOverlapBeats) => void;
  onFadeCurveChange: (curve: FadeCurve) => void;
  onPersist?: () => void;
}

const SNAP_OPTIONS: { value: LoopSnapMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'beat', label: 'Beat' },
  { value: 'measure', label: 'Measure' },
];

const OVERLAP_OPTIONS: LoopOverlapBeats[] = [0, 0.5, 1, 2];

export function LoopSettingsControl({
  playbackState,
  compact = false,
  onSnapModeChange,
  onOverlapChange,
  onFadeCurveChange,
  onPersist,
}: LoopSettingsControlProps) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Snap</span>
          <select
            value={playbackState.loopSnapMode}
            onChange={e => {
              onSnapModeChange(e.target.value as LoopSnapMode);
              onPersist?.();
            }}
            className="bg-gray-700 border border-gray-600 rounded px-1.5 py-1 text-white"
          >
            {SNAP_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Overlap</span>
          <select
            value={playbackState.loopOverlapBeats}
            onChange={e => {
              onOverlapChange(parseFloat(e.target.value) as LoopOverlapBeats);
              onPersist?.();
            }}
            className="bg-gray-700 border border-gray-600 rounded px-1.5 py-1 text-white"
          >
            {OVERLAP_OPTIONS.map(v => (
              <option key={v} value={v}>
                {v === 0 ? '0 (cut)' : `${v} beat${v === 1 ? '' : 's'}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-gray-500">Fade</span>
          <select
            value={playbackState.fadeCurve}
            onChange={e => {
              onFadeCurveChange(e.target.value as FadeCurve);
              onPersist?.();
            }}
            className="bg-gray-700 border border-gray-600 rounded px-1.5 py-1 text-white"
          >
            <option value="equal-power">Equal-power</option>
            <option value="linear">Linear</option>
          </select>
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-white font-semibold">Loop Settings</h3>
      <div className="bg-gray-800 p-4 rounded-lg space-y-4 text-sm border border-gray-700">
        <div>
          <label className="block text-gray-400 mb-2">Snap loop points to</label>
          <div className="flex gap-2">
            {SNAP_OPTIONS.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onSnapModeChange(o.value);
                  onPersist?.();
                }}
                className={`flex-1 px-3 py-2 rounded transition-colors ${
                  playbackState.loopSnapMode === o.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-gray-500 text-xs mt-1">
            Default Measure. Applies to [ ] loop points and region start/end.
          </p>
        </div>

        <div>
          <label className="block text-gray-400 mb-2">
            Loop overlap (beats) — crossfade length
          </label>
          <div className="flex gap-2">
            {OVERLAP_OPTIONS.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  onOverlapChange(v);
                  onPersist?.();
                }}
                className={`flex-1 px-3 py-2 rounded transition-colors ${
                  playbackState.loopOverlapBeats === v
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <p className="text-gray-500 text-xs mt-1">
            Plays past loop end while starting before loop start. Quantized to
            beat duration from BPM / grid.
          </p>
        </div>

        <div>
          <label className="block text-gray-400 mb-2">Fade curve</label>
          <div className="flex gap-2">
            {(['equal-power', 'linear'] as FadeCurve[]).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onFadeCurveChange(c);
                  onPersist?.();
                }}
                className={`flex-1 px-3 py-2 rounded transition-colors capitalize ${
                  playbackState.fadeCurve === c
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
