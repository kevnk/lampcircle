import type { Beat, PartWindow, SectionMark, SongPart, SongPhase, TempoVerdict } from '../types';

export const MIN_TAPS = 8;
export const STEADY_TOLERANCE_SEC = 0.03;
export const INTEGER_BPM_TOLERANCE = 0.1;
export const MAX_PICKUP_BEATS = 16;

export function readPhase(phase: SongPhase | undefined): SongPhase {
  return phase ?? { kind: 'needs-tap' };
}

export function downbeatsFromBeats(beats: Beat[]): number[] {
  return beats.filter(beat => beat.beat === 1).map(beat => beat.time);
}

export function barBeatAt(
  time: number,
  downbeats: number[],
  beatsPerBarCount: number
): { bar: number; beat: number } | null {
  if (downbeats.length === 0 || beatsPerBarCount < 1) return null;
  let index = 0;
  for (let i = 0; i < downbeats.length; i++) {
    if (downbeats[i] <= time) index = i;
  }
  const start = downbeats[index];
  const length =
    index + 1 < downbeats.length
      ? downbeats[index + 1] - start
      : index > 0
        ? start - downbeats[index - 1]
        : 0.5;
  const beatDur = length / beatsPerBarCount;
  const beat = Math.min(beatsPerBarCount, Math.max(1, Math.floor((time - start) / beatDur) + 1));
  return { bar: index + 1, beat };
}

export function partsFromMarks(marks: SectionMark[], downbeatCount: number): SongPart[] {
  if (downbeatCount < 2) return [];
  const sorted = [...marks]
    .filter(mark => mark.bar >= 1 && mark.bar < downbeatCount)
    .sort((a, b) => a.bar - b.bar);
  const unique: SectionMark[] = [];
  for (const mark of sorted) {
    const last = unique[unique.length - 1];
    if (last && last.bar === mark.bar) unique[unique.length - 1] = mark;
    else unique.push(mark);
  }
  const source = unique.length > 0 ? unique : [{ bar: 1, name: 'Song' }];
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
  return source.map((mark, index) => {
    const nextBar = source[index + 1]?.bar ?? downbeatCount;
    const endBar = Math.max(mark.bar + 1, Math.min(downbeatCount, nextBar));
    return {
      id: `part-${mark.bar}-${index}`,
      name: mark.name,
      startBar: mark.bar,
      endBar,
      pickupBeats: 0,
      fadeInBeats: 0,
      fadeOutBeats: 0,
      loop: true,
      color: colors[index % colors.length],
    };
  });
}

export function readyMapFromRegions(
  beats: Beat[],
  regions: { name: string; start: number; color?: string }[],
  duration: number,
  bpm: number,
  beatsPerBarCount = 4,
): SongPhase {
  let downbeats = downbeatsFromBeats(beats);
  if (downbeats.length < 2) {
    const barSeconds = bpm > 0 ? (60 / bpm) * beatsPerBarCount : 2;
    downbeats = lockDownbeats(beats[0]?.time ?? 0, barSeconds, duration);
  }
  if (downbeats.length < 2) return { kind: 'needs-tap' };
  const marks: { bar: number; name: string; color?: string }[] = [];
  for (const region of regions) {
    const place = barBeatAt(region.start, downbeats, beatsPerBarCount);
    if (place) marks.push({ bar: place.bar, name: region.name, color: region.color });
  }
  const parts = partsFromMarks(marks, downbeats.length).map((part, index) => ({
    ...part,
    color: marks[index]?.color ?? part.color,
    pickupBeats: index === 0 ? 0 : 1,
  }));
  if (parts.length === 0) return { kind: 'needs-tap' };
  return {
    kind: 'ready',
    downbeats,
    taps: downbeats.slice(0, MIN_TAPS),
    lockedBpm: bpm > 0 ? bpm : null,
    parts,
  };
}

export function beatsPerBar(timeSignature: string): number {
  const count = Number.parseInt(timeSignature, 10);
  return Number.isFinite(count) && count > 0 ? count : 4;
}

export function assessTempo(downbeats: number[], beatsPerBar: number): TempoVerdict {
  const sorted = [...downbeats].sort((a, b) => a - b);
  if (sorted.length < MIN_TAPS) {
    return { kind: 'keep-tapping', bars: sorted.length };
  }

  const taps = sorted.slice(0, MIN_TAPS);
  const { intercept, slope } = fitLine(taps);
  if (!Number.isFinite(slope) || slope <= 0) {
    return { kind: 'keep-tapping', bars: sorted.length };
  }

  const rawBpm = (beatsPerBar * 60) / slope;
  const steady = taps.every((tap, index) => {
    const residual = Math.abs(tap - (intercept + slope * index));
    return residual <= STEADY_TOLERANCE_SEC;
  });
  const barSeconds = roundTo(slope, 3);

  if (steady) {
    const nearest = Math.round(rawBpm);
    const bpm =
      Math.abs(rawBpm - nearest) <= INTEGER_BPM_TOLERANCE ? nearest : roundTo(rawBpm, 1);
    return { kind: 'steady', bpm, barSeconds };
  }

  const perBarBpm: number[] = [];
  for (let i = 0; i < taps.length - 1; i++) {
    const gap = taps[i + 1] - taps[i];
    if (gap <= 0) return { kind: 'keep-tapping', bars: sorted.length };
    perBarBpm.push(roundTo((beatsPerBar * 60) / gap, 1));
  }
  return {
    kind: 'drifts',
    bpmMin: Math.min(...perBarBpm),
    bpmMax: Math.max(...perBarBpm),
    barSeconds,
  };
}

export function lockDownbeats(firstTap: number, barSeconds: number, duration: number): number[] {
  if (!(barSeconds > 0) || !Number.isFinite(duration) || duration <= firstTap) return [];
  const limit = duration - 1e-9;
  const downbeats: number[] = [];
  for (let i = 0; ; i++) {
    const time = firstTap + i * barSeconds;
    if (time >= limit) break;
    if (time >= -1e-9) downbeats.push(time);
  }
  return downbeats;
}

export function expandDownbeats(downbeats: number[], beatsPerBar: number): Beat[] {
  if (downbeats.length === 0 || beatsPerBar <= 0) return [];
  const beats: Beat[] = [];
  for (let i = 0; i < downbeats.length; i++) {
    const start = downbeats[i];
    const barSeconds =
      i + 1 < downbeats.length
        ? downbeats[i + 1] - start
        : i > 0
          ? start - downbeats[i - 1]
          : 0.5;
    const beatDur = barSeconds / beatsPerBar;
    for (let beat = 1; beat <= beatsPerBar; beat++) {
      beats.push({
        time: start + (beat - 1) * beatDur,
        bar: i + 1,
        beat,
        confidence: 1,
      });
    }
  }
  return beats;
}

export function partWindow(
  part: SongPart,
  downbeats: number[],
  beatsPerBar: number,
): PartWindow | null {
  if (part.startBar < 1 || part.endBar <= part.startBar) return null;
  const landingIndex = part.startBar - 1;
  const endIndex = part.endBar - 1;
  if (landingIndex >= downbeats.length || endIndex >= downbeats.length) return null;

  const landingBeatDur = landingBeatDuration(downbeats, part.startBar, beatsPerBar);
  const endBeatDur =
    endIndex >= 1
      ? (downbeats[endIndex] - downbeats[endIndex - 1]) / beatsPerBar
      : landingBeatDur;
  const landing = downbeats[landingIndex];
  return {
    landing,
    singerStart: landing - part.pickupBeats * landingBeatDur,
    audioStart: landing - (part.pickupBeats + part.fadeInBeats) * landingBeatDur,
    musicalEnd: downbeats[endIndex],
    fadeOutStart: downbeats[endIndex] - part.fadeOutBeats * endBeatDur,
  };
}

export function clampPickup(beats: number): number {
  const snapped = Math.round(beats * 2) / 2;
  return Math.min(MAX_PICKUP_BEATS, Math.max(0, snapped));
}

function landingBeatDuration(downbeats: number[], startBar: number, beatsPerBar: number): number {
  if (startBar < downbeats.length) {
    return (downbeats[startBar] - downbeats[startBar - 1]) / beatsPerBar;
  }
  if (startBar >= 2) {
    return (downbeats[startBar - 1] - downbeats[startBar - 2]) / beatsPerBar;
  }
  return 0.5;
}

function fitLine(times: number[]): { intercept: number; slope: number } {
  const n = times.length;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += times[i];
    sumXX += i * i;
    sumXY += i * times[i];
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { intercept, slope };
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
