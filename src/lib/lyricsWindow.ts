import { CUE_START, type DisplayCue, type DisplayState } from './lyricsCue';
import { WORDS_START, type WordsState } from './lyricsDisplay';

/** A screen the lyrics window can go on, from `list_monitors`. `id` is the only way to tell two apart. */
export interface MonitorInfo {
  id: string;
  name: string | null;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

/** The screens to offer, best first: a second screen before the main one. */
export const monitorChoices = (monitors: MonitorInfo[]) => [...monitors].sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary));

export const defaultMonitor = (monitors: MonitorInfo[]): MonitorInfo | null => monitorChoices(monitors)[0] ?? null;

/** macOS gives the app only a model number for a screen, so each goes by its place. */
export function monitorLabel(monitor: MonitorInfo, monitors: MonitorInfo[]): string {
  return monitor.isPrimary ? 'Main display' : `Display ${monitors.filter(other => !other.isPrimary).findIndex(other => other.id === monitor.id) + 2}`;
}

/**
 * A cue as a late screen needs it: a change still to come starts `delayMs` sooner, so it lands on time. A change that
 * was going up now can't go any sooner, and the fade stays as it was.
 */
export function scheduleCue(cue: DisplayCue, delayMs: number, ms: number): DisplayCue {
  return cue.changeAtMs > ms ? { ...cue, changeAtMs: Math.max(ms, cue.changeAtMs - delayMs) } : cue;
}

/** What a window that just opened needs, oldest first, to match the Words strip. */
export const catchUpCues = (display: DisplayState): DisplayCue[] => [display.up, display.pending].filter(cue => cue !== null);

/** A new strip's state, with its cues counting from `seq`, so an open window that heard an older strip still takes them. */
export const wordsStartAt = (seq: number): WordsState => ({ ...WORDS_START, cues: { ...CUE_START, seq } });

/** The screen goes black as quickly as any other change that wasn't cued ahead. */
const LEAVE_FADE_MS = 250;

/** The strip is going away: black, past any cue to come, so the room's screen doesn't hold the last slide. */
export function leaveCue(state: WordsState, ms: number): { state: WordsState; cue: DisplayCue } {
  const seq = state.cues.seq + 1;
  return { state: { ...state, cues: { ...state.cues, seq, up: null, pending: null } }, cue: { seq, text: '', logo: false, changeAtMs: ms, fadeMs: LEAVE_FADE_MS } };
}

/**
 * Runs jobs one at a time, in the order asked. Moving the window takes a moment with no window at all, so without this
 * Turn off could land before the open it follows, and a check could report a window that's only mid-move.
 */
export function oneAtATime() {
  let last: Promise<void> = Promise.resolve();
  return (job: () => Promise<void>) => (last = last.then(job, job));
}

/**
 * What the button should say, from what is true now. `chosen` is the screen picked for the window and `on` the screen
 * it is on. macOS moves a window off an unplugged screen rather than closing it, so a chosen screen that has gone
 * means closing it, before it covers Perform.
 */
export function syncDisplay(chosen: string | null, on: string | null, monitors: MonitorInfo[]): { chosen: string | null; close: boolean } {
  if (on === null) return { chosen: null, close: false };
  const picked = chosen ?? on;
  return monitors.some(monitor => monitor.id === picked) ? { chosen: picked, close: false } : { chosen: null, close: true };
}
