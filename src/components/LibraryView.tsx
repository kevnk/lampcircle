import { Song } from '../types';
import { Music, Clock, Activity, Trash2 } from 'lucide-react';
import { formatTime } from '../lib/utils';
import { deleteSong } from '../lib/db';

interface LibraryViewProps {
  songs: Song[];
  onSelectSong: (song: Song) => void;
  onSongsChanged: () => void;
}

export function LibraryView({ songs, onSelectSong, onSongsChanged }: LibraryViewProps) {
  const handleDelete = async (songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Delete this song? This cannot be undone.')) {
      return;
    }

    await deleteSong(songId);
    onSongsChanged();
  };

  return (
    <div className="library-view">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {songs.map(song => (
          <div
            key={song.id}
            onClick={() => onSelectSong(song)}
            className="song-card p-4 bg-gray-800 rounded-lg hover:bg-gray-700 cursor-pointer transition-colors"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Music className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-semibold truncate">
                    {song.name}
                  </h3>
                  <p className="text-gray-400 text-sm">
                    {song.regions.length} regions
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(song.id, e)}
                className="text-gray-500 hover:text-red-500 transition-colors ml-2"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-400">
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatTime(song.duration)}
              </div>
              {song.bpm && (
                <div className="flex items-center gap-1">
                  <Activity className="w-4 h-4" />
                  {song.bpm} BPM
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
