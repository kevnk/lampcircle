import { browserPlatform } from './browser';
import { tauriPlatform } from './tauri';
import { isTauri } from './types';

export * from './types';
export { desktop } from './tauri';
export const platform = isTauri() ? tauriPlatform : browserPlatform;
