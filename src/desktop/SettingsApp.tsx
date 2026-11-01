import { useState } from 'react';
import { desktop } from '../platform';
import { Check, Group, Hint, Privacy, Row, WhenItOpens, errorText, useSettings } from '../settings';
import { Button, ThemeSwitch } from '../ui';
import { UpdateBar } from './Desktop';

/** The Settings window (⌘,), from the TF Mac app template. It is index.html?window=settings in its own webview. */
export function SettingsApp() {
  const { settings, latest, loaded, error, setError, apply, save } = useSettings();
  const [loginBusy, setLoginBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [checking, setChecking] = useState(0);

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
      setError(errorText(cause));
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
      setError(errorText(cause));
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
          <WhenItOpens settings={settings} save={save} />
          <Check checked={settings.openAtLogin} disabled={loginBusy} onChange={value => void saveOpenAtLogin(value)}>
            Open at login
          </Check>
        </Group>

        <Privacy settings={settings} save={save} />

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
