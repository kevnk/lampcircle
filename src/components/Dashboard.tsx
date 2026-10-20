import { useEffect, useState } from 'react';
import { Song } from '../types';
import { readPhase } from '../lib/songMap';
import { deleteSong, deleteSetlistItem, getSetlist, saveSetlistItem } from '../lib/db';
import { ImportSong } from './ImportSong';
import { formatTime } from '../lib/utils';

interface DashboardProps {
  songs: Song[];
  onReload: () => void;
  onTap: (song: Song) => void;
  onPrep: (song: Song) => void;
  onPerform: (song: Song, playlist: string[]) => void;
}

function statusLabel(song: Song): string | null {
  const phase = readPhase(song.phase);
  if (phase.kind === 'ready') return null;
  if (phase.kind === 'tapped') return 'Needs prep';
  return 'Needs tap';
}

export function Dashboard({ songs, onReload, onTap, onPrep, onPerform }: DashboardProps) {
  const [setlist, setSetlist] = useState<{ id: string; songId: string; order: number }[]>([]);

  const loadSet = async () => {
    const rows = await getSetlist();
    setSetlist(rows.map(row => ({ id: row.id, songId: row.songId, order: row.order })));
  };

  useEffect(() => {
    void loadSet();
  }, [songs]);

  const addToSet = async (songId: string) => {
    if (setlist.some(row => row.songId === songId)) return;
    await saveSetlistItem({
      id: crypto.randomUUID(),
      songId,
      notes: '',
      order: setlist.length,
    });
    await loadSet();
  };

  const removeFromSet = async (id: string) => {
    await deleteSetlistItem(id);
    await loadSet();
  };

  const setSongs = setlist
    .map(row => ({ row, song: songs.find(song => song.id === row.songId) }))
    .filter((item): item is { row: (typeof setlist)[number]; song: Song } => Boolean(item.song));
  const unready = setSongs.filter(item => readPhase(item.song.phase).kind !== 'ready').length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <section className="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Get a song</h2>
        <ImportSong onSongImported={onReload} />
      </section>

      <section className="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Your songs</h2>
        {songs.length === 0 ? (
          <p className="text-gray-400 text-sm">Import a song or generate the demo to start a map.</p>
        ) : (
          <ul className="divide-y divide-gray-700">
            {songs.map(song => {
              const phase = readPhase(song.phase);
              return (
                <li key={song.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <p className="font-medium">{song.name}</p>
                      <p className="text-sm text-gray-400">
                        {[statusLabel(song), formatTime(song.duration), song.bpm ? `${song.bpm} BPM` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-gray-400 hover:text-red-400"
                      onClick={() => {
                        if (confirm(`Delete ${song.name}?`)) {
                          void deleteSong(song.id).then(onReload);
                        }
                      }}
                      aria-label={`Delete ${song.name}`}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {phase.kind !== 'ready' && (
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded bg-gray-700 text-sm"
                        onClick={() => (phase.kind === 'tapped' ? onPrep(song) : onTap(song))}
                      >
                        {phase.kind === 'tapped' ? 'Prep' : 'Tap in'}
                      </button>
                    )}
                    {phase.kind === 'ready' && (
                      <>
                        <button type="button" className="px-3 py-1.5 rounded bg-gray-700 text-sm" onClick={() => onPrep(song)}>
                          Prep
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded bg-gray-700 text-sm"
                          onClick={() => onPerform(song, [song.id])}
                        >
                          Perform
                        </button>
                      </>
                    )}
                    <button type="button" className="px-3 py-1.5 rounded bg-gray-700 text-sm" onClick={() => void addToSet(song.id)}>
                      Add to set
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="bg-gray-800 rounded-lg p-5 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Set list</h2>
        {setSongs.length === 0 ? (
          <p className="text-gray-400 text-sm">Add songs from the library. Perform stays off until every song is ready.</p>
        ) : (
          <ol className="divide-y divide-gray-700 mb-4">
            {setSongs.map((item, index) => (
              <li key={item.row.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <span className="text-sm">
                  {index + 1}. {item.song.name}
                  {statusLabel(item.song) && <span className="text-gray-400"> · {statusLabel(item.song)}</span>}
                </span>
                <button type="button" className="text-xs text-gray-400" onClick={() => void removeFromSet(item.row.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
        <button
          type="button"
          disabled={setSongs.length === 0 || unready > 0}
          className="w-full px-4 py-2 rounded bg-emerald-600 disabled:bg-gray-700 disabled:text-gray-400 text-sm font-medium"
          onClick={() => {
            if (setSongs[0]) onPerform(setSongs[0].song, setSongs.map(item => item.song.id));
          }}
        >
          {unready > 0 ? `${unready} song${unready === 1 ? '' : 's'} still need prep` : 'Perform this set'}
        </button>
      </section>
    </div>
  );
}
