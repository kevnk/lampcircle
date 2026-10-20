export const CHROMA_HOP = 0.5;
const FRAME = 8192;
const PEAKS = 1200;
const F_MIN = 55;
const F_MAX = 2000;

/** Waveform peaks (0 to 1) and a chroma series from decoded channels. */
export function analyze(channels: Float32Array[], sampleRate: number): { peaks: number[]; chroma: number[][] } {
  const mono = mix(channels);
  return { peaks: peaks(mono), chroma: chroma(mono, sampleRate) };
}

function mix(channels: Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

function peaks(mono: Float32Array): number[] {
  const size = Math.max(1, Math.floor(mono.length / PEAKS));
  const out: number[] = [];
  for (let start = 0; start < mono.length; start += size) {
    let max = 0;
    const end = Math.min(mono.length, start + size);
    for (let i = start; i < end; i++) max = Math.max(max, Math.abs(mono[i]));
    out.push(max);
  }
  const top = Math.max(1e-9, ...out);
  return out.map(value => Math.round((value / top) * 1000) / 1000);
}

function chroma(mono: Float32Array, sampleRate: number): number[][] {
  const hop = Math.max(1, Math.round(CHROMA_HOP * sampleRate));
  const window = new Float32Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const binPc = new Int8Array(FRAME / 2 + 1).fill(-1);
  for (let k = 1; k <= FRAME / 2; k++) {
    const hz = (k * sampleRate) / FRAME;
    if (hz >= F_MIN && hz <= F_MAX) binPc[k] = (((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12);
  }
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const frames: number[][] = [];
  const levels: number[] = [];
  for (let start = 0; start < mono.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const x = mono[start + i] ?? 0;
      re[i] = x * window[i];
      im[i] = 0;
      energy += x * x;
    }
    fft(re, im);
    const bins = new Array<number>(12).fill(0);
    for (let k = 1; k <= FRAME / 2; k++) {
      if (binPc[k] >= 0) bins[binPc[k]] += Math.hypot(re[k], im[k]);
    }
    frames.push(bins);
    levels.push(Math.sqrt(energy / FRAME));
  }
  // Gate on a percentile, so one loud hit cannot silence the quiet verses.
  const gate = 0.1 * ([...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.9)] ?? 0);
  return frames.map((bins, index) => {
    if (levels[index] < gate) return new Array<number>(12).fill(0);
    const norm = Math.hypot(...bins) || 1;
    return bins.map(value => Math.round((value / norm) * 1000) / 1000);
  });
}

export const ONSET_FPS = 100;
/** Seconds from a flux frame's center to the attack that peaks there. Measured on clicks in scripts/test.ts. */
export const ONSET_LAG = 0.0034;

export interface Onsets {
  /** Spectral flux, ONSET_FPS frames a second: how much new sound starts in each frame. */
  flux: Float32Array;
  /** Flux below this is never a real attack. */
  floor: number;
  /** Flux over its level in the surrounding 3 seconds, minus 1: how much each frame stands out, for following the beat. */
  strength: Float32Array;
}

/** Mono, averaged down to about 22 kHz: enough to hear snare and strum attacks, at a quarter of the work. */
export function downmix(channels: Float32Array[], sampleRate: number): { x: Float32Array; rate: number } {
  const step = Math.max(1, Math.round(sampleRate / 22050));
  const full = mix(channels);
  const x = new Float32Array(Math.floor(full.length / step));
  for (let i = 0; i < x.length; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += full[i * step + j];
    x[i] = sum / step;
  }
  return { x, rate: sampleRate / step };
}

/** Where new sounds start: drum hits, strums, notes. About a second of work for a whole song. */
export function onsets(channels: Float32Array[], sampleRate: number): Onsets {
  const { x, rate } = downmix(channels, sampleRate);
  // 1024 points at about 22 kHz is a 46 ms frame.
  const size = 1024;
  const window = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  // Semitone bands from 40 Hz, so every octave counts the same and cymbals do not drown out the bass.
  const bandOf = new Int16Array(size / 2).fill(-1);
  let bands = 0;
  for (let k = 1; k < size / 2; k++) {
    const hz = (k * rate) / size;
    if (hz >= 40 && hz <= 11000) bands = Math.max(bands, (bandOf[k] = Math.floor(12 * Math.log2(hz / 40))) + 1);
  }
  const frames = Math.ceil((x.length / rate) * ONSET_FPS);
  const flux = new Float32Array(frames);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  let older = new Float32Array(bands);
  let old = new Float32Array(bands);
  let now = new Float32Array(bands);
  for (let n = 0; n < frames; n++) {
    const start = Math.round((n / ONSET_FPS) * rate) - size / 2;
    for (let i = 0; i < size; i++) {
      re[i] = (x[start + i] ?? 0) * window[i];
      im[i] = 0;
    }
    fft(re, im);
    now.fill(0);
    for (let k = 1; k < size / 2; k++) if (bandOf[k] >= 0) now[bandOf[k]] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    for (let b = 0; b < bands; b++) now[b] = Math.log1p(now[b]);
    // SuperFlux: compare with two frames back, widened by a band each way, so vibrato and slides do not count as attacks.
    let sum = 0;
    for (let b = 0; b < bands; b++) sum += Math.max(0, now[b] - Math.max(older[b - 1] ?? 0, older[b], older[b + 1] ?? 0));
    flux[n] = n >= 2 ? sum : 0;
    [older, old, now] = [old, now, older];
  }

  const sorted = Float32Array.from(flux).sort();
  const floor = 0.1 * (sorted[Math.floor(sorted.length * 0.99)] ?? 0);
  const reach = 1.5 * ONSET_FPS;
  const level = new Float32Array(frames);
  let sum = 0;
  for (let n = -reach; n < frames; n++) {
    sum += (flux[n + reach] ?? 0) - (flux[n - reach - 1] ?? 0);
    if (n >= 0) level[n] = sum / (2 * reach + 1);
  }
  // A quiet stretch is measured against a share of the song's usual level, so its noise does not look like beats.
  const quiet = 0.3 * (Float32Array.from(level).sort()[frames >> 1] ?? 0);
  const strength = flux.map((value, n) => Math.min(4, value / Math.max(level[n], quiet, 1e-9)) - 1);
  return { flux, floor, strength };
}

/** The attack nearest t, within `reach` seconds, or null when nothing clear is there. */
export function snapToOnset({ flux, floor }: Onsets, t: number, reach = 0.08): number | null {
  const c = (t - ONSET_LAG) * ONSET_FPS;
  const around = Array.from(flux.subarray(Math.max(0, Math.round(c) - 150), Math.max(0, Math.round(c) + 151))).sort((a, b) => a - b);
  // A real attack clears the song-wide floor and stands well above the 3 seconds around it.
  const clear = Math.max(floor, 3 * (around[around.length >> 1] ?? 0));
  let best = -1;
  let score = 0;
  for (let i = Math.max(1, Math.ceil(c - reach * ONSET_FPS)); i <= Math.min(flux.length - 2, c + reach * ONSET_FPS); i++) {
    if (flux[i] < clear || flux[i] < flux[i - 1] || flux[i] < flux[i + 1]) continue;
    // Nearer attacks win over slightly louder ones further away.
    const s = flux[i] * Math.exp(-0.5 * ((i - c) / (0.05 * ONSET_FPS)) ** 2);
    if (s > score) [best, score] = [i, s];
  }
  return best < 0 ? null : peakTime(flux, best);
}

function peakTime(flux: Float32Array, i: number): number {
  const [a, b, c] = [flux[i - 1] ?? 0, flux[i], flux[i + 1] ?? 0];
  const bend = a - 2 * b + c;
  const shift = bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / bend)) : 0;
  return (i + shift) / ONSET_FPS + ONSET_LAG;
}

/** How hard the follower holds the tempo: the cost of changing the beat length by a fraction, beat to beat. */
const STIFF = 100;
/** The cost of straying from the tapped tempo, per unit of log ratio. Keeps a soft stretch from wandering. */
const PULL = 1;

/**
 * Beats from the beat at `from` towards `to`, following the attacks with the tempo free to drift.
 * `beat` is the beat length in seconds at `from`. Runs backwards when `to` is earlier.
 * With `land`, `to` is a beat too: returns the beats between them, or null when no steady path reaches it.
 * Otherwise the beats run on to `to` at the last tempo where the attacks stop.
 */
export function followBeats(env: Onsets, from: number, beat: number, to: number, land = false): number[] | null {
  const { flux, strength } = env;
  const dir = to >= from ? 1 : -1;
  const frameOf = (t: number) => Math.round((t - ONSET_LAG) * ONSET_FPS);
  const a = frameOf(from);
  const room = dir > 0 ? flux.length - 1 - a : a;
  if (land && Math.abs(frameOf(to) - a) > room) return null;
  const length = Math.min(Math.abs(frameOf(to) - a), room);
  const d0 = beat * ONSET_FPS;
  const dMin = Math.max(2, Math.floor(0.8 * d0));
  const dMax = Math.ceil(1.25 * d0);
  const span = dMax - dMin + 1;
  const turn = Math.max(2, Math.round(0.04 * d0));
  const out: number[] = [];

  if (length >= dMin) {
    // score[s * span + d - dMin]: best path with a beat s frames from the anchor whose previous beat was d frames before it.
    const score = new Float32Array((length + 1) * span).fill(-Infinity);
    const back = new Int8Array((length + 1) * span);
    for (let s = dMin; s <= length; s++) {
      const gain = strength[a + dir * s];
      for (let d = dMin; d <= Math.min(dMax, s); d++) {
        const m = s - d;
        let best = -Infinity;
        let change = 0;
        if (m === 0) {
          best = -STIFF * Math.abs(d / d0 - 1);
        } else {
          for (let p = Math.max(dMin, d - turn); p <= Math.min(dMax, d + turn); p++) {
            const value = score[m * span + p - dMin] - STIFF * Math.abs(d / p - 1);
            if (value > best) [best, change] = [value, p - d];
          }
        }
        score[s * span + d - dMin] = best + gain - PULL * Math.abs(Math.log(d / d0));
        back[s * span + d - dMin] = change;
      }
    }
    let end = -1;
    let endD = 0;
    let top = -Infinity;
    for (let s = land ? length : Math.max(dMin, length - dMax + 1); s <= length; s++) {
      for (let d = dMin; d <= dMax; d++) {
        if (score[s * span + d - dMin] > top) [top, end, endD] = [score[s * span + d - dMin], s, d];
      }
    }
    if (end < 0) return land ? null : [];
    for (let s = end, d = endD; s > 0; ) {
      out.push(a + dir * s);
      const next = d + back[s * span + d - dMin];
      s -= d;
      d = next;
    }
  } else if (land) {
    return null;
  }

  const times = out.reverse().map(f => {
    // Each beat moves onto the attack it sits on, if there is one within two frames.
    let peak = f;
    for (let i = f - 2; i <= f + 2; i++) if (flux[i] > flux[peak]) peak = i;
    return flux[peak] >= env.floor ? peakTime(flux, peak) : f / ONSET_FPS + ONSET_LAG;
  });
  if (land) {
    // The path ends on `to`, which is already a beat.
    times.pop();
  } else {
    // A beat moved onto an attack can cross the end it was walking to.
    while (times.length && (dir > 0 ? times[times.length - 1] >= to : times[times.length - 1] < to)) times.pop();
    const last = times[times.length - 1] ?? from;
    const step = Math.abs(last - (times[times.length - 2] ?? from)) || beat;
    for (let t = last + dir * step; dir > 0 ? t < to - 0.05 : t >= to; t += dir * step) times.push(t);
  }
  return dir > 0 ? times : times.reverse();
}

/** Sum of chroma frames that start inside [start, end). */
export function sectionChroma(series: number[][], start: number, end: number): number[] {
  const sum = new Array<number>(12).fill(0);
  const first = Math.max(0, Math.ceil(start / CHROMA_HOP));
  for (let f = first; f < series.length && f * CHROMA_HOP < end; f++) {
    for (let p = 0; p < 12; p++) sum[p] += series[f][p];
  }
  return sum;
}

const twiddleCache = new Map<number, [Float64Array, Float64Array]>();
function twiddles(n: number): [Float64Array, Float64Array] {
  let table = twiddleCache.get(n);
  if (!table) {
    table = [new Float64Array(n / 2), new Float64Array(n / 2)];
    for (let k = 0; k < n / 2; k++) {
      table[0][k] = Math.cos((-2 * Math.PI * k) / n);
      table[1][k] = Math.sin((-2 * Math.PI * k) / n);
    }
    twiddleCache.set(n, table);
  }
  return table;
}

/** In-place iterative radix-2 FFT. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i];
      re[i] = re[j];
      re[j] = r;
      const m = im[i];
      im[i] = im[j];
      im[j] = m;
    }
  }
  const [cos, sin] = twiddles(n);
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = i + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}
