import { useState } from 'react';
import { CheckCircle2, ChevronDown, CircleAlert } from 'lucide-react';
import type { Song } from '../types';
import { go, useStore } from '../store';
import { Button, Card, LinkButton, SongHeader, StepPills } from '../ui';
import { serializeDjw } from '../lib/djw';
import { download, fileNameFor } from '../lib/library';
import { bpmOf, checks, keysText, songGrid, songKeys } from '../lib/songMap';
import { doneSteps, stepNav } from './SongTap';

type DirectoryPicker = () => Promise<FileSystemDirectoryHandle>;

export function Export({ song }: { song: Song }) {
  const store = useStore();
  const list = checks(song);
  const passing = list.filter(check => check.ok).length;
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState(fileNameFor(song.title));
  const [includePath, setIncludePath] = useState(false);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  const bpm = bpmOf(songGrid(song));
  const meta = [song.artist || 'Unknown artist', bpm ? `${Math.round(bpm)} BPM` : null, keysText(songKeys(song))].filter(Boolean).join(' · ');

  const save = async () => {
    setError(null);
    const name = fileName.endsWith('.djw') ? fileName : `${fileName}.djw`;
    const text = serializeDjw(song, { includeAudioPath: includePath });
    try {
      if (folder) {
        const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
        await writable.write(text);
        await writable.close();
      } else {
        download(text, name);
      }
    } catch (problem) {
      return setError(problem instanceof Error ? problem.message : 'Could not save the file.');
    }
    const stamp = Date.now();
    store.saveSong({ ...song, refined: true, exportedAt: stamp, updatedAt: stamp }, { touch: false });
    go({ page: 'sets', id: store.addToSet(song.id).id });
  };

  return (
    <div>
      <SongHeader song={song} meta={meta}>
        <StepPills current={['export']} done={doneSteps(song)} onStep={stepNav(song)} />
      </SongHeader>
      <Card className="p-5">
        <p className="flex items-center gap-2.5 text-[17px] font-medium" role="status">
          {passing === list.length ? <CheckCircle2 className="h-5 w-5 text-amber" aria-hidden /> : <CircleAlert className="h-5 w-5 text-danger" aria-hidden />}
          {passing === list.length ? `Ready: all ${list.length} checks pass` : `${passing} of ${list.length} checks pass`}
        </p>
        {passing < list.length && (
          <ul className="mt-3 space-y-1.5 pl-8 text-sm">
            {list.map(check => (
              <li key={check.id} className={check.ok ? 'text-muted' : ''}>
                <span className={check.ok ? 'text-amber' : 'text-danger'}>{check.ok ? '✓' : '✗'}</span> {check.text}
                {!check.ok && (
                  <LinkButton className="ml-2 text-sm" onClick={() => stepNav(song)(check.fix === 'set' || check.fix === 'done' ? 'export' : check.fix)}>
                    Fix
                  </LinkButton>
                )}
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="mt-6 inline-flex items-center gap-1.5 rounded-full text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
          Change name or folder…
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {open && (
          <div className="mt-3 grid max-w-xl gap-3 rounded-xl border border-line bg-well p-4 sm:grid-cols-2">
            <label className="text-sm">
              Song name
              <input className="mt-1 w-full rounded-full border border-faint bg-well px-4 py-2" value={song.title} onChange={event => store.saveSong({ ...song, title: event.target.value })} />
            </label>
            <label className="text-sm">
              Artist
              <input className="mt-1 w-full rounded-full border border-faint bg-well px-4 py-2" value={song.artist} onChange={event => store.saveSong({ ...song, artist: event.target.value })} />
            </label>
            <label className="text-sm">
              File name
              <input name="fileName" className="mt-1 w-full rounded-full border border-faint bg-well px-4 py-2" value={fileName} onChange={event => setFileName(event.target.value)} />
            </label>
            <div className="text-sm">
              Folder
              <p className="mt-1 flex items-center gap-3 py-2">
                <span className="font-medium">{folder?.name ?? 'Downloads'}</span>
                {picker && (
                  <LinkButton
                    className="text-sm"
                    onClick={() =>
                      void picker.call(window).then(setFolder, () => {
                        // Closing the picker keeps the current folder.
                      })
                    }
                  >
                    Choose folder…
                  </LinkButton>
                )}
              </p>
            </div>
          </div>
        )}

        <p className="caps mt-6 text-muted">Include</p>
        <label className="mt-2 flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={includePath} disabled={!song.audioFile} onChange={event => setIncludePath(event.target.checked)} />
          <span>
            Path to my local audio file
            <span className="block text-sm text-muted">
              {song.audioFile ? 'Leave off when sharing with another worship leader.' : 'This song has no saved file path.'}
            </span>
          </span>
        </label>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end">
          <Button tone="primary" disabled={passing < list.length} onClick={() => void save()}>
            Save &amp; add to set
          </Button>
        </div>
      </Card>
    </div>
  );
}
