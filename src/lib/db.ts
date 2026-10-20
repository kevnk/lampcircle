import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Song, SetlistItem } from '../types';

interface WorshipDB extends DBSchema {
  songs: {
    key: string;
    value: Song;
    indexes: { 'by-date': number };
  };
  setlist: {
    key: string;
    value: SetlistItem;
    indexes: { 'by-order': number };
  };
}

let db: IDBPDatabase<WorshipDB> | null = null;

export async function initDB() {
  if (db) return db;
  
  db = await openDB<WorshipDB>('worship-looper', 1, {
    upgrade(db) {
      const songStore = db.createObjectStore('songs', { keyPath: 'id' });
      songStore.createIndex('by-date', 'dateAdded');
      
      const setlistStore = db.createObjectStore('setlist', { keyPath: 'id' });
      setlistStore.createIndex('by-order', 'order');
    },
  });
  
  return db;
}

export async function saveSong(song: Song) {
  const database = await initDB();
  await database.put('songs', song);
}

export async function getSong(id: string): Promise<Song | undefined> {
  const database = await initDB();
  return database.get('songs', id);
}

export async function getAllSongs(): Promise<Song[]> {
  const database = await initDB();
  return database.getAllFromIndex('songs', 'by-date');
}

export async function deleteSong(id: string) {
  const database = await initDB();
  await database.delete('songs', id);
}

export async function saveSetlistItem(item: SetlistItem) {
  const database = await initDB();
  await database.put('setlist', item);
}

export async function getSetlist(): Promise<SetlistItem[]> {
  const database = await initDB();
  return database.getAllFromIndex('setlist', 'by-order');
}

export async function deleteSetlistItem(id: string) {
  const database = await initDB();
  await database.delete('setlist', id);
}

export async function clearSetlist() {
  const database = await initDB();
  await database.clear('setlist');
}
