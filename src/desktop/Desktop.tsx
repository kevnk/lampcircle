import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { FEEDBACK_MAX, desktop, type UpdateCheck } from '../platform';
import { captureException, configureCrashReporting } from '../lib/crashReporting';
import { hrefOf, parseRoute } from '../store';
import { Button } from '../ui';

/**
 * The Mac app's own chrome, from the TF Mac app template: the menu's Feedback, Keyboard Shortcuts and
 * Check for Updates, crash-report opt-in, and reopening the last page. Only mounted inside Tauri.
 */
export function Desktop() {
  const [dialog, setDialog] = useState<'feedback' | 'shortcuts' | null>(null);
  const [updateCheck, setUpdateCheck] = useState(0);

  useEffect(() => {
    const stopSettings = desktop.onSettingsChanged(settings => configureCrashReporting(settings.crashReportingEnabled));
    void desktop
      .getSettings()
      .then(async settings => {
        configureCrashReporting(settings.crashReportingEnabled);
        if (settings.openAtLaunch !== 'last-session' || window.location.hash) return;
        const last = await desktop.getLastSession();
        if (last?.activePath && !window.location.hash) window.location.hash = last.activePath;
      })
      .catch(error => captureException(error, { mechanism: 'launch.restore' }));

    // Remember the page, so the next launch can reopen it. Perform reopens as its set, so a launch never starts the music.
    const remember = () => {
      const route = parseRoute(window.location.hash);
      const page = hrefOf(route.page === 'perform' ? { page: 'sets', id: route.setId } : route);
      void desktop.saveLastSession({ version: 1, paths: [page], activePath: page, savedAtMs: 0 }).catch(() => undefined);
    };
    window.addEventListener('hashchange', remember);
    const stopCommands = desktop.onCommand(command => {
      if (command === 'feedback' || command === 'shortcuts') setDialog(command);
      if (command === 'check-update') setUpdateCheck(count => count + 1);
    });
    return () => {
      stopSettings();
      stopCommands();
      window.removeEventListener('hashchange', remember);
    };
  }, []);

  return (
    <>
      {updateCheck > 0 && (
        <div className="fixed bottom-5 right-5 z-40 w-[min(26rem,calc(100vw-2.5rem))] rounded-2xl border border-edge bg-panel p-4 shadow-2xl shadow-navy/15 dark:shadow-black/60">
          <UpdateBar key={updateCheck} onDone={() => setUpdateCheck(0)} />
        </div>
      )}
      {dialog === 'feedback' && <FeedbackDialog onClose={() => setDialog(null)} />}
      {dialog === 'shortcuts' && <ShortcutsHelp onClose={() => setDialog(null)} />}
    </>
  );
}

/** A window-centered sheet. Escape or a click outside closes it. The page behind is inert until it does. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const page = document.getElementById('root');
    page?.setAttribute('inert', '');
    return () => {
      page?.removeAttribute('inert');
      opener?.focus();
    };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/40 p-5" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-[min(34rem,100%)] overflow-y-auto rounded-2xl border border-edge bg-panel p-6 shadow-2xl shadow-navy/15 dark:shadow-black/60"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button type="button" className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const field = 'w-full rounded-2xl border border-faint bg-well px-4 py-3';

/** The note alone, to the feedback relay, which files a public GitHub issue. The app never holds a token. */
function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy || !message.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      await desktop.sendFeedback(message);
      setStatus('Sent. Thank you.');
      setMessage('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Send feedback" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          void send();
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && event.metaKey) void send();
        }}
      >
        <p className="text-muted">A bug, an idea, anything at all.</p>
        <textarea rows={5} maxLength={FEEDBACK_MAX} placeholder="What happened?" aria-label="Your note" className={field} value={message} onChange={event => setMessage(event.target.value)} autoFocus />
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-muted">⌘↩ sends</span>
          <Button tone="primary" type="submit" disabled={busy || !message.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {status && (
          <p className="text-sm" role="status">
            {status}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
  [
    'Map Song',
    [
      ['Space', 'Tap a beat'],
      ['⇧ Space', 'Tap beat 1'],
      ['1 – 8', 'Mark a section at the nearest bar'],
      ['⌫', 'Undo'],
      ['P or ↩', 'Play or pause'],
      ['V, C', 'Select or Cut tool'],
      ['← →', 'Back or ahead a bar'],
      ['↑ ↓', 'Back or ahead a section'],
      ['0', 'Back to the start'],
    ],
  ],
  [
    'Perform',
    [
      ['Space', 'Start, pause or resume, or end the set on the last pad'],
      ['1 – 9', 'Queue a section'],
      ['H', 'Hold the section'],
      ['Esc', 'Cancel the queued section'],
      ['↩', 'Bring in the next song from the pad'],
      ['← →', 'Look at the song before or after'],
    ],
  ],
  [
    'App',
    [
      ['⌘ ,', 'Settings'],
      ['⌘ /', 'Keyboard shortcuts'],
      ['⌘ ⇧ F', 'Send feedback'],
      ['⌘ W', 'Hide the window. The music keeps playing.'],
    ],
  ],
];

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="space-y-5">
        {SHORTCUTS.map(([group, rows]) => (
          <section key={group}>
            <h3 className="caps mb-2 text-muted">{group}</h3>
            <table className="w-full text-sm">
              <tbody>
                {rows.map(([keys, action]) => (
                  <tr key={keys} className="border-t border-line">
                    <td className="w-28 py-2 pr-4">
                      <kbd className="rounded-md border border-edge bg-well px-2 py-0.5 font-sans font-semibold">{keys}</kbd>
                    </td>
                    <td className="py-2">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

type UpdatePhase = 'checking' | 'idle' | 'downloading' | 'installing' | 'error';

/** Checks once when shown, then offers to install and relaunch. Updates arrive only in a signed release build. */
export function UpdateBar({ onDone }: { onDone?: () => void }) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('checking');
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    setPhase('checking');
    setNote(null);
    try {
      const result = await desktop.checkForUpdate();
      setCheck(result);
      setPhase('idle');
      if (!result.supported) setNote('Updates arrive only in a release build, not a debug one.');
      else if (!result.update) setNote(`You have the latest version, ${result.current}.`);
    } catch (error) {
      setPhase('error');
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void run();
  }, []);

  const install = async () => {
    setPhase('downloading');
    setNote(null);
    try {
      await desktop.installUpdate(progress => {
        if (progress.type === 'progress') setNote(progress.total ? `${Math.round((100 * progress.downloaded) / progress.total)}%` : null);
        else if (progress.type === 'downloaded') setPhase('installing');
      });
      await desktop.relaunch();
    } catch (error) {
      setPhase('error');
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const offer = check?.update;
  const busy = phase === 'downloading' || phase === 'installing';
  return (
    <div className="flex items-center gap-3" role="status">
      <p className="min-w-0 flex-1 text-sm">
        {phase === 'checking' ? 'Checking for updates…' : phase === 'downloading' ? 'Downloading the update…' : phase === 'installing' ? 'Installing…' : offer ? `Version ${offer.version} is ready.` : null}{' '}
        {offer?.notes && phase === 'idle' && <span className="text-muted">{offer.notes} </span>}
        {note && <span className={phase === 'error' ? 'text-danger' : 'text-muted'}>{note}</span>}
      </p>
      {offer && !busy && (
        <Button tone="primary" className="shrink-0 px-4 py-1.5 text-sm" onClick={() => void install()}>
          Update and relaunch
        </Button>
      )}
      {!offer && phase === 'error' && (
        <Button className="shrink-0 px-4 py-1.5 text-sm" onClick={() => void run()}>
          Try again
        </Button>
      )}
      {onDone && !busy && (
        <button type="button" className="shrink-0 rounded-full p-1.5 text-muted hover:bg-raised hover:text-ink" aria-label="Close" onClick={onDone}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
