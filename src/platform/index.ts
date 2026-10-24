import { browserPlatform } from './browser';
import { tauriPlatform } from './tauri';
import { isTauri } from './types';

export * from './types';
export { desktop, mobile } from './tauri';
export const platform = isTauri() ? tauriPlatform : browserPlatform;
