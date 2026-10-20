import { Beat, LyricLine, Region } from '../types';

/** Find the lyric line active at a given time. */
export function getLyricAtTime(
  lines: LyricLine[] | undefined,
  time: number
): LyricLine | null {
  if (!lines || lines.length === 0) return null;
  for (const line of lines) {
    const end = line.endTime ?? Number.POSITIVE_INFINITY;
    if (time >= line.startTime && time < end) return line;
  }
  return null;
}

/** Lyric text shown on a beat row (line whose start is closest at/before this beat). */
export function getLyricForBeat(
  lines: LyricLine[] | undefined,
  beat: Beat,
  beatIndex: number,
  beats: Beat[]
): string {
  if (!lines || lines.length === 0) return '';
  const nextTime =
    beatIndex + 1 < beats.length ? beats[beatIndex + 1].time : beat.time + 10;
  const exact = lines.find(
    l => l.startTime >= beat.time - 0.001 && l.startTime < nextTime
  );
  if (exact) return exact.text;
  const byIndex = lines.find(l => l.beatIndex === beatIndex);
  if (byIndex) return byIndex.text;
  return '';
}

/**
 * Distribute plain lyric lines evenly across beats (optionally limited to a region).
 * One line per beat when there are enough beats; otherwise spaced evenly.
 */
export function distributeLyricsAcrossBeats(
  plainText: string,
  beats: Beat[],
  region?: Region | null
): LyricLine[] {
  const lines = plainText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0 || beats.length === 0) return [];

  let targetBeats = beats;
  if (region) {
    targetBeats = beats.filter(
      b => b.time >= region.start - 0.001 && b.time <= region.end + 0.001
    );
    if (targetBeats.length === 0) targetBeats = beats;
  }

  const result: LyricLine[] = [];
  if (lines.length <= targetBeats.length) {
    // Spread lines evenly across the beat range
    for (let i = 0; i < lines.length; i++) {
      const beatPos =
        lines.length === 1
          ? 0
          : Math.round((i / (lines.length - 1)) * (targetBeats.length - 1));
      const beat = targetBeats[Math.min(beatPos, targetBeats.length - 1)];
      const globalIndex = beats.indexOf(beat);
      const nextBeat = targetBeats[Math.min(beatPos + 1, targetBeats.length - 1)];
      // End at next lyric's start or next beat
      const nextStartBeatIndex =
        i + 1 < lines.length
          ? Math.round(((i + 1) / (lines.length - 1 || 1)) * (targetBeats.length - 1))
          : Math.min(beatPos + 1, targetBeats.length - 1);
      const end =
        i + 1 < lines.length
          ? targetBeats[Math.min(nextStartBeatIndex, targetBeats.length - 1)].time
          : nextBeat.time;

      result.push({
        id: crypto.randomUUID(),
        text: lines[i],
        startTime: beat.time,
        endTime: end > beat.time ? end : beat.time + 0.5,
        beatIndex: globalIndex >= 0 ? globalIndex : beatPos,
      });
    }
  } else {
    // More lines than beats: pack multiple lines per beat by joining, or assign sequentially wrapping
    for (let i = 0; i < lines.length; i++) {
      const beatPos = i % targetBeats.length;
      const beat = targetBeats[beatPos];
      const globalIndex = beats.indexOf(beat);
      const next =
        targetBeats[Math.min(beatPos + 1, targetBeats.length - 1)];
      result.push({
        id: crypto.randomUUID(),
        text: lines[i],
        startTime: beat.time + (Math.floor(i / targetBeats.length) * 0.01),
        endTime: next.time,
        beatIndex: globalIndex >= 0 ? globalIndex : beatPos,
      });
    }
  }

  // Fix overlapping ends: sort and set endTime to next start
  result.sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < result.length; i++) {
    if (i + 1 < result.length) {
      result[i].endTime = result[i + 1].startTime;
    }
  }
  return result;
}

/** Assign a single line of text to a specific beat. */
export function assignLyricToBeat(
  existing: LyricLine[] | undefined,
  text: string,
  beatIndex: number,
  beats: Beat[]
): LyricLine[] {
  const lines = [...(existing || [])].filter(l => l.beatIndex !== beatIndex);
  if (!text.trim() || beatIndex < 0 || beatIndex >= beats.length) return lines;
  const beat = beats[beatIndex];
  const next = beatIndex + 1 < beats.length ? beats[beatIndex + 1] : null;
  lines.push({
    id: crypto.randomUUID(),
    text: text.trim(),
    startTime: beat.time,
    endTime: next ? next.time : beat.time + 0.5,
    beatIndex,
  });
  lines.sort((a, b) => a.startTime - b.startTime);
  return lines;
}
