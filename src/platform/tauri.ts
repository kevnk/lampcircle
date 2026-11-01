import { Channel, invoke } from '@tauri-apps/api/core';
import { emit, emitTo, listen } from '@tauri-apps/api/event';
import type { DisplayCue } from '../lib/lyricsCue';
import { sendBackup, type BackupReply } from '../lib/backup';
import type { CaptionTrack } from '../lib/lyricsFetch';
import type { MonitorInfo } from '../lib/lyricsWindow';
import { normalizeSettings, type Desktop, type DiagnosticsExport, type Job, type LastSession, type Mobile, type Platform, type UpdateCheck, type UpdateProgress } from './types';

function onEvent<T>(name: string, handler: (payload: T) => void): () => void {
  const unlisten = listen<T>(name, event => handler(event.payload));
  return () => void unlisten.then(stop => stop());
}

/** <audio> in WebKit wants a type on a blob URL. Downloads are mp3; a .djw can point at other files in the library. */
const AUDIO_TYPES: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' };

export const tauriPlatform: Platform = {
  helper: {
    jobs: () => invoke<Job[]>('download_jobs'),
    add: (url, kind, map, title) => invoke<Job>('add_download', { url, kind, map, title }),
    list: url => invoke<Array<{ url: string; title: string }>>('list_playlist', { url }),
    remove: id => invoke<void>('remove_download', { id }),
    async file(name) {
      const bytes = await invoke<ArrayBuffer>('library_file', { fileName: name });
      return new Blob([bytes], { type: AUDIO_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? '' });
    },
    captions: url => invoke<CaptionTrack[]>('fetch_captions', { url }),
    savedCaptions: fileName => invoke<CaptionTrack[]>('saved_captions', { fileName }),
  },
  saveText: (text, fileName) => invoke<boolean>('save_text', { text, fileName }),
};

export const desktop: Desktop = {
  getSettings: async () => normalizeSettings(await invoke<unknown>('get_settings')),
  saveSettings: async settings => void (await invoke('save_settings', { settings })),
  onSettingsChanged: handler => onEvent<unknown>('settings-changed', settings => handler(normalizeSettings(settings))),
  onCommand: handler => onEvent<string>('command', handler),
  openSettings: () => invoke<void>('open_settings'),
  sendFeedback: message => invoke<void>('send_feedback', { message }),
  checkForUpdate: () => invoke<UpdateCheck>('check_for_update'),
  async installUpdate(onProgress) {
    const channel = new Channel<UpdateProgress>();
    channel.onmessage = onProgress;
    await invoke('install_update', { channel });
  },
  relaunch: () => invoke<void>('relaunch'),
  setOpenAtLogin: enabled => invoke<boolean>('set_open_at_login', { enabled }),
  getOpenAtLogin: () => invoke<boolean>('get_open_at_login'),
  getLastSession: () => invoke<LastSession | null>('get_last_session'),
  saveLastSession: session => invoke<LastSession>('save_last_session', { session }),
  clearLastSession: () => invoke<void>('clear_last_session'),
  exportDiagnostics: () => invoke<DiagnosticsExport | null>('export_diagnostics'),
  takeOpenedFiles: () => invoke<Array<{ name: string; text: string }>>('take_opened_files'),
  onFilesOpened: handler => onEvent<null>('files-opened', handler),
  listMonitors: () => invoke<MonitorInfo[]>('list_monitors'),
  openLyricsDisplay: monitor => invoke<string>('open_lyrics_display', { monitor }),
  closeLyricsDisplay: () => invoke<void>('close_lyrics_display'),
  lyricsDisplayMonitor: () => invoke<string | null>('lyrics_display_monitor'),
  onLyricsDisplayClosed: handler => onEvent<null>('lyrics-display-closed', handler),
  onLyricsDisplayReady: handler => onEvent<null>('lyrics-display-ready', handler),
  sendLyricsCues: cues => void emitTo('lyrics', 'lyrics-cues', cues).catch(() => {}),
  joinLyricsCues(handler) {
    const unlisten = listen<DisplayCue[]>('lyrics-cues', event => handler(event.payload));
    void unlisten.then(() => emitTo('main', 'lyrics-display-ready')).catch(() => {});
    return () => void unlisten.then(stop => stop());
  },
};

/** The Files picker also offers these, which the Mac library never holds. */
const PICKED_TYPES: Record<string, string> = { ...AUDIO_TYPES, aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf' };

/** Reads the files src-tauri/src/ios.rs frames into one body: the header's length as a little-endian u32, a JSON header, then each file's bytes. */
export function unpack(body: ArrayBuffer): { files: File[]; route?: string } {
  const length = new DataView(body).getUint32(0, true);
  const header: { route?: string; files: Array<{ name: string; size: number }> } = JSON.parse(new TextDecoder().decode(new Uint8Array(body, 4, length)));
  let at = 4 + length;
  const files = header.files.map(({ name, size }) => {
    const file = new File([new Uint8Array(body, at, size)], name, { type: PICKED_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? '' });
    at += size;
    return file;
  });
  return { files, route: header.route };
}

/** Each emit is its own command and could overtake the last, so they wait in line. */
let audioSession: Promise<void> = Promise.resolve();

export const mobile: Mobile = {
  pickImportFiles: async () => unpack(await invoke<ArrayBuffer>('pick_import_files')).files,
  setKeepAwake: enabled => invoke<void>('set_keep_awake', { enabled }),
  haptic: kind => invoke<void>('haptic', { kind }),
  setAudioPlaying(playing) {
    // Web Audio may run under WebKit's own session and not the app's, so ask WebKit for the same thing. iOS 16.4 and later.
    const webkit = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (webkit) webkit.type = playing ? 'playback' : 'ambient';
    audioSession = audioSession.then(() => emit('audio-playing', playing)).catch(error => console.warn('Could not change the audio session', error));
    return audioSession;
  },
  onAudioPause: handler => onEvent<null>('audio-pause', handler),
  onAudioInterrupted: handler => onEvent<null>('audio-interrupted', handler),
  takeDevSeed: async () => unpack(await invoke<ArrayBuffer>('take_dev_seed')),
  async saveBackup(file, name, onProgress) {
    let answer: (reply: BackupReply) => void = () => {};
    const stop = await listen<BackupReply>('backup-reply', event => answer(event.payload));
    try {
      return await sendBackup(file, name, step => new Promise((resolve, reject) => {
        answer = resolve;
        emit('backup', step).catch(reject);
      }), onProgress);
    } finally {
      stop();
    }
  },
};
