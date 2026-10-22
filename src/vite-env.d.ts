/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the Mac app sends opt-in crash reports. Set it in .env.local or CI, never in git. */
  readonly VITE_CRASH_DSN?: string;
}
