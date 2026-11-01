import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getVersion } from '@tauri-apps/api/app';
import { FeedbackForm, useModal } from '../desktop/Desktop';
import { addedText, libraryFileName, packLibrary } from '../lib/backup';
import { getAudio } from '../lib/db';
import { mobile } from '../platform';
import { Group, Hint, Privacy, Row, WhenItOpens, errorText, useSettings } from '../settings';
import { useStore } from '../store';
import { Button, ThemeSwitch } from '../ui';

/**
 * The iPhone and iPad's Settings, in place of the Mac's window and app menu. Check for Updates, Keyboard Shortcuts
 * and Open at Login stay on the Mac. So does Export Diagnostics: its save needs staging first, as save_text does.
 */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { settings, loaded, error, save } = useSettings();
  const [version, setVersion] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  /** A backup or restore is running, and closing the sheet would hide how it ends. */
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (!busy) onClose();
  };
  useModal(close);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheet.current?.focus();
    getVersion().then(setVersion, () => undefined);
  }, []);

  return createPortal(
    <div ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Settings" className="fixed inset-0 z-40 flex flex-col bg-page outline-none">
      <header className="flex shrink-0 items-center justify-between border-b border-line pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)]">
        <h1 className="text-lg font-semibold">Settings</h1>
        <button type="button" className="rounded-full px-3 font-semibold text-amber disabled:text-faint" disabled={busy} onClick={close}>
          Done
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(2rem_+_env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-5">
        <div className="mx-auto max-w-lg space-y-8">
          <fieldset disabled={!loaded} className="space-y-8">
            <Group title="General">
              <Row label="Appearance">
                {/* The switch hides its words on a narrow screen. Here there is room for them. */}
                <div className="w-56 [&_span]:not-sr-only">
                  <ThemeSwitch />
                </div>
              </Row>
              <WhenItOpens settings={settings} save={save} />
              {/* `switch` makes this iOS's own toggle from iOS 17.4. Before that it's a checkbox. */}
              <label className="flex min-h-11 items-center justify-between gap-4">
                <span className="flex flex-col">
                  Haptics
                  <Hint>A light tick in Perform when a section you queued comes in, and when you queue or cancel one.</Hint>
                </span>
                <input type="checkbox" role="switch" {...{ switch: '' }} className="shrink-0" checked={settings.hapticsEnabled} onChange={event => void save({ hapticsEnabled: event.target.checked })} />
              </label>
            </Group>
            <Privacy settings={settings} save={save} />
          </fieldset>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}

          <Backup busy={busy} setBusy={setBusy} />

          <Group title="Feedback">
            {writing ? (
              <FeedbackForm />
            ) : (
              <Button className="w-full" onClick={() => setWriting(true)}>
                Send feedback
              </Button>
            )}
          </Group>

          <Group title="About">
            <Row label="Lamp Circle">
              <span className="tabular text-muted">{version && `Version ${version}`}</span>
            </Row>
            <Hint>Updates come through TestFlight or the App Store.</Hint>
          </Group>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Backup({ busy, setBusy }: { busy: boolean; setBusy: (busy: boolean) => void }) {
  const store = useStore();
  const { songs, pads, sets } = store;
  const [note, setNote] = useState<string | null>(null);

  /** The screen stays on, since a phone that locks would pause the work part way. */
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    void mobile.setKeepAwake(true);
    try {
      setNote(await work());
    } catch (cause) {
      setNote(errorText(cause));
    } finally {
      void mobile.setKeepAwake(false);
      setBusy(false);
    }
  };

  const backUp = () =>
    run(async () => {
      setNote('Preparing your backup…');
      const audio: Array<[string, Blob]> = [];
      for (const { id } of [...songs, ...pads]) {
        const blob = await getAudio(id);
        if (blob) audio.push([id, blob]);
      }
      const name = libraryFileName();
      const saved = await mobile.saveBackup(packLibrary({ songs, pads, sets, audio }), name, part =>
        setNote(part < 1 ? `Preparing your backup… ${Math.floor(part * 100)}%` : 'Choose where to save it.'),
      );
      return saved ? `Saved ${name}.` : 'Backup cancelled. Nothing was saved.';
    });

  const restore = (file: File) =>
    run(async () => {
      setNote('Restoring your library…');
      return addedText(await store.importLibrary(file));
    });

  return (
    <Group title="Your library">
      <p className="text-sm text-muted">Your songs and recordings are only on this device. A backup puts them all in one file you can save to Files or iCloud Drive.</p>
      <div className="grid gap-3">
        <Button tone="primary" disabled={busy || (!songs.length && !pads.length && !sets.length)} onClick={() => void backUp()}>
          Back up library
        </Button>
        {/* A label, so the tap itself opens the picker: iOS can ignore a script's click on a hidden file input. */}
        <label className={`inline-flex min-h-11 items-center justify-center rounded-full border border-edge bg-panel px-5 py-2.5 font-medium ${busy ? 'pointer-events-none text-faint' : 'text-ink'}`}>
          Restore from a backup
          <input
            type="file"
            // Every file stays selectable, since nothing on iOS declares .lampcircle. unpackLibrary turns away the wrong one.
            accept="application/octet-stream"
            className="sr-only"
            disabled={busy}
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void restore(file);
              event.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="text-sm text-muted">Restoring adds what is missing. It never changes or removes what is already here.</p>
      {note && (
        <p className="text-sm" role="status">
          {note}
        </p>
      )}
    </Group>
  );
}
