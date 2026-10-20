import { useMemo, useState } from 'react';
import { Song } from '../types';
import { formatBarBeat, formatTime } from '../lib/utils';
import {
  assignLyricToBeat,
  distributeLyricsAcrossBeats,
  getLyricAtTime,
  getLyricForBeat,
} from '../lib/lyrics';

interface BeatGridViewProps {
  song: Song;
  currentTime: number;
  onSeekToBeat: (time: number) => void;
  onSongUpdate: (song: Song) => void;
}

export function BeatGridView({
  song,
  currentTime,
  onSeekToBeat,
  onSongUpdate,
}: BeatGridViewProps) {
  const [pasteText, setPasteText] = useState(song.lyrics || '');
  const [editingBeat, setEditingBeat] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [regionId, setRegionId] = useState<string>('');

  const currentBeatIndex = song.beats.findIndex((b, i) => {
    const next = song.beats[i + 1];
    if (next) return currentTime >= b.time && currentTime < next.time;
    return Math.abs(b.time - currentTime) < 0.15;
  });

  const currentLyric = useMemo(
    () => getLyricAtTime(song.lyricLines, currentTime),
    [song.lyricLines, currentTime]
  );

  const hasLyrics = (song.lyricLines?.length ?? 0) > 0;

  const handleDistribute = () => {
    if (!pasteText.trim()) return;
    const region = regionId
      ? song.regions.find(r => r.id === regionId) ?? null
      : null;
    const lyricLines = distributeLyricsAcrossBeats(
      pasteText,
      song.beats,
      region
    );
    onSongUpdate({ ...song, lyrics: pasteText, lyricLines });
  };

  const handleClearLyrics = () => {
    onSongUpdate({ ...song, lyricLines: [], lyrics: pasteText });
  };

  const handleSaveBeatLyric = (beatIndex: number) => {
    const lyricLines = assignLyricToBeat(
      song.lyricLines,
      editText,
      beatIndex,
      song.beats
    );
    onSongUpdate({ ...song, lyricLines });
    setEditingBeat(null);
    setEditText('');
  };

  if (song.beats.length === 0) {
    return (
      <div className="beat-grid-view text-gray-400 text-center py-8">
        No beats detected for this song.
      </div>
    );
  }

  return (
    <div className="beat-grid-view space-y-4">
      {/* Current lyric strip */}
      <div className="bg-indigo-950/50 border border-indigo-800 rounded-lg px-4 py-3 min-h-[3rem] flex items-center">
        <span className="text-indigo-300 text-xs uppercase tracking-wide mr-3 shrink-0">
          Now
        </span>
        <span className="text-white text-lg font-medium truncate">
          {currentLyric?.text || (
            <span className="text-gray-500 italic text-sm">
              {hasLyrics ? '…' : 'No lyrics on grid yet'}
            </span>
          )}
        </span>
      </div>

      {/* Paste / distribute empty or edit state */}
      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h3 className="text-white font-semibold mb-2">Words on Beat Grid</h3>
        {!hasLyrics && (
          <p className="text-gray-400 text-sm mb-3">
            Paste lyrics (one line per phrase), then distribute across beats or a
            region.
          </p>
        )}
        <textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          placeholder="Paste lyrics here, one line per phrase…"
          className="w-full h-28 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none resize-none text-sm"
        />
        <div className="flex flex-wrap gap-2 mt-2 items-center">
          {song.regions.length > 0 && (
            <select
              value={regionId}
              onChange={e => setRegionId(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-2 text-sm text-white"
            >
              <option value="">All beats</option>
              {song.regions.map(r => (
                <option key={r.id} value={r.id}>
                  Region: {r.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handleDistribute}
            disabled={!pasteText.trim()}
            className="btn-primary text-sm py-2 px-3 disabled:opacity-50"
          >
            Distribute across beats{regionId ? ' / region' : ''}
          </button>
          {hasLyrics && (
            <button
              type="button"
              onClick={handleClearLyrics}
              className="btn-secondary text-sm py-2 px-3"
            >
              Clear grid words
            </button>
          )}
        </div>
      </div>

      <h3 className="text-white font-semibold">
        Beat Grid ({song.beats.length} beats)
      </h3>

      <div className="bg-gray-800 rounded-lg p-4 max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-800 z-10">
            <tr className="text-gray-400 border-b border-gray-700">
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Time</th>
              <th className="text-left p-2">Bar.Beat</th>
              <th className="text-left p-2">Words</th>
              <th className="text-left p-2">Confidence</th>
              <th className="text-right p-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {song.beats.map((beat, index) => {
              const word = getLyricForBeat(
                song.lyricLines,
                beat,
                index,
                song.beats
              );
              return (
                <tr
                  key={index}
                  className={`border-b border-gray-700 hover:bg-gray-700 cursor-pointer ${
                    index === currentBeatIndex ? 'bg-blue-900 bg-opacity-40' : ''
                  }`}
                  onClick={() => onSeekToBeat(beat.time)}
                >
                  <td className="p-2 text-gray-400">{index + 1}</td>
                  <td className="p-2 text-white font-mono">
                    {formatTime(beat.time)}
                  </td>
                  <td className="p-2 text-white font-mono">
                    {formatBarBeat(beat.bar, beat.beat)}
                  </td>
                  <td
                    className="p-2 text-indigo-200 max-w-[12rem]"
                    onClick={e => e.stopPropagation()}
                  >
                    {editingBeat === index ? (
                      <div className="flex gap-1">
                        <input
                          autoFocus
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveBeatLyric(index);
                            if (e.key === 'Escape') setEditingBeat(null);
                          }}
                          className="flex-1 px-2 py-1 bg-gray-600 text-white rounded text-xs border border-gray-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveBeatLyric(index)}
                          className="text-xs text-blue-400"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-left w-full truncate hover:text-white"
                        title={word || 'Click to assign word'}
                        onClick={() => {
                          setEditingBeat(index);
                          setEditText(word);
                        }}
                      >
                        {word || (
                          <span className="text-gray-600 italic">—</span>
                        )}
                      </button>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            beat.confidence > 0.7
                              ? 'bg-green-500'
                              : beat.confidence > 0.4
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                          }`}
                          style={{ width: `${beat.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-gray-400 text-xs">
                        {(beat.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onSeekToBeat(beat.time);
                      }}
                      className="text-blue-400 hover:text-blue-300 text-xs"
                    >
                      Seek
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="p-3 bg-gray-800 rounded-lg text-sm text-gray-400">
        <p className="mb-1">
          <strong className="text-white">Words:</strong> click a Words cell to
          assign manually, or paste + distribute above.
        </p>
        <p className="mb-1">
          <strong className="text-white">High confidence (green):</strong> Strong
          beat detected
        </p>
        <p className="mb-1">
          <strong className="text-white">Medium confidence (yellow):</strong>{' '}
          Probable beat
        </p>
        <p>
          <strong className="text-white">Low confidence (red):</strong> Estimated
          beat (may need adjustment)
        </p>
      </div>
    </div>
  );
}
