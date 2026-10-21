import { useMemo, useState, type KeyboardEvent } from 'react';
import { Menu as Handle, X } from 'lucide-react';
import type { Song, WorshipSet } from '../types';
import { go, useStore } from '../store';
import { Button, Card, LinkButton, Menu, MenuItem, RestingBars } from '../ui';
import { KEY_NAMES, padFit, padGroups, route, tempoNote } from '../lib/music';
import { bpmOf, isReady, keyOf, keysText, planSeconds, planText, songGrid, songKeys } from '../lib/songMap';

export function songBpm(song: Song): number | null {
  const bpm = bpmOf(songGrid(song));
  return bpm ? Math.round(bpm) : null;
}

/** The pad between two songs: the key you leave and the key you need. */
export function livePad(song: Song, next: Song | undefined) {
  const from = keyOf(songKeys(song)?.end);
  const to = next ? keyOf(songKeys(next)?.start) : null;
  const a = songBpm(song);
  const b = next ? songBpm(next) : null;
  return {
    from: from ? KEY_NAMES[from.tonic] : '—',
    to: next ? (to ? KEY_NAMES[to.tonic] : '—') : 'end',
    note: a && b ? tempoNote(a, b) : null,
  };
}

/** Names the gap after a song by both songs, so a reorder that gives it new neighbours goes back to the suggestion. */
export const gapKey = (song: Song, next: Song | undefined) => `${song.id}>${next?.id ?? 'end'}`;

/** The pads for the gap after a song, in play order: the ones you picked, or the suggested way in. */
export function wayIn(set: WorshipSet | undefined, song: Song, next: Song | undefined): { tonics: number[]; picked: boolean } {
  const picked = set?.pads?.[gapKey(song, next)];
  if (picked?.length) return { tonics: picked, picked: true };
  const from = keyOf(songKeys(song)?.end);
  return { tonics: from ? route(from, next ? keyOf(songKeys(next)?.start) : null) : [], picked: false };
}

export function Sets({ id }: { id?: string }) {
  const store = useStore();
  const { songs, sets } = store;
  const set = sets.find(item => item.id === id) ?? sets[0];
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  /** The gap whose pads are open for picking. */
  const [picking, setPicking] = useState<string | null>(null);

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
        <h1 className="mb-6 text-4xl font-extrabold tracking-tight">Sets</h1>
        <Card className="p-6">
          <RestingBars className="mb-4" />
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
  const have = new Set(store.pads.map(pad => pad.tonic));
  /** Null goes back to the suggested way in. */
  const pickPads = (gap: string, tonics: number[] | null) => {
    const pads = { ...set.pads };
    if (tonics?.length) pads[gap] = tonics;
    else delete pads[gap];
    update({ pads });
  };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <input
            aria-label="Set name"
            value={set.name}
            onChange={event => update({ name: event.target.value })}
            className="-ml-1 w-full max-w-xl rounded-xl bg-transparent px-1 text-4xl font-extrabold tracking-tight hover:bg-raised focus:bg-raised"
          />
          <p className="mt-1 text-muted">
            {items.length} song{items.length === 1 ? '' : 's'} · {items.length} pad{items.length === 1 ? '' : 's'} · about {minutes} min if played as planned
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sets.length > 1 && (
            <select aria-label="Switch set" value={set.id} onChange={event => go({ page: 'sets', id: event.target.value })} className="rounded-full border border-edge bg-panel px-3 py-2.5">
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
        <p className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
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
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title, key or BPM" className="mt-1 w-full rounded-full border border-faint bg-well px-4 py-2 text-ink" />
          </label>
          <ul className="mt-2">
            {ready.map(song => {
              const added = set.songIds.includes(song.id);
              return (
                <li key={song.id} className="flex items-center justify-between gap-2 border-t border-line py-3 first:border-0">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{song.title}</p>
                    <p className="tabular text-xs text-muted">
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
          {items.length === 0 && (
            <li className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-edge p-8 text-center text-muted">
              <RestingBars />
              Add ready songs from the left. They play in this order.
            </li>
          )}
          {items.map((song, i) => {
            const pad = livePad(song, items[i + 1]);
            const way = wayIn(set, song, items[i + 1]);
            const gap = gapKey(song, items[i + 1]);
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
                  className={`flex items-start gap-4 rounded-2xl border border-line bg-panel px-4 py-3.5 ${dragging === i ? 'opacity-50' : ''}`}
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
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-accent font-bold text-amber shadow-glow-sm">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <p className="text-lg font-bold tracking-tight">{song.title}</p>
                      <p className="tabular text-sm text-muted">
                        {bpm ? `${bpm} BPM` : '—'} · {keysText(songKeys(song))}
                      </p>
                    </div>
                    <p className="mt-0.5 text-muted">
                      Plan: <span className="tabular font-medium text-ink">{planText(song) || '—'}</span>
                    </p>
                  </div>
                  <button type="button" className="mt-1 rounded-full p-1 text-faint hover:bg-raised hover:text-danger" aria-label={`Remove ${song.title} from the set`} onClick={() => update({ songIds: set.songIds.filter(songId => songId !== song.id) })}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="ml-[3.9rem] border-l-2 border-dashed border-accent/40 py-2.5 pl-6">
                  <div className="rounded-2xl border border-dashed border-accent/40 bg-accent/[0.06] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="caps text-amber">Live pad</span>
                      <span className="tabular text-lg font-bold">
                        {pad.from} <span className="text-amber">→</span> {pad.to}
                      </span>
                      <span className="text-sm text-muted">{way.picked ? 'your pads' : 'way in'}</span>
                      {way.tonics.map((tonic, k) => (
                        <span
                          key={`${tonic}-${k}`}
                          title={have.has(tonic) ? undefined : 'No pad in this key yet. Perform skips it.'}
                          className={`rounded-full border bg-well px-2 py-0.5 text-xs font-semibold ${have.has(tonic) ? 'border-accent/50 text-amber' : 'border-dashed border-faint text-faint'}`}
                        >
                          {KEY_NAMES[tonic]}
                        </span>
                      ))}
                      <button
                        type="button"
                        aria-expanded={picking === gap}
                        aria-label={`${picking === gap ? 'Done picking' : 'Change'} the pads after ${song.title}`}
                        className="text-sm text-muted underline underline-offset-2 hover:text-ink"
                        onClick={() => setPicking(picking === gap ? null : gap)}
                      >
                        {picking === gap ? 'Done' : 'Change'}
                      </button>
                      {!items[i + 1] && <span className="text-sm text-muted">played live · fade when ready</span>}
                      {!pad.note && (
                        <LinkButton className="ml-auto" onClick={() => go({ page: 'perform', setId: set.id, item: 2 * i + 1 })}>
                          Practice
                        </LinkButton>
                      )}
                    </div>
                    {pad.note && (
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="rounded-full bg-accent-soft px-3 py-1 text-sm text-amber">{pad.note}</span>
                        <LinkButton onClick={() => go({ page: 'perform', setId: set.id, item: 2 * i + 1 })}>Practice</LinkButton>
                      </div>
                    )}
                    {picking === gap && <PadPicker song={song} next={items[i + 1]} way={way} have={have} onPick={tonics => pickPads(gap, tonics)} />}
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

/** Pick the pads for one gap. Each tap adds a pad to the end; the first comes in as the song ends. */
function PadPicker(props: { song: Song; next: Song | undefined; way: { tonics: number[]; picked: boolean }; have: Set<number>; onPick: (tonics: number[] | null) => void }) {
  const { way, have, onPick } = props;
  const from = keyOf(songKeys(props.song)?.end) ?? { tonic: 0, minor: false };
  const to = props.next ? keyOf(songKeys(props.next)?.start) : null;
  const groups = padGroups(from, to);
  return (
    <div className="mt-3 border-t border-accent/20 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Plays</span>
        {way.tonics.map((tonic, k) => (
          <span key={`${tonic}-${k}`} className="inline-flex items-center gap-1 rounded-full border border-accent/60 bg-well py-0.5 pl-2.5 pr-1 text-sm font-semibold text-amber">
            {KEY_NAMES[tonic]}
            {way.tonics.length > 1 && (
              <button type="button" className="rounded-full p-0.5 text-faint hover:bg-raised hover:text-ink" aria-label={`Take out pad ${k + 1}, ${KEY_NAMES[tonic]}`} onClick={() => onPick(way.tonics.filter((_, j) => j !== k))}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        ))}
        {way.picked && (
          <LinkButton className="ml-auto text-sm" onClick={() => onPick(null)}>
            Use the suggested way in
          </LinkButton>
        )}
      </div>
      <p className="mt-3 text-sm text-muted">Tap a pad to add it to the end. The first one comes in as the song ends.</p>
      <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
        {[...groups.both, ...groups.from, ...groups.to, ...groups.other].map(tonic => (
          <button
            key={tonic}
            type="button"
            disabled={!have.has(tonic)}
            aria-label={`Add pad ${KEY_NAMES[tonic]}, ${padFit(tonic, from, to)}`}
            className="rounded-xl border border-line bg-panel px-3 py-2 text-left hover:border-accent/60 disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-50"
            onClick={() => onPick([...way.tonics, tonic])}
          >
            <span className="block text-lg font-bold">{KEY_NAMES[tonic]}</span>
            <span className="block text-xs text-muted">{have.has(tonic) ? padFit(tonic, from, to) : 'no pad yet'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
