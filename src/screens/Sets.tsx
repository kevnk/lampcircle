import { useMemo, useState, type KeyboardEvent } from 'react';
import { Menu as Handle, X } from 'lucide-react';
import type { Song, WorshipSet } from '../types';
import { go, useStore } from '../store';
import { Button, Card, LinkButton, Menu, MenuItem } from '../ui';
import { KEY_NAMES, route, tempoNote } from '../lib/music';
import { bpmOf, isReady, keyOf, keysText, planSeconds, planText, songGrid, songKeys } from '../lib/songMap';

export function songBpm(song: Song): number | null {
  const bpm = bpmOf(songGrid(song));
  return bpm ? Math.round(bpm) : null;
}

/** The pad between two songs: the key you leave, the key you need, and the way in. */
export function livePad(song: Song, next: Song | undefined) {
  const from = keyOf(songKeys(song)?.end);
  const to = next ? keyOf(songKeys(next)?.start) : null;
  const way = from ? route(from, to) : [];
  const a = songBpm(song);
  const b = next ? songBpm(next) : null;
  return {
    from: from ? KEY_NAMES[from.tonic] : '—',
    to: next ? (to ? KEY_NAMES[to.tonic] : '—') : 'end',
    way: way.map(tonic => KEY_NAMES[tonic]),
    note: a && b ? tempoNote(a, b) : null,
  };
}

export function Sets({ id }: { id?: string }) {
  const store = useStore();
  const { songs, sets } = store;
  const set = sets.find(item => item.id === id) ?? sets[0];
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);

  const ready = useMemo(() => {
    const words = query.toLowerCase().trim();
    return songs.filter(isReady).filter(song => {
      const text = `${song.title} ${keysText(songKeys(song))} ${songBpm(song) ?? ''}`.toLowerCase();
      return !words || words.split(/\s+/).every(word => text.includes(word));
    });
  }, [songs, query]);

  if (!set) {
    return (
      <div>
        <h1 className="mb-6 text-4xl font-bold tracking-tight">Sets</h1>
        <Card className="p-6">
          <p className="mb-4">No sets yet. A set is the songs for one gathering, in order, with a live pad between each.</p>
          <Button tone="primary" onClick={() => go({ page: 'sets', id: store.newSet().id })}>
            New set
          </Button>
        </Card>
      </div>
    );
  }

  const items = set.songIds.map(songId => songs.find(song => song.id === songId)).filter((song): song is Song => Boolean(song));
  const unready = items.filter(song => !isReady(song));
  const minutes = Math.round(items.reduce((sum, song) => sum + planSeconds(song), 0) / 60);
  const update = (next: Partial<WorshipSet>) => store.saveSet({ ...set, ...next });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const ids = items.map(song => song.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    update({ songIds: ids });
  };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <input
            aria-label="Set name"
            value={set.name}
            onChange={event => update({ name: event.target.value })}
            className="-ml-1 w-full max-w-xl rounded bg-transparent px-1 text-4xl font-bold tracking-tight hover:bg-white/60 focus:bg-white"
          />
          <p className="mt-1 text-muted">
            {items.length} song{items.length === 1 ? '' : 's'} · {items.length} pad{items.length === 1 ? '' : 's'} · about {minutes} min if played as planned
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sets.length > 1 && (
            <select aria-label="Switch set" value={set.id} onChange={event => go({ page: 'sets', id: event.target.value })} className="rounded-md border border-line bg-white px-2 py-2.5">
              {sets.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <Menu label="More">
            <MenuItem onClick={() => go({ page: 'sets', id: store.newSet().id })}>New set</MenuItem>
            <MenuItem
              danger
              onClick={() => {
                if (confirm(`Delete ${set.name}? The songs stay in your library.`)) void store.removeSet(set.id).then(() => go({ page: 'sets' }));
              }}
            >
              Delete set
            </MenuItem>
          </Menu>
          <Button
            onClick={() => {
              update({});
              setSaved(true);
              window.setTimeout(() => setSaved(false), 1500);
            }}
          >
            {saved ? 'Saved ✓' : 'Save set'}
          </Button>
          <Button tone="primary" disabled={items.length === 0 || unready.length > 0} onClick={() => go({ page: 'perform', setId: set.id, item: 0 })}>
            Perform this set
          </Button>
        </div>
      </header>
      {unready.length > 0 && (
        <p className="mb-4 rounded-md border border-line bg-white px-4 py-3 text-sm">
          {unready.map(song => song.title).join(', ')} still {unready.length === 1 ? 'needs' : 'need'} work before Perform.{' '}
          <LinkButton className="text-sm" onClick={() => go({ page: 'song', id: unready[0].id, step: 'export' })}>
            See what is left
          </LinkButton>
        </p>
      )}

      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <Card className="w-full p-4 lg:w-[270px]">
          <h2 className="text-lg font-bold">Ready songs</h2>
          <label className="mt-2 block text-sm text-muted">
            Search ready songs
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title, key or BPM" className="mt-1 w-full rounded-md border border-faint px-3 py-2 text-ink placeholder:text-faint" />
          </label>
          <ul className="mt-2">
            {ready.map(song => {
              const added = set.songIds.includes(song.id);
              return (
                <li key={song.id} className="flex items-center justify-between gap-2 border-t border-line py-3 first:border-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{song.title}</p>
                    <p className="font-mono text-xs text-muted">
                      {songBpm(song) ?? '—'} · {keysText(songKeys(song))}
                    </p>
                  </div>
                  <Button className="px-3.5" disabled={added} onClick={() => update({ songIds: [...set.songIds, song.id] })}>
                    {added ? 'Added' : 'Add'}
                  </Button>
                </li>
              );
            })}
            {ready.length === 0 && <li className="py-3 text-sm text-muted">{query ? 'No ready songs match.' : 'Songs show up here once all 4 export checks pass.'}</li>}
          </ul>
        </Card>

        <ol className="w-full min-w-0 flex-1">
          {items.length === 0 && <li className="rounded-md border border-dashed border-faint p-6 text-muted">Add ready songs from the left. They play in this order.</li>}
          {items.map((song, i) => {
            const pad = livePad(song, items[i + 1]);
            const bpm = songBpm(song);
            return (
              <li
                key={song.id}
                onDragOver={event => event.preventDefault()}
                onDrop={() => {
                  if (dragging !== null) move(dragging, i);
                  setDragging(null);
                }}
              >
                <div
                  className={`flex items-start gap-4 rounded-md border border-line bg-white px-4 py-3.5 ${dragging === i ? 'opacity-50' : ''}`}
                  draggable
                  onDragStart={() => setDragging(i)}
                  onDragEnd={() => setDragging(null)}
                >
                  <button
                    type="button"
                    className="mt-1.5 cursor-grab text-faint hover:text-ink"
                    aria-label={`Move ${song.title}. Use the up and down arrows.`}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key === 'ArrowUp') move(i, i - 1);
                      if (event.key === 'ArrowDown') move(i, i + 1);
                    }}
                  >
                    <Handle className="h-5 w-5" />
                  </button>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink font-medium text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <p className="text-lg font-bold">{song.title}</p>
                      <p className="font-mono text-sm">
                        {bpm ? `${bpm} BPM` : '—'} · {keysText(songKeys(song))}
                      </p>
                    </div>
                    <p className="mt-0.5 text-muted">
                      Plan: <span className="font-mono text-ink">{planText(song) || '—'}</span>
                    </p>
                  </div>
                  <button type="button" className="mt-1 rounded p-1 text-faint hover:bg-paper hover:text-ink" aria-label={`Remove ${song.title} from the set`} onClick={() => update({ songIds: set.songIds.filter(songId => songId !== song.id) })}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="ml-[3.9rem] border-l-2 border-faint py-2.5 pl-6">
                  <div className="rounded-md border border-dashed border-faint bg-[#F2F2EE] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="font-mono text-xs uppercase tracking-wider text-muted">Live pad</span>
                      <span className="font-mono text-lg font-bold">
                        {pad.from} → {pad.to}
                      </span>
                      <span className="text-sm text-muted">way in</span>
                      {pad.way.map((key, k) => (
                        <span key={`${key}-${k}`} className="rounded border border-faint bg-white px-1.5 py-0.5 font-mono text-xs">
                          {key}
                        </span>
                      ))}
                      {!items[i + 1] && <span className="text-sm text-muted">played live · fade when ready</span>}
                      {!pad.note && (
                        <LinkButton className="ml-auto" onClick={() => go({ page: 'perform', setId: set.id, item: 2 * i + 1 })}>
                          Practice
                        </LinkButton>
                      )}
                    </div>
                    {pad.note && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="rounded bg-accent-soft px-2 py-1 text-sm text-accent">{pad.note}</span>
                        <LinkButton onClick={() => go({ page: 'perform', setId: set.id, item: 2 * i + 1 })}>Practice</LinkButton>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
