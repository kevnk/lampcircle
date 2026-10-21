import type { JumpAt } from '../types';
import { barSeconds, beatPos, beatTime, upper, type Grid, type SectionView } from './songMap';

/** Audio times for entering a section: the fade starts at audioStart, singers come in at singerStart. */
export function leadIn(view: SectionView, grid: Grid): { audioStart: number; singerStart: number } {
  const landing = beatPos(grid, view.start);
  const { pickupBeats, fadeInBeats } = view.section;
  return {
    singerStart: Math.max(0, beatTime(grid, landing - pickupBeats)),
    audioStart: Math.max(0, beatTime(grid, landing - pickupBeats - fadeInBeats)),
  };
}

/** Where one pass ends. The last section loops on its last bar line, not on the ring-out. */
export function seamEnd(view: SectionView, grid: Grid, duration: number): number {
  const d = grid.downbeats;
  if (view.e < d.length) return d[view.e];
  return Math.min(duration, d[d.length - 1] + barSeconds(grid, d.length - 1));
}

export function fadeOutStart(view: SectionView, grid: Grid, boundary: number): number {
  return beatTime(grid, beatPos(grid, boundary) - view.section.fadeOutBeats);
}

/** Audio times of the fade-out when another pass takes over at `boundary`: it can end before or after the boundary. */
export function fadeOutSpan(view: SectionView, grid: Grid, boundary: number): { start: number; end: number } {
  const end = beatPos(grid, boundary) + (view.section.fadeOutEndBeats ?? 0);
  return { start: beatTime(grid, end - view.section.fadeOutBeats), end: beatTime(grid, end) };
}

/**
 * First boundary of the rule at or after `earliest`, inside the pass that lands at the section start.
 * Falls back to the end of the pass, since a pick must land somewhere.
 */
export function nextBoundary(rule: JumpAt, earliest: number, view: SectionView, grid: Grid, end: number): number {
  const d = grid.downbeats;
  const candidates =
    rule === 'beat'
      ? grid.beats
      : rule === 'bar'
        ? d
        : rule === 'phrase'
          ? d.filter((_, i) => i >= view.s && (i - view.s) % 4 === 0)
          : [];
  const found = candidates[upper(candidates, earliest - 1e-6)];
  return found !== undefined && found < end - 1e-6 ? found : end;
}

/** How a jump between two different sections lines up its fades. Loops and holds always use the section's own seam. */
export type JumpFade = 'out' | 'in' | 'edited';

/** Seconds from the landing (negative is before it) where the old pass fades out and the new one fades in. */
export interface SeamFades {
  out: [number, number];
  in: [number, number];
}

/**
 * Null when the recording runs straight on into the next section: the same audio keeps playing with no fades.
 * Between different sections, `match` lines one fade up with the other, so seams edited for looping leave no gap.
 * `other` is the grid of another song the jump goes to: that never runs straight on, and is never a loop.
 */
export function seamFades(from: SectionView, to: SectionView, boundary: number, grid: Grid, match: JumpFade, other?: Grid): SeamFades | null {
  if (!other && to.index === from.index + 1 && Math.abs(boundary - to.start) < 1e-3) return null;
  const fade = fadeOutSpan(from, grid, boundary);
  const lead = leadIn(to, other ?? grid);
  const out: [number, number] = [fade.start - boundary, fade.end - boundary];
  const into: [number, number] = [lead.audioStart - to.start, lead.singerStart - to.start];
  if ((!other && from.index === to.index) || match === 'edited') return { out, in: into };
  if (match === 'in') return { out: into, in: into };
  // The new pass cannot start before its recording does.
  const start = Math.max(out[0], -to.start);
  return { out, in: [start, Math.max(start, out[1])] };
}

export type Reason = 'plan' | 'hold' | 'pick';
export type Next = { idx: number; pass: number; reason: Reason } | 'end';

export function decideNext(state: {
  idx: number;
  pass: number;
  repeats: number;
  count: number;
  hold: boolean;
  pick: number | null;
  /** Audition: loop only this section this many times. */
  only?: { idx: number; passes: number };
}): Next {
  const { idx, pass, repeats, count, hold, pick, only } = state;
  if (only) return pass < only.passes ? { idx, pass: pass + 1, reason: 'plan' } : 'end';
  if (pick !== null) return { idx: pick, pass: 1, reason: 'pick' };
  if (hold) return { idx, pass: pass + 1, reason: 'hold' };
  if (pass < repeats) return { idx, pass: pass + 1, reason: 'plan' };
  return idx + 1 < count ? { idx: idx + 1, pass: 1, reason: 'plan' } : 'end';
}

/** Next pad-clock boundary at or after `earliest`. */
export function clockBoundary(anchor: number, period: number, earliest: number): number {
  if (!(period > 0)) return earliest;
  return anchor + Math.max(0, Math.ceil((earliest - anchor) / period - 1e-9)) * period;
}

const FADE_STEPS = 16;

/** How a fade travels between silence and full: `gain` maps progress from 0 to 1 onto a gain, `progress` maps a gain back. */
export interface FadeShape {
  gain: (p: number) => number;
  progress: (v: number) => number;
}

/** A quarter sine, so a fade-out and a fade-in over the same beats keep their summed power steady instead of dipping 3 dB in the middle. */
export const EQUAL_POWER: FadeShape = { gain: p => Math.sin((p * Math.PI) / 2), progress: v => (2 * Math.asin(v)) / Math.PI };

/**
 * For taking the whole mix to silence and back. Heard loudness goes as gain^0.6 (Stevens' power law), so this
 * moves it in a straight line: half as loud (-10 dB) half way. Equal power and a straight gain line hold loud,
 * then drop away at the end; a straight line in dB spends most of the fade nearly silent.
 */
export const EVEN_LOUDNESS: FadeShape = { gain: p => p ** (1 / 0.6), progress: v => v ** 0.6 };

/**
 * Points along a fade from `from` at `start` to `to` at `end`, for gains from 0 to 1.
 * Joined by straight ramps, 16 steps stay within 0.2% of either curve.
 */
export function fadeCurve(from: number, to: number, start: number, end: number, shape = EQUAL_POWER): Array<{ t: number; v: number }> {
  const a = shape.progress(Math.min(1, Math.max(0, from)));
  const b = shape.progress(Math.min(1, Math.max(0, to)));
  return Array.from({ length: FADE_STEPS + 1 }, (_, i) => ({
    t: start + ((end - start) * i) / FADE_STEPS,
    v: i === 0 ? from : i === FADE_STEPS ? to : shape.gain(a + ((b - a) * i) / FADE_STEPS),
  }));
}
