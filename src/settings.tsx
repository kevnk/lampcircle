import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, desktop, isIOS, type Settings } from './platform';
import { configureCrashReporting, crashReportingConfigured } from './lib/crashReporting';

/** The stored settings, shared by the Mac's Settings window and the iPhone's Settings sheet. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const latest = useRef(settings);
  const [error, setError] = useState<string | null>(null);
  /** Nothing saves until the stored settings are in, or a tap would write the defaults over them. */
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
      cause => active && setError(errorText(cause)),
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
      setError(errorText(cause));
    }
  };

  return { settings, latest, loaded, error, setError, apply, save };
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="caps text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3 ios:min-h-11 ios:py-1">
      <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--accent))] ios:h-5 ios:w-5 ios:shrink-0" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span className="flex flex-col">{children}</span>
    </label>
  );
}

export const Hint = ({ children }: { children: ReactNode }) => <span className="text-sm text-muted">{children}</span>;

export function WhenItOpens({ settings, save }: Pick<ReturnType<typeof useSettings>, 'settings' | 'save'>) {
  return (
    <Row label="When Lamp Circle opens">
      <select
        className="rounded-full border border-edge bg-panel px-3 py-1.5 ios:shrink-0"
        value={settings.openAtLaunch}
        onChange={event => void save({ openAtLaunch: event.target.value as Settings['openAtLaunch'] })}
      >
        <option value="last-session">Reopen the last page</option>
        <option value="nothing">Start at the Library</option>
      </select>
    </Row>
  );
}

export function Privacy({ settings, save }: Pick<ReturnType<typeof useSettings>, 'settings' | 'save'>) {
  return (
    <Group title="Privacy">
      <Check checked={settings.analyticsEnabled} onChange={value => void save({ analyticsEnabled: value })}>
        Share anonymous usage counts
        <Hint>{isIOS() ? 'Opens and feedback sent' : 'Opens, update checks and feedback sent'}, through Aptabase. Never your songs or sets.</Hint>
      </Check>
      <Check checked={settings.crashReportingEnabled} onChange={value => void save({ crashReportingEnabled: value })}>
        Send crash reports
        <Hint>{crashReportingConfigured() ? 'Off until you turn it on.' : 'This build has nowhere to send them, so nothing is sent yet.'}</Hint>
      </Check>
    </Group>
  );
}

export const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
