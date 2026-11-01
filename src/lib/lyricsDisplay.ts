import type { Song } from '../types';
import { CUE_START, LYRICS_PREFS, nextCue, takeCue, type CueInput, type CueState, type DisplayCue, type DisplayState, type LyricsCue, type LyricsPrefs } from './lyricsCue';
import { beatPos, type Grid } from './songMap';

const KEY = 'lampcircle.lyricsPrefs';

/** The app-wide default's choices, the same as a song's own on Map Song. */
export const LEAD_BEATS = { min: 1, max: 3, step: 0.5 };
export const FADE_BEATS = { min: 0, max: 2, step: 0.5 };
/** Milliseconds a screen runs behind, such as a TV on AirPlay. */
export const DISPLAY_DELAY = { min: 0, max: 500, step: 50 };

const fit = (value: unknown, range: typeof LEAD_BEATS, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, Math.round(value / range.step) * range.step)) : fallback;

/** The saved default, with anything missing or broken back at the app's own. */
export function parseLyricsPrefs(saved: string | null): LyricsPrefs {
  try {
    const { leadBeats, fadeBeats } = JSON.parse(saved ?? '{}') ?? {};
    return { leadBeats: fit(leadBeats, LEAD_BEATS, LYRICS_PREFS.leadBeats), fadeBeats: fit(fadeBeats, FADE_BEATS, LYRICS_PREFS.fadeBeats) };
  } catch {
    return LYRICS_PREFS;
  }
}

/** Kept on the device like Perform's other choices, so it works in every version of the app and never reaches a .djw. */
export function loadLyricsPrefs(): LyricsPrefs {
  try {
    return parseLyricsPrefs(localStorage.getItem(KEY));
  } catch {
    return LYRICS_PREFS;
  }
}

/** The saved prefs with these changed, so saving one choice keeps the others. */
export function mergeLyricsPrefs(saved: string | null, patch: Partial<LyricsPrefs> | { displayDelayMs: number }): string {
  let kept: unknown;
  try {
    kept = JSON.parse(saved ?? '{}');
  } catch {
    kept = {};
  }
  return JSON.stringify({ ...(kept && typeof kept === 'object' ? kept : {}), ...patch });
}

function savePrefs(patch: Parameters<typeof mergeLyricsPrefs>[1]) {
  try {
    localStorage.setItem(KEY, mergeLyricsPrefs(localStorage.getItem(KEY), patch));
  } catch {
    // Private mode: keep the choice for this visit only.
  }
}

export const saveLyricsPrefs = (prefs: LyricsPrefs) => savePrefs(prefs);

export function parseDisplayDelay(saved: string | null): number {
  try {
    return fit(JSON.parse(saved ?? '{}')?.displayDelayMs, DISPLAY_DELAY, DISPLAY_DELAY.min);
  } catch {
    return DISPLAY_DELAY.min;
  }
}

export function loadDisplayDelay(): number {
  try {
    return parseDisplayDelay(localStorage.getItem(KEY));
  } catch {
    return DISPLAY_DELAY.min;
  }
}

export const saveDisplayDelay = (displayDelayMs: number) => savePrefs({ displayDelayMs });

/** Some section of the song points at a slide with words on it. */
export function hasWords(song: Song): boolean {
  return song.sections.some(section => section.lyric && song.lyrics?.blocks[section.lyric.block]?.some(slide => slide.length));
}

/**
 * Whole beats until the slide changes, so it reads 1 through the last beat before it. Null when no change is coming.
 * A change past the next seam is counted at the tempo here, and the count settles once that pass lands.
 */
export function beatsToChange(cue: LyricsCue, grid: Grid, pos: number, ctxNow: number): number | null {
  if (cue.changeAt === null) return null;
  return Math.max(1, Math.ceil(beatPos(grid, pos + cue.changeAt - ctxNow) - beatPos(grid, pos) - 1e-6));
}

/** A screen at one moment: the cue up, the one it is leaving, and how far the fade has come, 0 to 1. */
export interface ScreenFaces {
  up: DisplayCue | null;
  was: DisplayCue | null;
  p: number;
  /** How strong `was` stood when the fade began: below 1 when it cut into another fade. */
  from: number;
}

export function facesAt(faces: ScreenFaces, display: DisplayState, ms: number): ScreenFaces {
  const showing = display.pending && display.pending.changeAtMs <= ms ? display.pending : display.up;
  // The same face sent again only clears a cue to come, so a fade under way goes on. A new one fades from whichever face is stronger now.
  const changed = showing && (showing.text !== faces.up?.text || showing.logo !== faces.up?.logo);
  const leaving = faces.was && faces.p < 0.5 ? { was: faces.was, from: 1 - faces.p } : { was: faces.up, from: faces.p };
  const { up, was, from } = changed ? { up: showing, ...leaving } : faces;
  return { up, was, from, p: up && up.fadeMs > 0 ? Math.min(1, Math.max(0, (ms - up.changeAtMs) / up.fadeMs)) : 1 };
}

export type ScreenMode = NonNullable<CueInput['mode']>;

/** The chosen screen state and where its cues have got to. A display in its own window takes the cues `tickWords` returns. */
export interface WordsState {
  mode: ScreenMode;
  /** A slide tapped since the last tick. */
  tap: string[] | null;
  cues: CueState;
  display: DisplayState;
  faces: ScreenFaces;
}

export const WORDS_START: WordsState = { mode: 'words', tap: null, cues: CUE_START, display: { seq: 0, up: null, pending: null }, faces: { up: null, was: null, p: 1, from: 1 } };

/** Blank or Logo. A second press goes back to the slide the song is on, past any slide tapped before. */
export const toggleScreen = (state: WordsState, mode: Exclude<ScreenMode, 'words'>): WordsState =>
  state.mode === mode ? { ...state, mode: 'words', cues: { ...state.cues, tapped: null } } : { ...state, mode };

/** Shows a slide now, over Blank or Logo too. */
export const tapSlide = (state: WordsState, lines: string[]): WordsState => ({ ...state, mode: 'words', tap: lines });

export function tickWords(state: WordsState, cue: LyricsCue, at: Pick<CueInput, 'ctxNow' | 'ms'>): { state: WordsState; cues: DisplayCue[] } {
  const step = nextCue(state.cues, cue, { ...at, mode: state.mode, tap: state.tap ?? undefined });
  const display = step.cues.reduce((held, sent) => takeCue(held, sent, at.ms), state.display);
  return { state: { ...state, tap: null, cues: step.state, display, faces: facesAt(state.faces, display, at.ms) }, cues: step.cues };
}

/**
 * The slides to offer beside the screen. `current` is the slide the song is on, only when Blank, Logo or a tap has
 * something else up. `next` is left out when it would change nothing on the screen.
 */
export function slidesToOffer(state: WordsState, cue: LyricsCue): { current: string[] | null; next: string[] | null } {
  const up = state.faces.up;
  const changes = (lines: string[] | null) => (lines && (up?.logo || lines.join('\n') !== (up?.text ?? '')) ? lines : null);
  return { current: state.mode !== 'words' || state.cues.tapped ? changes(cue.now) : null, next: changes(cue.next) };
}
