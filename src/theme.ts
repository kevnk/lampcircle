import { useSyncExternalStore } from 'react';

/** Light, dark, or whatever the system uses. index.html applies the saved one before the first paint. */
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'lampcircle.theme';
const system = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function saved(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Held here too, so the choice lasts for the visit when storage is blocked. */
let current = saved();
export const theme = () => current;

export const isDark = () => document.documentElement.classList.contains('dark');

function apply() {
  const dark = theme() === 'dark' || (theme() === 'system' && system.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#070D13' : '#FBF7F1');
  listeners.forEach(listener => listener());
}

export function setTheme(next: Theme) {
  current = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // Storage is blocked: `current` keeps the choice for this visit.
  }
  apply();
}

system.addEventListener('change', apply);
apply();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The chosen theme, and whether the app is dark right now. */
export function useTheme(): { choice: Theme; dark: boolean } {
  const choice = useSyncExternalStore(subscribe, theme);
  const dark = useSyncExternalStore(subscribe, isDark);
  return { choice, dark };
}
