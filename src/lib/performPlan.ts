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

/**
 * Points along an equal-power fade from `from` at `start` to `to` at `end`, for gains from 0 to 1.
 * The gain follows a quarter sine, so a fade-out and a fade-in over the same beats keep their summed power
 * steady instead of dipping 3 dB in the middle. Joined by straight ramps, 16 steps stay within 0.2% of the curve.
 */
export function fadeCurve(from: number, to: number, start: number, end: number): Array<{ t: number; v: number }> {
  const a = Math.asin(Math.min(1, Math.max(0, from)));
  const b = Math.asin(Math.min(1, Math.max(0, to)));
  return Array.from({ length: FADE_STEPS + 1 }, (_, i) => ({
    t: start + ((end - start) * i) / FADE_STEPS,
    v: i === 0 ? from : i === FADE_STEPS ? to : Math.sin(a + ((b - a) * i) / FADE_STEPS),
  }));
}
