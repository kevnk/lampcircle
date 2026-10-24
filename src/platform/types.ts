import type { DjwMap } from '../lib/djw';

/** The Mac app's preferences, from the TF Mac app template. The theme stays in theme.ts, where the web app keeps it too. */
export type Settings = {
  /** Aptabase usage events. They only send when the build has an APTABASE_APP_KEY. */
  analyticsEnabled: boolean;
  /** Off until the person turns it on. Sends only when the build has a VITE_CRASH_DSN. */
  crashReportingEnabled: boolean;
  /** Reopen the last page you had open, or start at the Library. */
  openAtLaunch: 'last-session' | 'nothing';
  /** Open at login through the Tauri autostart plugin's macOS LaunchAgent. */
  openAtLogin: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  analyticsEnabled: true,
  crashReportingEnabled: false,
  openAtLaunch: 'last-session',
  openAtLogin: false,
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fills in missing settings, and fails closed when a privacy value is malformed. */
export function normalizeSettings(value: unknown): Settings {
  const stored = isRecord(value) ? value : {};
  const flag = (key: keyof Settings) => (key in stored ? stored[key] === true : (DEFAULT_SETTINGS[key] as boolean));
  return {
    analyticsEnabled: flag('analyticsEnabled'),
    crashReportingEnabled: flag('crashReportingEnabled'),
    openAtLaunch: stored.openAtLaunch === 'nothing' ? 'nothing' : 'last-session',
    openAtLogin: flag('openAtLogin'),
  };
}

export const FEEDBACK_MAX = 5000;

export type UpdateInfo = { version: string; notes?: string };
export type UpdateCheck = { current: string; supported: boolean; update?: UpdateInfo };
export type UpdateProgress = { type: 'progress'; downloaded: number; total?: number | null } | { type: 'downloaded' } | { type: 'installed' };

export type DiagnosticsExport = { path: string; logFiles: number };

/** What it takes to reopen the last session: here, the page's hash route. Stored beside settings.json, never sent. */
export type LastSession = {
  version: 1;
  paths: string[];
  activePath?: string;
  savedAtMs: number;
};

export interface Job {
  id: string;
  url: string;
  kind?: 'song' | 'pad';
  title?: string;
  artist?: string;
  status: 'queued' | 'downloading' | 'converting' | 'done' | 'error';
  percent: number;
  eta: number | null;
  fileName?: string;
  filePath?: string;
  error?: string;
  /** A .djw map waiting for this download's audio. */
  map?: DjwMap;
}

/** The yt-dlp download helper: server/index.js on the web, src-tauri/src/downloads.rs in the Mac app. */
export type Helper = {
  jobs(): Promise<Job[]>;
  add(url: string, kind?: 'song' | 'pad', map?: DjwMap, title?: string): Promise<Job>;
  list(url: string): Promise<Array<{ url: string; title: string }>>;
  remove(id: string): Promise<void>;
  file(name: string): Promise<Blob>;
};

/** What the app needs from where it runs: the browser, or the Mac app. */
export type Platform = {
  helper: Helper;
  /** Saves a text file the app made. False when the person cancels. */
  saveText(text: string, fileName: string): Promise<boolean>;
};

/** The template's Mac-only features. Only code that runs in the Mac app touches these. */
export type Desktop = {
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  onSettingsChanged(handler: (settings: Settings) => void): () => void;
  onCommand(handler: (command: string) => void): () => void;
  openSettings(): Promise<void>;
  sendFeedback(message: string): Promise<void>;
  checkForUpdate(): Promise<UpdateCheck>;
  installUpdate(onProgress: (progress: UpdateProgress) => void): Promise<void>;
  relaunch(): Promise<void>;
  setOpenAtLogin(enabled: boolean): Promise<boolean>;
  getOpenAtLogin(): Promise<boolean>;
  getLastSession(): Promise<LastSession | null>;
  saveLastSession(session: LastSession): Promise<LastSession>;
  clearLastSession(): Promise<void>;
  exportDiagnostics(): Promise<DiagnosticsExport | null>;
  /** Files Finder asked the app to open, like a double-clicked .djw. Each comes back once. */
  takeOpenedFiles(): Promise<Array<{ name: string; text: string }>>;
  /** Finder asked the app to open more files. */
  onFilesOpened(handler: () => void): () => void;
};

/** The iPhone and iPad features, from src-tauri/src/ios.rs. Only code that runs on iOS touches these. */
export type Mobile = {
  /** The Files picker, for recordings and .djw maps. No files when the person cancels. */
  pickImportFiles(): Promise<File[]>;
  /** Keeps the screen on, for Perform. */
  setKeepAwake(enabled: boolean): Promise<void>;
  /** Debug builds only: the files in <app data>/dev-seed, once, and route.txt. Rejects in a release build. */
  takeDevSeed(): Promise<{ files: File[]; route?: string }>;
};

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// iPadOS web views say Macintosh, so a touch screen tells an iPad from the Mac app.
const IOS = isTauri() && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

/** The app on an iPhone or iPad. The Mac app and the web app are never this. */
export const isIOS = (): boolean => IOS;
