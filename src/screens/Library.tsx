import { useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import type { Song } from '../types';
import { go, useStore } from '../store';
import { Button, Card, Label, LinkButton, Menu, MenuItem, MiniStrip, RestingBars } from '../ui';
import { PAD_ALBUM, helper, importPad, importSong, jobKind, queueLink, splitTitle, type Job } from '../lib/library';
import { parseDjw, type DjwMap } from '../lib/djw';
import { KEY_NAMES } from '../lib/music';
import { STEP_LABEL, bpmOf, clock, keysText, nextStep, sectionViews, songGrid, songKeys, type Step } from '../lib/songMap';
import { transport } from '../audio/engine';
import { getAudio } from '../lib/db';
import { libraryFileName, packLibrary } from '../lib/backup';
import { isTauri } from '../platform';
import { download } from '../platform/browser';

export function Library() {
  const store = useStore();
  const { songs, pads, sets } = store;
  const [tab, setTab] = useState<'songs' | 'pads'>('songs');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<DjwMap | null>(null);
  const djwInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const shown = useMemo(() => {
    const words = query.toLowerCase().trim();
    return songs.filter(song => !words || `${song.title} ${song.artist}`.toLowerCase().includes(words));
  }, [songs, query]);
  const selected = songs.find(song => song.id === selectedId) ?? shown[0] ?? null;
  const setOf = (id: string) => sets.find(set => set.songIds.includes(id));

  const openStep = (song: Song, step: Step) => {
    if (step === 'set') return go({ page: 'sets', id: store.addToSet(song.id).id });
    if (step === 'done') return go({ page: 'sets', id: setOf(song.id)?.id });
    go({ page: 'song', id: song.id, step: step === 'sections' ? 'tap' : step });
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        if (/\.(djw|ya?ml)$/i.test(file.name)) {
          await openDjw(file);
        } else if (waiting) {
          const song = await importSong(file, { title: waiting.title, artist: waiting.artist, audioFile: file.name }, waiting);
          store.addSong(song);
          setWaiting(null);
          setSelectedId(song.id);
          setNotice(`${song.title} is in your library with its map.`);
        } else if (tab === 'pads') {
          store.addPad(await importPad(file, { title: file.name.replace(/\.\w+$/, '') }));
        } else {
          const song = await importSong(file, { ...splitTitle(file.name), audioFile: file.name });
          store.addSong(song);
          setSelectedId(song.id);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
  };

  const openDjw = async (file: File) => {
    const map = parseDjw(await file.text());
    if (map.source) {
      await helper.add(map.source, 'song', map);
      store.refreshJobs();
      setNotice(`Downloading the audio for ${map.title}.`);
      return;
    }
    const name = map.audioFile?.split(/[\\/]/).pop();
    const blob = name ? await helper.file(name).catch(() => null) : null;
    if (blob) {
      const song = await importSong(blob, { title: map.title, artist: map.artist, audioFile: map.audioFile }, map);
      store.addSong(song);
      setSelectedId(song.id);
      return;
    }
    setWaiting(map);
  };

  // ponytail: no export in the Mac app yet. Its save_text takes a string, and a library is hundreds of MB.
  const exportLibrary = async () => {
    const audio: Array<[string, Blob]> = [];
    for (const { id } of [...songs, ...pads]) {
      const blob = await getAudio(id);
      if (blob) audio.push([id, blob]);
    }
    download(packLibrary({ songs, pads, sets, audio }), libraryFileName());
  };

  const importLibrary = async (file: File) => {
    setImporting(true);
    setNotice('Importing your library…');
    try {
      const added = await store.importLibrary(file);
      const counts = ([[added.songs, 'song'], [added.pads, 'pad'], [added.sets, 'set'], [added.audio, 'recording']] as const)
        .filter(([count]) => count > 0)
        .map(([count, word]) => `${count} ${word}${count === 1 ? '' : 's'}`);
      const list = counts.length > 1 ? `${counts.slice(0, -1).join(', ')} and ${counts[counts.length - 1]}` : counts[0];
      setNotice(list ? `Added ${list}.` : 'Nothing new to add. Everything in that file is already in your library.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Could not read ${file.name}.`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-4xl font-extrabold tracking-tight">Library</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => djwInput.current?.click()}>Import .djw</Button>
          <Button onClick={() => go({ page: 'sets', id: store.newSet().id })}>New set</Button>
          <Menu label="More">
            {!isTauri() && (
              <MenuItem onClick={() => void exportLibrary()} disabled={!songs.length && !pads.length && !sets.length}>
                Export library
              </MenuItem>
            )}
            <MenuItem onClick={() => libraryInput.current?.click()} disabled={importing}>
              Import library
            </MenuItem>
          </Menu>
        </div>
        <input
          ref={djwInput}
          type="file"
          accept=".djw,.yaml,.yml"
          className="hidden"
          aria-label="Import a .djw map"
          onChange={event => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <input
          ref={libraryInput}
          type="file"
          accept=".lampcircle"
          className="hidden"
          aria-label="Import a library"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void importLibrary(file);
            event.target.value = '';
          }}
        />
      </header>

      {notice && (
        <p role="status" className="mb-4 flex items-center justify-between rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          {notice}
          <button type="button" className="text-muted hover:text-ink" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}
      {waiting && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p>
            The map for <b>{waiting.title}</b> is ready. Choose the recording that goes with it.
          </p>
          <div className="flex gap-2">
            <Button tone="primary" onClick={() => audioInput.current?.click()}>
              Choose audio
            </Button>
            <Button tone="quiet" onClick={() => setWaiting(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <AddFromYouTube tab={tab} onFile={() => audioInput.current?.click()} onDropFiles={files => void addFiles(files)} />
      <input
        ref={audioInput}
        type="file"
        accept="audio/*"
        className="hidden"
        aria-label="Add an audio file"
        onChange={event => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <div className="mt-6 flex flex-col items-start gap-6 lg:flex-row">
        <Card className="w-full min-w-0 flex-1">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 pt-3">
            <div className="flex gap-2" role="tablist">
              {(
                [
                  ['songs', `Songs · ${songs.length}`],
                  ['pads', `Pads · ${new Set(pads.map(pad => pad.tonic)).size} keys`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`border-b-2 px-3.5 pb-3 pt-2 text-[17px] ${tab === id ? 'border-accent font-semibold' : 'border-transparent text-muted hover:text-ink'}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'songs' && (
              <label className="mb-2.5 flex items-center gap-3 text-muted">
                Search songs
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  className="w-52 rounded-full border border-faint bg-well px-4 py-2 text-ink"
                />
              </label>
            )}
          </div>
          {tab === 'songs' ? (
            <SongTable songs={shown} selected={selected} onSelect={setSelectedId} onStep={openStep} inSet={id => Boolean(setOf(id))} />
          ) : (
            <PadTable />
          )}
        </Card>
        {tab === 'songs' && selected && (
          <Card className="w-full p-5 lg:w-[312px]">
            <h2 className="mb-4 text-2xl font-extrabold tracking-tight">{selected.title}</h2>
            <Label className="mb-2">Sections</Label>
            <MiniStrip views={sectionViews(selected)} />
            <Button className="mt-5 w-full" onClick={() => go({ page: 'song', id: selected.id, step: 'tap' })}>
              Open in Map Song
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}

function AddFromYouTube({ tab, onFile, onDropFiles }: { tab: 'songs' | 'pads'; onFile: () => void; onDropFiles: (files: FileList) => void }) {
  const { jobs, helperDown, refreshJobs } = useStore();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await queueLink(url.trim(), tab === 'pads' ? 'pad' : undefined);
      setUrl('');
      refreshJobs();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Download failed.');
    } finally {
      setBusy(false);
    }
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (event.dataTransfer.files.length) onDropFiles(event.dataTransfer.files);
  };
  return (
    <Card className={`px-5 py-4 ${over ? 'shadow-glow ring-2 ring-accent' : ''}`}>
      <div
        onDragOver={event => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <label htmlFor="youtube-link" className="mb-2 block text-[17px] font-medium">
          Add from YouTube
        </label>
        <form
          className="flex gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (url.trim()) void submit();
          }}
        >
          <input
            id="youtube-link"
            value={url}
            onChange={event => setUrl(event.target.value)}
            placeholder={tab === 'pads' ? 'Paste a YouTube link to a pad' : 'Paste a YouTube link'}
            className="min-w-0 flex-1 rounded-full border border-faint bg-well px-5 py-3 text-[17px]"
          />
          <Button tone="primary" type="submit" className="px-6 text-[17px]">
            Download
          </Button>
        </form>
        {(error || helperDown) && (
          <p className="mt-2 text-sm text-danger">{error ?? 'The download helper is not running. Start it with npm run dev. You can still add audio files.'}</p>
        )}
        {jobs.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="Downloads">
            {jobs.map(job => (
              <JobRow key={job.id} job={job} onDismiss={() => void helper.remove(job.id).then(refreshJobs)} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted">
          Or{' '}
          <LinkButton className="text-sm" onClick={onFile}>
            add an audio file
          </LinkButton>{' '}
          from this computer. You can also drop it here.
        </p>
      </div>
    </Card>
  );
}

function JobRow({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const status =
    job.status === 'queued'
      ? 'queued'
      : job.status === 'downloading'
        ? `${Math.round(job.percent)}%${job.eta !== null ? ` · ${clock(job.eta)} left` : ''}`
        : job.status === 'converting'
          ? 'converting'
          : job.status === 'done'
            ? 'adding to library'
            : 'failed';
  return (
    <li className="flex items-center gap-4 text-[15px]">
      <span className="w-1/3 min-w-0 truncate">
        {job.title ?? job.url} · {jobKind(job)}
      </span>
      {job.status === 'error' ? (
        <span className="flex flex-1 items-center justify-between gap-3 text-sm text-danger">
          <span className="truncate">{job.error}</span>
          <button type="button" className="text-muted underline" onClick={onDismiss}>
            Dismiss
          </button>
        </span>
      ) : (
        <>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(job.percent)} aria-label={`${job.title ?? 'Download'} progress`}>
            <span className="block h-full rounded-full bg-accent shadow-glow-sm transition-[width]" style={{ width: `${job.percent}%` }} />
          </span>
          <span className="tabular w-32 text-right text-xs text-muted">{status}</span>
        </>
      )}
    </li>
  );
}

function SongTable({ songs, selected, onSelect, onStep, inSet }: { songs: Song[]; selected: Song | null; onSelect: (id: string) => void; onStep: (song: Song, step: Step) => void; inSet: (id: string) => boolean }) {
  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-10 text-center text-muted">
        <RestingBars />
        <p>No songs yet. Paste a YouTube link above or add an audio file.</p>
      </div>
    );
  }
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="caps border-b border-line text-muted">
          <th className="px-4 py-3">Song</th>
          <th className="w-20 py-3">BPM</th>
          <th className="w-24 py-3">Keys</th>
          <th className="w-40 py-3 pr-4">Next step</th>
        </tr>
      </thead>
      <tbody>
        {songs.map(song => {
          const step = nextStep(song, inSet(song.id));
          const bpm = song.taps.length >= 2 ? bpmOf(songGrid(song)) : null;
          return (
            <tr
              key={song.id}
              aria-selected={song.id === selected?.id}
              tabIndex={0}
              className={`cursor-pointer border-b border-line last:border-0 ${song.id === selected?.id ? 'bg-accent-soft shadow-[inset_3px_0_0_rgb(var(--accent))]' : 'hover:bg-raised/60'}`}
              onClick={() => onSelect(song.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(song.id);
                }
              }}
            >
              <td className="px-4 py-3">
                <p className="font-medium">{song.title}</p>
                <p className="text-sm text-muted">{song.artist || 'Unknown artist'}</p>
              </td>
              <td className="tabular">{bpm ? Math.round(bpm) : '—'}</td>
              <td className="tabular">{keysText(songKeys(song))}</td>
              <td className="pr-4">
                <LinkButton
                  onClick={event => {
                    event.stopPropagation();
                    onStep(song, step);
                  }}
                >
                  {STEP_LABEL[step]}
                </LinkButton>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PadTable() {
  const { pads, savePad, removePad, jobs, refreshJobs } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const have = new Set(pads.map(pad => pad.tonic));
  const coming = jobs.filter(job => jobKind(job) === 'pad' && job.status !== 'error').length;
  const missing = KEY_NAMES.map((_, tonic) => tonic).filter(tonic => !have.has(tonic));
  const getMissing = async () => {
    setError(null);
    setAsking(true);
    try {
      await queueLink(PAD_ALBUM.url, 'pad', missing);
      refreshJobs();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not reach YouTube.');
    } finally {
      setAsking(false);
    }
  };
  const [previewId, setPlaying] = useState<string | null>(null);
  const transportPlaying = useSyncExternalStore(transport.subscribe, () => transport.playing);
  const playing = transportPlaying ? previewId : null;
  const preview = async (id: string) => {
    if (playing === id) {
      transport.pause();
      return setPlaying(null);
    }
    await transport.load(id);
    transport.seek(0);
    transport.play();
    setPlaying(id);
  };
  const keys = (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <div className="flex gap-1" aria-label={`Pads in ${pads.length ? [...have].map(tonic => KEY_NAMES[tonic]).join(', ') : 'no keys yet'}`}>
        {KEY_NAMES.map((name, tonic) => (
          <span key={name} className={`w-9 rounded-full py-1 text-center text-xs font-semibold ${have.has(tonic) ? 'bg-accent-soft text-amber ring-1 ring-accent/40' : 'border border-dashed border-faint text-muted'}`}>
            {name}
          </span>
        ))}
      </div>
      {missing.length > 0 && (
        <Button className="ml-auto px-3.5 py-2 text-sm" disabled={coming > 0 || asking} onClick={() => void getMissing()}>
          {asking ? 'Finding the album…' : coming > 0 ? `Downloading ${coming} pad${coming === 1 ? '' : 's'}…` : missing.length === 12 ? 'Get all 12 keys' : `Get the ${missing.length} missing key${missing.length === 1 ? '' : 's'}`}
        </Button>
      )}
      <p className="w-full text-xs text-muted">
        {missing.length > 0 ? `From ${PAD_ALBUM.name} on YouTube. Or paste any pad link above.` : 'Every key has a pad.'}
        {error && <span className="ml-2 text-danger">{error}</span>}
      </p>
    </div>
  );
  if (pads.length === 0) {
    return (
      <>
        {keys}
        <div className="flex flex-col items-center gap-3 px-5 py-10 text-center text-muted">
          <RestingBars />
          <p>No pads yet. Perform plays pads between songs, one per key.</p>
        </div>
      </>
    );
  }
  return (
    <>
    {keys}
    <table className="w-full text-left">
      <thead>
        <tr className="caps border-b border-line text-muted">
          <th className="px-4 py-3">Pad</th>
          <th className="w-24 py-3">Key</th>
          <th className="w-24 py-3">Length</th>
          <th className="w-28 py-3 pr-4">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {pads.map(pad => (
          <tr key={pad.id} className="border-b border-line last:border-0">
            <td className="px-4 py-3 font-medium">{pad.title}</td>
            <td>
              <select
                aria-label={`Key of ${pad.title}`}
                value={pad.tonic}
                onChange={event => savePad({ ...pad, tonic: Number(event.target.value) })}
                className="rounded-full border border-edge bg-well px-3 py-1 font-medium"
              >
                {KEY_NAMES.map((name, tonic) => (
                  <option key={name} value={tonic}>
                    {name}
                  </option>
                ))}
              </select>
            </td>
            <td className="tabular text-sm">{clock(pad.duration)}</td>
            <td className="pr-4">
              <div className="flex justify-end gap-1">
                <button type="button" className="rounded-full p-2 text-amber hover:bg-raised" aria-label={`${playing === pad.id ? 'Stop' : 'Preview'} ${pad.title}`} onClick={() => void preview(pad.id)}>
                  {playing === pad.id ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  className="rounded-full p-2 text-muted hover:bg-raised hover:text-danger"
                  aria-label={`Remove ${pad.title}`}
                  onClick={() => {
                    if (confirm(`Remove ${pad.title}?`)) void removePad(pad.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
