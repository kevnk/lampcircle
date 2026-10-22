import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, desktop, type Settings } from '../platform';
import { configureCrashReporting, crashReportingConfigured } from '../lib/crashReporting';
import { Button, ThemeSwitch } from '../ui';
import { UpdateBar } from './Desktop';

/** The Settings window (⌘,), from the TF Mac app template. It is index.html?window=settings in its own webview. */
export function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const latest = useRef(settings);
  const [error, setError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [checking, setChecking] = useState(0);
  /** Nothing saves until the stored settings are in, or a click would write the defaults over them. */
  const [loaded, setLoaded] = useState(false);

  const apply = (next: Settings) => {
    latest.current = next;
    setSettings(next);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([desktop.getSettings(), desktop.getOpenAtLogin().catch(() => undefined)]).then(
      ([stored, loginItem]) => {
        if (!active) return;
        // The login item itself is the truth: it can change in System Settings.
        apply({ ...stored, openAtLogin: loginItem ?? stored.openAtLogin });
        setLoaded(true);
        configureCrashReporting(stored.crashReportingEnabled);
      },
      cause => active && setError(message(cause)),
    );
    const stop = desktop.onSettingsChanged(next => active && apply(next));
    return () => {
      active = false;
      stop();
    };
  }, []);

  const save = async (patch: Partial<Settings>) => {
    const previous = latest.current;
    const next = { ...previous, ...patch };
    apply(next);
    setError(null);
    try {
      await desktop.saveSettings(next);
      if (patch.crashReportingEnabled !== undefined) configureCrashReporting(patch.crashReportingEnabled);
    } catch (cause) {
      if (latest.current === next) apply(previous);
      setError(message(cause));
    }
  };

  const saveOpenAtLogin = async (enabled: boolean) => {
    const previous = latest.current;
    apply({ ...previous, openAtLogin: enabled });
    setLoginBusy(true);
    setError(null);
    try {
      const actual = await desktop.setOpenAtLogin(enabled);
      await save({ openAtLogin: actual });
    } catch (cause) {
      const actual = await desktop.getOpenAtLogin().catch(() => previous.openAtLogin);
      apply({ ...latest.current, openAtLogin: actual });
      setError(message(cause));
    } finally {
      setLoginBusy(false);
    }
  };

  const exportDiagnostics = async () => {
    setDiagnostics('Exporting…');
    setError(null);
    try {
      const result = await desktop.exportDiagnostics();
      setDiagnostics(result ? `Saved ${result.logFiles} log file${result.logFiles === 1 ? '' : 's'} to ${result.path}.` : null);
    } catch (cause) {
      setDiagnostics(null);
      setError(message(cause));
    }
  };

  return (
    <div className="min-h-full bg-page">
      {/* The window's title bar: the traffic lights sit over its left end, and it drags the window. */}
      <div data-tauri-drag-region className="sticky top-0 z-10 flex h-12 items-center justify-center bg-page font-semibold">
        <span data-tauri-drag-region>Settings</span>
      </div>
      <fieldset disabled={!loaded} className="space-y-6 px-6 pb-8 pt-2">
        <Group title="General">
          <Row label="Appearance">
            <div className="w-56">
              <ThemeSwitch />
            </div>
          </Row>
          <Row label="When Lampcircle opens">
            <select
              className="rounded-full border border-edge bg-panel px-3 py-1.5"
              value={settings.openAtLaunch}
              onChange={event => void save({ openAtLaunch: event.target.value as Settings['openAtLaunch'] })}
            >
              <option value="last-session">Reopen the last page</option>
              <option value="nothing">Start at the Library</option>
            </select>
          </Row>
          <Check checked={settings.openAtLogin} disabled={loginBusy} onChange={value => void saveOpenAtLogin(value)}>
            Open at login
          </Check>
        </Group>

        <Group title="Privacy">
          <Check checked={settings.analyticsEnabled} onChange={value => void save({ analyticsEnabled: value })}>
            Share anonymous usage counts
            <Hint>Opens, update checks and feedback sent, through Aptabase. Never your songs or sets.</Hint>
          </Check>
          <Check checked={settings.crashReportingEnabled} onChange={value => void save({ crashReportingEnabled: value })}>
            Send crash reports
            <Hint>{crashReportingConfigured() ? 'Off until you turn it on.' : 'This build has nowhere to send them, so nothing is sent yet.'}</Hint>
          </Check>
        </Group>

        <Group title="Updates">
          {checking ? <UpdateBar key={checking} /> : <Button onClick={() => setChecking(1)}>Check for updates</Button>}
        </Group>

        <Group title="Support">
          <p className="text-sm text-muted">
            Saves a ZIP of the app's logs and these settings, with secrets and personal paths taken out. Nothing is uploaded. Look it over before you attach it to feedback.
          </p>
          <Button onClick={() => void exportDiagnostics()} disabled={diagnostics === 'Exporting…'}>
            Export diagnostics…
          </Button>
          {diagnostics && (
            <p className="text-sm text-muted" role="status">
              {diagnostics}
            </p>
          )}
        </Group>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="caps text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span className="flex flex-col">{children}</span>
    </label>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <span className="text-sm text-muted">{children}</span>;

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
