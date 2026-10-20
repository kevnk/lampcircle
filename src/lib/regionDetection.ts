import { Beat, Region } from '../types';
import { REGION_COLORS } from './utils';
import { snapToNearestMeasure } from './beatDetection';

const STRUCTURE_LABELS = [
  'Intro',
  'V1',
  'Chorus',
  'V2',
  'Chorus',
  'Bridge',
  'Chorus',
  'Outro',
];

const EVEN_BLOCK_LABELS = [
  'Intro',
  'V1',
  'Chorus',
  'V2',
  'Chorus',
  'Bridge',
  'V3',
  'Chorus',
  'Outro',
];

/**
 * Suggest song regions from energy / structure heuristics, snapped to measures.
 * Falls back to even 8- or 16-bar blocks when structure is weak.
 */
export async function suggestRegions(
  audioBuffer: AudioBuffer,
  beats: Beat[]
): Promise<Region[]> {
  const duration = audioBuffer.duration;
  if (duration <= 0) return [];

  const downbeats = beats.filter(b => b.beat === 1);
  if (downbeats.length < 2) {
    return evenBlockRegions(duration, beats, 8);
  }

  const measureEnergies = computeMeasureEnergies(audioBuffer, downbeats, duration);
  const changePoints = findEnergyChangePoints(measureEnergies);

  // Need enough segments to be useful; otherwise even blocks
  if (changePoints.length < 2) {
    const barsPerBlock = downbeats.length >= 32 ? 16 : 8;
    return evenBlockRegions(duration, beats, barsPerBlock);
  }

  const boundaries = [0, ...changePoints, measureEnergies.length];
  const segments: { startBarIdx: number; endBarIdx: number; meanEnergy: number }[] =
    [];

  for (let i = 0; i < boundaries.length - 1; i++) {
    const startBarIdx = boundaries[i];
    const endBarIdx = boundaries[i + 1];
    if (endBarIdx <= startBarIdx) continue;
    let sum = 0;
    for (let j = startBarIdx; j < endBarIdx; j++) {
      sum += measureEnergies[j];
    }
    segments.push({
      startBarIdx,
      endBarIdx,
      meanEnergy: sum / (endBarIdx - startBarIdx),
    });
  }

  if (segments.length < 2) {
    const barsPerBlock = downbeats.length >= 32 ? 16 : 8;
    return evenBlockRegions(duration, beats, barsPerBlock);
  }

  // Merge tiny segments (< 2 bars) into neighbors
  const merged = mergeTinySegments(segments, 2);
  const labels = labelSegmentsByEnergy(merged);

  return merged.map((seg, i) => {
    const startTime = snapToNearestMeasure(
      downbeats[seg.startBarIdx]?.time ?? 0,
      beats
    );
    const endRaw =
      seg.endBarIdx < downbeats.length
        ? downbeats[seg.endBarIdx].time
        : duration;
    const endTime = Math.min(
      duration,
      snapToNearestMeasure(endRaw, beats) || endRaw
    );
    return {
      id: crypto.randomUUID(),
      name: labels[i] ?? `Section ${i + 1}`,
      start: Math.min(startTime, endTime),
      end: Math.max(startTime, endTime),
      color: REGION_COLORS[i % REGION_COLORS.length],
    };
  }).filter(r => r.end - r.start > 0.25);
}

function computeMeasureEnergies(
  audioBuffer: AudioBuffer,
  downbeats: Beat[],
  duration: number
): number[] {
  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const energies: number[] = [];

  for (let i = 0; i < downbeats.length; i++) {
    const t0 = downbeats[i].time;
    const t1 = i + 1 < downbeats.length ? downbeats[i + 1].time : duration;
    const s0 = Math.max(0, Math.floor(t0 * sampleRate));
    const s1 = Math.min(channel.length, Math.floor(t1 * sampleRate));
    let sum = 0;
    const n = Math.max(1, s1 - s0);
    for (let s = s0; s < s1; s++) {
      const v = channel[s];
      sum += v * v;
    }
    energies.push(Math.sqrt(sum / n));
  }

  // Smooth with small window
  const smoothed: number[] = [];
  const w = 1;
  for (let i = 0; i < energies.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(energies.length - 1, i + w); j++) {
      sum += energies[j];
      count++;
    }
    smoothed.push(sum / count);
  }
  return smoothed;
}

/** Indices of measures that start a new section (energy jump). */
function findEnergyChangePoints(energies: number[]): number[] {
  if (energies.length < 4) return [];

  const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
  const variance =
    energies.reduce((a, b) => a + (b - mean) ** 2, 0) / energies.length;
  const std = Math.sqrt(variance) || 1e-6;
  const threshold = Math.max(std * 0.85, mean * 0.12);

  const diffs: number[] = [];
  for (let i = 1; i < energies.length; i++) {
    diffs.push(Math.abs(energies[i] - energies[i - 1]));
  }

  const points: number[] = [];
  let last = 0;
  const minGapBars = 4; // avoid chopping every bar

  for (let i = 0; i < diffs.length; i++) {
    const barIdx = i + 1; // change at start of this measure
    if (diffs[i] >= threshold && barIdx - last >= minGapBars) {
      // Prefer peaks in a local neighborhood
      const local = diffs.slice(Math.max(0, i - 1), Math.min(diffs.length, i + 2));
      if (diffs[i] >= Math.max(...local) * 0.95) {
        points.push(barIdx);
        last = barIdx;
      }
    }
  }

  return points;
}

function mergeTinySegments(
  segments: { startBarIdx: number; endBarIdx: number; meanEnergy: number }[],
  minBars: number
) {
  const out = [...segments];
  let i = 0;
  while (i < out.length) {
    const len = out[i].endBarIdx - out[i].startBarIdx;
    if (len < minBars && out.length > 1) {
      if (i === 0) {
        // merge into next
        out[1] = {
          startBarIdx: out[0].startBarIdx,
          endBarIdx: out[1].endBarIdx,
          meanEnergy: (out[0].meanEnergy + out[1].meanEnergy) / 2,
        };
        out.splice(0, 1);
      } else {
        out[i - 1] = {
          startBarIdx: out[i - 1].startBarIdx,
          endBarIdx: out[i].endBarIdx,
          meanEnergy: (out[i - 1].meanEnergy + out[i].meanEnergy) / 2,
        };
        out.splice(i, 1);
        i--;
      }
    } else {
      i++;
    }
  }
  return out;
}

function labelSegmentsByEnergy(
  segments: { meanEnergy: number }[]
): string[] {
  if (segments.length === 0) return [];

  const energies = segments.map(s => s.meanEnergy);
  const sorted = [...energies].sort((a, b) => a - b);
  const highCut = sorted[Math.floor(sorted.length * 0.66)] ?? sorted[sorted.length - 1];
  const lowCut = sorted[Math.floor(sorted.length * 0.33)] ?? sorted[0];

  const labels: string[] = [];
  let verseCount = 0;
  let chorusCount = 0;
  let usedBridge = false;

  for (let i = 0; i < segments.length; i++) {
    const e = energies[i];
    const isFirst = i === 0;
    const isLast = i === segments.length - 1;

    if (isFirst && e <= lowCut) {
      labels.push('Intro');
      continue;
    }
    if (isLast && e <= highCut) {
      labels.push('Outro');
      continue;
    }

    if (e >= highCut) {
      chorusCount++;
      labels.push(chorusCount === 1 ? 'Chorus' : `Chorus ${chorusCount}`);
    } else if (
      !usedBridge &&
      i > 1 &&
      !isLast &&
      e > lowCut &&
      e < highCut &&
      chorusCount >= 1
    ) {
      usedBridge = true;
      labels.push('Bridge');
    } else {
      verseCount++;
      labels.push(verseCount === 1 ? 'V1' : `V${verseCount}`);
    }
  }

  // If labels somehow empty, fall back to structure template
  if (labels.every(l => !l)) {
    return STRUCTURE_LABELS.slice(0, segments.length);
  }
  return labels;
}

/** Even N-bar blocks with sensible worship labels. */
function evenBlockRegions(
  duration: number,
  beats: Beat[],
  barsPerBlock: number
): Region[] {
  const downbeats = beats.filter(b => b.beat === 1);
  if (downbeats.length === 0) {
    // Absolute time fallback: ~8s chunks
    const chunk = Math.max(8, duration / 6);
    const regions: Region[] = [];
    let t = 0;
    let i = 0;
    while (t < duration - 1) {
      const end = Math.min(duration, t + chunk);
      regions.push({
        id: crypto.randomUUID(),
        name: EVEN_BLOCK_LABELS[i % EVEN_BLOCK_LABELS.length] ?? `Section ${i + 1}`,
        start: t,
        end,
        color: REGION_COLORS[i % REGION_COLORS.length],
      });
      t = end;
      i++;
    }
    return regions;
  }

  const regions: Region[] = [];
  let i = 0;
  for (let bar = 0; bar < downbeats.length; bar += barsPerBlock) {
    const start = downbeats[bar].time;
    const endBar = Math.min(bar + barsPerBlock, downbeats.length);
    const end =
      endBar < downbeats.length ? downbeats[endBar].time : duration;
    if (end - start < 0.5) continue;
    regions.push({
      id: crypto.randomUUID(),
      name: EVEN_BLOCK_LABELS[i % EVEN_BLOCK_LABELS.length] ?? `Section ${i + 1}`,
      start: snapToNearestMeasure(start, beats),
      end: Math.min(duration, snapToNearestMeasure(end, beats) || end),
      color: REGION_COLORS[i % REGION_COLORS.length],
    });
    i++;
  }
  return regions;
}

/**
 * Re-detect regions from the song's audio blob.
 * Call only when user explicitly requests re-detect (or on first analyze).
 */
export async function detectRegionsFromBlob(
  audioBlob: Blob,
  beats: Beat[]
): Promise<Region[]> {
  const ctx = new AudioContext();
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return suggestRegions(audioBuffer, beats);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
