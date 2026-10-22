/**
 * Opt-in crash reports from the Mac app's webview, from the TF Mac app template.
 *
 * Sentry starts only when the person has turned reports on in Settings and the build has a VITE_CRASH_DSN.
 * The web app never turns it on.
 */

type Sentry = typeof import('@sentry/browser');

export type CrashContext = Record<string, unknown>;

const DSN = import.meta.env.VITE_CRASH_DSN?.trim() ?? '';

let reportingEnabled = false;
/** Loaded on first opt-in, so builds without a DSN never fetch Sentry. */
let sentry: Sentry | null = null;
let loading = false;
let hooksInstalled = false;

export const crashReportingConfigured = (): boolean => DSN.length > 0;

export function configureCrashReporting(enabled: boolean): void {
  reportingEnabled = enabled;
  if (!enabled) return;
  installCrashHooks();
  if (!crashReportingConfigured() || loading) return;
  loading = true;
  void import('@sentry/browser').then(start, () => (loading = false));
}

function start(Sentry: Sentry): void {
  Sentry.init({
    dsn: DSN,
    sendClientReports: false,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    // Integrations add to Sentry's defaults, so the defaults are turned off here, or sessions, breadcrumbs and global handlers stay on.
    defaultIntegrations: false,
    integrations: [Sentry.dedupeIntegration()],
    beforeSend(event) {
      if (!reportingEnabled) return null;
      delete event.user;
      delete event.request;
      return event;
    },
  });
  sentry = Sentry;
}

export function captureException(error: unknown, context?: CrashContext): void {
  const Sentry = sentry;
  if (!reportingEnabled || !Sentry) return;
  try {
    Sentry.withScope(scope => {
      if (context) scope.setContext('lampcircle', context);
      Sentry.captureException(asError(error));
    });
  } catch {
    // Reporting must never become an app failure.
  }
}

/** One set of handlers per webview, even under React Strict Mode. */
function installCrashHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  window.addEventListener('error', event => captureException(event.error ?? new Error(event.message || 'Unhandled window error'), { mechanism: 'window.error' }));
  window.addEventListener('unhandledrejection', event => captureException(event.reason, { mechanism: 'window.unhandledrejection' }));
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  return new Error('Unhandled non-Error rejection');
}
