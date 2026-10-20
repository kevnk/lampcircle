import { useState, useEffect } from 'react';
import { Song } from '../types';
import { getAllSongs } from '../lib/db';

export function useSongs() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSongs = async () => {
    setLoading(true);
    try {
      const allSongs = await getAllSongs();
      setSongs(allSongs);
    } catch (error) {
      console.error('Failed to load songs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSongs();
  }, []);

  return { songs, loading, reload: loadSongs };
}
