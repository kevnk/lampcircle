/**
 * The browser reports how long sound takes to reach the speakers, but it can miss the route (Bluetooth, AirPlay), and it
 * knows nothing of a touch screen's delay or how a person taps. So they tap along to clicks, and how far off they land
 * comes off their taps from then on. Kept on the device, because it belongs to these speakers and not to the song.
 */
const KEY = 'lampcircle.tapPrefs';

/** 80 BPM: slow enough that a tap up to 600 ms behind a click still counts as that click's. */
export const CLICK_GAP = 0.75;
/** Clicks to find the beat, and to wake a Bluetooth speaker that swallows the first sound it gets. */
export const COUNT_IN = 4;
export const SCORED = 12;
/** Seconds to keep listening after the last click, for sound still on its way to the listener. */
export const LISTEN_ON = 3;

const EARLY_MS = 150;
const LATE_MS = CLICK_GAP * 1000 - EARLY_MS;
const MIN_TAPS = 8;
/** Taps closer to the median than this always count, however steady the rest are. */
const KEEP_MS = 40;
const MAX_SPREAD_MS = 70;
/** How far apart the first and second half of the taps can sit. Past this they were drifting or jumped, and no one number fits them. */
const MAX_DRIFT_MS = 70;
/** The reported latency has to move this far to mean a different output, not just the browser's estimate settling. */
const OUTPUT_MOVED_MS = 30;

export interface TapPrefs {
  /** Taken off new taps. Positive means they land late. */
  offsetMs: number;
  /** What the browser reported when this was measured. Missing until then. */
  latencyMs?: number;
}

export type TapCheck = { ok: true; offsetMs: number; used: number; spreadMs: number } | { ok: false; why: 'few' | 'uneven' | 'late' };

export const clampTapOffset = (ms: number) => Math.min(LATE_MS, Math.max(-EARLY_MS, ms));

/** On the audio clock, from when the first click sounds. Only the clicks after COUNT_IN are scored. */
export const clickTimes = (first: number) => Array.from({ length: COUNT_IN + SCORED }, (_, i) => first + i * CLICK_GAP);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** How far the first tap for each click landed from it, in ms. The window leans late, because unreported latency makes taps late and rarely early. */
function tapDeltas(clicks: number[], taps: number[]): number[] {
  return clicks.flatMap(click => {
    const tap = taps.find(t => (t - click) * 1000 >= -EARLY_MS && (t - click) * 1000 < LATE_MS);
    return tap === undefined ? [] : [(tap - click) * 1000];
  });
}

/** How far the taps land from the scored clicks on average, or why that can't be trusted. Both are in seconds on the audio clock. */
export function checkTaps(clicks: number[], taps: number[]): TapCheck {
  const deltas = tapDeltas(clicks, taps);
  if (deltas.length < MIN_TAPS) return { ok: false, why: 'few' };
  // Taken before outliers go, since a sudden shift partway through would otherwise be left out as outliers. Medians, so a wild tap or two doesn't count as drift.
  const half = deltas.length >> 1;
  if (Math.abs(median(deltas.slice(0, half)) - median(deltas.slice(-half))) > MAX_DRIFT_MS) return { ok: false, why: 'uneven' };
  const middle = median(deltas);
  const typical = median(deltas.map(delta => Math.abs(delta - middle)));
  const reach = Math.max(KEEP_MS, 3 * 1.4826 * typical);
  const kept = deltas.filter(delta => Math.abs(delta - middle) <= reach);
  if (kept.length < MIN_TAPS) return { ok: false, why: 'few' };
  const mean = average(kept);
  const spread = Math.sqrt(kept.reduce((sum, delta) => sum + (delta - mean) ** 2, 0) / kept.length);
  if (spread > MAX_SPREAD_MS) return { ok: false, why: 'uneven' };
  // Sound more than a click late, as over AirPlay, looks like a small or negative offset, because every tap falls on some
  // click. But people tap until they hear the high last click, so the last tap shows how late the sound really is.
  // A tap past the last click looks the same, and only costs another try.
  // ponytail: sound 600 to 1350 ms late plus a missed last click still saves a wrong number, since it looks like tapping early. A native route check would catch it.
  const last = (Math.max(...taps) - clicks[clicks.length - 1]) * 1000;
  if (last > mean + LATE_MS + EARLY_MS - 100) return { ok: false, why: 'late' };
  return { ok: true, offsetMs: Math.round(clampTapOffset(mean)), used: kept.length, spreadMs: Math.round(spread) };
}

/** Where a press belongs, given where the listener was in the song as they pressed. It stays inside the song. */
export const applyTapOffset = (heard: number, offsetMs: number, duration = Infinity) => Math.min(duration, Math.max(0, heard - offsetMs / 1000));

/** True when the browser now reports a different latency from the one this offset was measured with. */
export function outputMoved(prefs: TapPrefs, latencyMs: number): boolean {
  return prefs.latencyMs !== undefined && Math.abs(latencyMs - prefs.latencyMs) > OUTPUT_MOVED_MS;
}

/** The saved prefs, with anything missing or broken back at no offset. */
export function parseTapPrefs(saved: string | null): TapPrefs {
  try {
    const { offsetMs, latencyMs } = JSON.parse(saved ?? '{}') ?? {};
    if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs)) return { offsetMs: 0 };
    return { offsetMs: clampTapOffset(offsetMs), ...(typeof latencyMs === 'number' && Number.isFinite(latencyMs) ? { latencyMs } : {}) };
  } catch {
    return { offsetMs: 0 };
  }
}

export function loadTapPrefs(): TapPrefs {
  try {
    return parseTapPrefs(localStorage.getItem(KEY));
  } catch {
    return { offsetMs: 0 };
  }
}

/** Saves these prefs, or with none clears them. Private mode keeps them for this visit only. */
export function saveTapPrefs(prefs?: TapPrefs) {
  try {
    if (prefs) localStorage.setItem(KEY, JSON.stringify(prefs));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode.
  }
}
