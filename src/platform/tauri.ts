import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { normalizeSettings, type Desktop, type DiagnosticsExport, type Job, type LastSession, type Platform, type UpdateCheck, type UpdateProgress } from './types';

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
};
