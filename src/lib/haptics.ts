import type { Snapshot } from '../audio/engine';

/** What the page asks the Taptic Engine for. `haptic` in src-tauri/src/ios.rs takes the same names. */
export type HapticKind = 'prepare' | 'landing' | 'selection';

/** A section on its way because someone tapped its pad. `at` is its landing on the audio clock. */
export type QueuedSection = { idx: number; at: number };

/**
 * Seconds from asking for a tick to feeling it, once the engine is prepared. A starting guess: Apple publishes no
 * figure and nobody has measured it. Raise it if the tick feels behind the downbeat, lower it if ahead.
 */
export const TICK_LAG = 0.06;
/** Wakes the Taptic Engine this long before a landing. It stays prepared for only a few seconds. */
const WAKE = 1;
/** The audio clock moves in steps, so a timer this close counts as on time. */
const ON_TIME = 0.01;
/** Past this a tick feels like a mistake, as when the app comes back from the background. */
const TOO_LATE = 0.12;

/**
 * The queue, as the engine knows it. A section of another song is already the first segment while it comes in, so it
 * never shows as next. It lands before anything picked after it, so it comes first.
 */
export function queuedSection(song: Snapshot['song'] | undefined, first: { idx: number; reason: string; landingCtx: number } | undefined): QueuedSection | null {
  if (song?.arriving && first?.reason === 'pick') return { idx: first.idx, at: first.landingCtx };
  const next = song?.next;
  return next?.reason === 'pick' ? { idx: next.idx, at: next.landingCtx } : null;
}

type Deps = {
  /** The audio clock, in seconds. */
  clock: () => number;
  /** How long sound takes to reach the listener, in seconds. */
  latency: () => number;
  /** False when Haptics is off or the app is in the background. */
  ready: () => boolean;
  fire: (kind: HapticKind) => void;
  /** Runs `run` in about `seconds`, and returns how to call it off. */
  schedule: (run: () => void, seconds: number) => () => void;
};

/**
 * Decides Perform's ticks. Call `update` every frame with the queue. The landing's timer only wakes this up: each time
 * it reads the audio clock again, so a slow timer or a stopped clock can't move the tick.
 */
export function hapticTicks({ clock, latency, ready, fire, schedule }: Deps) {
  let queued: QueuedSection | null = null;
  /** The landing the timer is waiting for. */
  let aimed: number | null = null;
  /** The last landing to get its tick, so setting the timer again can't repeat it. */
  let ticked: number | null = null;
  let callOff = () => {};

  const send = (kind: HapticKind) => {
    if (ready()) fire(kind);
  };

  const step = () => {
    if (aimed === null) return;
    const wait = aimed + latency() - TICK_LAG - clock();
    if (wait > ON_TIME) {
      if (wait <= WAKE) send('prepare');
      callOff = schedule(step, wait > WAKE ? wait - WAKE : wait);
      return;
    }
    if (-wait <= TOO_LATE && aimed !== ticked) {
      ticked = aimed;
      send('landing');
    }
    aimed = null;
  };

  const aim = (at: number | null) => {
    if (at === aimed) return;
    callOff();
    aimed = at;
    step();
  };

  return {
    update(next: QueuedSection | null, paused: boolean) {
      const landed = queued !== null && clock() >= queued.at;
      const same = queued?.idx === next?.idx && queued?.at === next?.at;
      // A section that lands empties the queue by itself, and its landing tick says so.
      if (!same && (next || !landed)) send('selection');
      const cancelled = queued !== null && !next && !landed;
      queued = next;
      // The queue can empty a moment before the tick is due, so a section that has landed keeps its timer.
      if (paused || cancelled) aim(null);
      else if (next) aim(next.at);
    },
    stop: () => aim(null),
  };
}
