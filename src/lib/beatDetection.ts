import { Beat, LoopSnapMode } from '../types';

export async function detectBeats(audioBuffer: AudioBuffer): Promise<Beat[]> {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);
  
  const fftSize = 2048;
  const hopSize = 512;
  const numFrames = Math.floor((channelData.length - fftSize) / hopSize);
  
  const energyValues: number[] = [];
  
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    const end = start + fftSize;
    let energy = 0;
    
    for (let j = start; j < end && j < channelData.length; j++) {
      energy += channelData[j] * channelData[j];
    }
    
    energyValues.push(energy / fftSize);
  }
  
  const smoothedEnergy: number[] = [];
  const windowSize = 10;
  
  for (let i = 0; i < energyValues.length; i++) {
    let sum = 0;
    let count = 0;
    
    for (let j = Math.max(0, i - windowSize); j < Math.min(energyValues.length, i + windowSize); j++) {
      sum += energyValues[j];
      count++;
    }
    
    smoothedEnergy.push(sum / count);
  }
  
  const threshold = smoothedEnergy.reduce((a, b) => a + b, 0) / smoothedEnergy.length * 1.5;
  
  const onsets: number[] = [];
  
  for (let i = 1; i < energyValues.length - 1; i++) {
    if (energyValues[i] > threshold &&
        energyValues[i] > energyValues[i - 1] &&
        energyValues[i] > energyValues[i + 1]) {
      
      if (onsets.length === 0 || (i * hopSize / sampleRate) - onsets[onsets.length - 1] > 0.1) {
        onsets.push(i * hopSize / sampleRate);
      }
    }
  }
  
  if (onsets.length < 4) {
    return generateDefaultBeats(audioBuffer.duration);
  }
  
  const intervals: number[] = [];
  for (let i = 1; i < Math.min(onsets.length, 50); i++) {
    intervals.push(onsets[i] - onsets[i - 1]);
  }
  
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  
  const estimatedBPM = Math.round(60 / medianInterval);
  const beatInterval = 60 / estimatedBPM;
  
  const beats: Beat[] = [];
  let time = 0;
  let bar = 1;
  let beat = 1;
  
  const firstOnset = onsets[0] || 0;
  time = firstOnset;
  
  while (time < audioBuffer.duration) {
    const confidence = calculateBeatConfidence(time, onsets, beatInterval);
    
    beats.push({
      time,
      bar,
      beat,
      confidence
    });
    
    time += beatInterval;
    beat++;
    
    if (beat > 4) {
      beat = 1;
      bar++;
    }
  }
  
  return beats;
}

function calculateBeatConfidence(beatTime: number, onsets: number[], beatInterval: number): number {
  const tolerance = beatInterval * 0.15;
  
  for (const onset of onsets) {
    if (Math.abs(onset - beatTime) < tolerance) {
      return 0.9;
    }
  }
  
  return 0.5;
}

function generateDefaultBeats(duration: number): Beat[] {
  const bpm = 120;
  const beatInterval = 60 / bpm;
  const beats: Beat[] = [];
  
  let time = 0;
  let bar = 1;
  let beat = 1;
  
  while (time < duration) {
    beats.push({
      time,
      bar,
      beat,
      confidence: 0.3
    });
    
    time += beatInterval;
    beat++;
    
    if (beat > 4) {
      beat = 1;
      bar++;
    }
  }
  
  return beats;
}

export function estimateBPM(beats: Beat[]): number {
  if (beats.length < 2) return 120;
  
  const intervals: number[] = [];
  
  for (let i = 1; i < Math.min(beats.length, 50); i++) {
    intervals.push(beats[i].time - beats[i - 1].time);
  }
  
  if (intervals.length === 0) return 120;
  
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];
  
  return Math.round(60 / medianInterval);
}

export function adjustBeatGrid(beats: Beat[], offsetSeconds: number): Beat[] {
  return beats.map(beat => ({
    ...beat,
    time: Math.max(0, beat.time + offsetSeconds)
  }));
}

export function snapToNearestBeat(time: number, beats: Beat[]): number {
  if (beats.length === 0) return time;
  
  let closest = beats[0];
  let minDistance = Math.abs(time - beats[0].time);
  
  for (const beat of beats) {
    const distance = Math.abs(time - beat.time);
    if (distance < minDistance) {
      minDistance = distance;
      closest = beat;
    }
  }
  
  return closest.time;
}

export function findNextBarBoundary(currentTime: number, beats: Beat[]): number {
  const nextBarBeats = beats.filter(b => b.beat === 1 && b.time > currentTime);
  
  if (nextBarBeats.length > 0) {
    return nextBarBeats[0].time;
  }
  
  return currentTime;
}


/** Beat duration in seconds from BPM or median spacing of the grid. */
export function getBeatDurationSeconds(beats: Beat[], bpm?: number): number {
  if (bpm && bpm > 0) return 60 / bpm;
  if (beats.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < Math.min(beats.length, 50); i++) {
      intervals.push(beats[i].time - beats[i - 1].time);
    }
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      return intervals[Math.floor(intervals.length / 2)];
    }
  }
  return 0.5; // 120 BPM fallback
}

export function snapToNearestMeasure(time: number, beats: Beat[]): number {
  if (beats.length === 0) return time;
  const downbeats = beats.filter(b => b.beat === 1);
  const pool = downbeats.length > 0 ? downbeats : beats;
  let closest = pool[0];
  let minDistance = Math.abs(time - pool[0].time);
  for (const beat of pool) {
    const distance = Math.abs(time - beat.time);
    if (distance < minDistance) {
      minDistance = distance;
      closest = beat;
    }
  }
  return closest.time;
}

/** Snap a loop/region point according to snap mode. */
export function snapLoopPoint(
  time: number,
  beats: Beat[],
  mode: LoopSnapMode
): number {
  if (mode === 'off' || beats.length === 0) return time;
  if (mode === 'measure') return snapToNearestMeasure(time, beats);
  return snapToNearestBeat(time, beats);
}
