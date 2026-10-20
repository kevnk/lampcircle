import type { PartWindow } from '../types';

export function scheduleEntry(
  current: PartWindow,
  next: PartWindow,
  playhead: number,
  beatDur: number
): { at: number; seekTo: number } {
  const len = Math.max(0.05, current.musicalEnd - current.landing);
  const lead = Math.max(0, next.landing - next.audioStart);
  const switchFromStart = Math.max(0, len - lead);
  const deadlineFromStart = Math.max(0, switchFromStart - Math.max(0, beatDur));
  let base = current.landing;
  if (playhead >= current.musicalEnd) {
    const laps = Math.floor((playhead - current.landing) / len);
    base = current.landing + Math.max(0, laps) * len;
  }
  let at = base + switchFromStart;
  const deadline = base + deadlineFromStart;
  if (playhead > deadline) at += len;
  if (at <= playhead) at += len;
  return { at, seekTo: next.audioStart };
}
