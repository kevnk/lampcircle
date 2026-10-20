import type { Pad, Song } from '../types';
import { getAudio } from '../lib/db';
import { barBeatAt, barSeconds, beatPos, beatTime, sectionViews, songGrid, upper, type Grid, type SectionView } from '../lib/songMap';
import { clockBoundary, decideNext, fadeCurve, fadeOutSpan, fadeOutStart, leadIn, nextBoundary, seamEnd, type Reason } from '../lib/performPlan';

const COMMIT_AHEAD = 3;
const MIN_RAMP = 0.005;

interface Bus {
  ctx: AudioContext;
  song: GainNode;
  pad: GainNode;
  click: GainNode;
  meter: AnalyserNode;
  /** True when the click has its own outputs (channels 3 and 4). */
  ears: boolean;
}

let bus: Bus | null = null;

export function audio(): Bus {
  if (bus) return bus;
  const ctx = new AudioContext();
  const main = ctx.createGain();
  const song = ctx.createGain();
  const pad = ctx.createGain();
  const click = ctx.createGain();
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  song.connect(main);
  pad.connect(main);
  pad.gain.value = 0.8;
  main.connect(meter);
  const out = ctx.destination;
  const ears = out.maxChannelCount >= 4;
  if (ears) {
    out.channelCount = 4;
    out.channelCountMode = 'explicit';
    out.channelInterpretation = 'discrete';
    const stereo = ctx.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    stereo.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(4);
    main.connect(stereo).connect(split);
    split.connect(merge, 0, 0);
    split.connect(merge, 1, 1);
    click.connect(merge, 0, 2);
    click.connect(merge, 0, 3);
    merge.connect(out);
  } else {
    main.connect(out);
    click.connect(out);
  }
  bus = { ctx, song, pad, click, meter, ears };
  return bus;
}

export function now(): number {
  return audio().ctx.currentTime;
}

/** Output level, 0 to 1. */
export function level(): number {
  const data = new Float32Array(audio().meter.fftSize);
  audio().meter.getFloatTimeDomainData(data);
  return Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
}

const buffers = new Map<string, Promise<AudioBuffer>>();

export function loadBuffer(id: string): Promise<AudioBuffer> {
  let buffer = buffers.get(id);
  if (!buffer) {
    buffer = getAudio(id).then(async blob => {
      if (!blob) throw new Error('The audio for this item is missing.');
      return audio().ctx.decodeAudioData(await blob.arrayBuffer());
    });
    buffers.set(id, buffer);
    buffer.catch(() => buffers.delete(id));
  }
  return buffer;
}

/** Drop decoded audio that is no longer needed. A 5-minute song is about 100 MB decoded. */
export function release(keep: string[]) {
  for (const id of buffers.keys()) if (!keep.includes(id) && id !== transport.id) buffers.delete(id);
}

export function decode(blob: Blob): Promise<AudioBuffer> {
  return blob.arrayBuffer().then(data => audio().ctx.decodeAudioData(data));
}

/** Scheduled gain points, joined by straight lines. The gain holds the first value before them and the last after. */
type Points = Array<{ t: number; v: number }>;

interface Fader {
  gain: GainNode;
  /** Kept so a new fade can start from the gain at any time, even partway through another fade. */
  points: Points;
}

interface Voice extends Fader {
  source: AudioBufferSourceNode;
}

function play(buffer: AudioBuffer, to: GainNode, at: number, offset: number): Voice {
  const { ctx } = audio();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain).connect(to);
  source.start(at, Math.max(0, offset));
  source.onended = () => gain.disconnect();
  return { source, gain, points: [] };
}

/** A gain that has no points yet is silent: every gain here starts at 0. */
function valueAt(points: Points, t: number): number {
  const i = points.findIndex(point => point.t > t);
  if (i === -1) return points[points.length - 1]?.v ?? 0;
  if (i === 0) return points[0].v;
  const a = points[i - 1];
  const b = points[i];
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/**
 * Fade the gain on an equal-power curve from its value at `start` to `value` at `end`.
 * A linear ramp runs from the previous event, so the curve's first point pins the start. Without it, a fade
 * scheduled after the last ramp had finished ran from that ramp's end, and the gain dropped at once.
 */
function fadeTo(fader: Fader, value: number, start: number, end: number) {
  const param = fader.gain.gain;
  const curve = fadeCurve(valueAt(fader.points, start), value, start, Math.max(end, start + MIN_RAMP));
  param.cancelScheduledValues(start);
  for (const point of curve) param.linearRampToValueAtTime(point.v, point.t);
  fader.points = [...fader.points.filter(point => point.t < start), ...curve];
}

/** Undo a fade that starts at `from`: put back the points it replaced. */
function restore(fader: Fader, points: Points, from: number) {
  fader.gain.gain.cancelScheduledValues(from);
  for (const point of points) if (point.t >= from) fader.gain.gain.linearRampToValueAtTime(point.v, point.t);
  fader.points = points;
}

function stop(voice: Voice, at?: number) {
  try {
    voice.source.stop(at);
  } catch {
    // Already stopped.
  }
}

function click(at: number, accent: boolean) {
  const { ctx, click: out } = audio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1100;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.6, at + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
  osc.connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + 0.08);
}

/** Plain playback for the editor screens. */
class Transport {
  id: string | null = null;
  buffer: AudioBuffer | null = null;
  private voice: Voice | null = null;
  private startedCtx = 0;
  private offset = 0;
  private listeners = new Set<() => void>();

  /** For useSyncExternalStore: tells screens when play state changes. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private changed() {
    this.listeners.forEach(listener => listener());
  }

  async load(id: string) {
    if (this.id === id && this.buffer) return;
    this.pause();
    this.id = id;
    this.buffer = null;
    this.offset = 0;
    const buffer = await loadBuffer(id);
    if (this.id === id) this.buffer = buffer;
  }

  get playing() {
    return this.voice !== null;
  }

  position(): number {
    if (!this.voice) return this.offset;
    const t = this.offset + now() - this.startedCtx;
    if (this.buffer && t >= this.buffer.duration) {
      this.release(this.buffer.duration);
      return this.offset;
    }
    return t;
  }

  /** The playhead as the listener hears it: sound takes a moment to reach the speakers, much longer over Bluetooth. */
  heard(): number {
    const t = this.position();
    if (!this.voice) return t;
    const { ctx } = audio();
    return Math.max(0, t - (ctx.baseLatency || 0) - (ctx.outputLatency || 0));
  }

  play() {
    if (!this.buffer || this.voice) return;
    const { ctx, song } = audio();
    void ctx.resume();
    if (this.offset >= this.buffer.duration - 0.05) this.offset = 0;
    this.startedCtx = ctx.currentTime + 0.01;
    this.voice = play(this.buffer, song, this.startedCtx, this.offset);
    fadeTo(this.voice, 1, this.startedCtx, this.startedCtx + MIN_RAMP);
    this.changed();
  }

  pause() {
    if (this.voice) this.release(this.offset + now() - this.startedCtx);
  }

  private release(at: number) {
    const voice = this.voice!;
    this.voice = null;
    this.offset = at;
    fadeTo(voice, 0, now(), now() + 0.02);
    stop(voice, now() + 0.03);
    this.changed();
  }

  toggle() {
    if (this.voice) this.pause();
    else this.play();
  }

  seek(t: number) {
    const wasPlaying = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(t, this.buffer?.duration ?? t));
    if (wasPlaying) this.play();
  }
}

export const transport = new Transport();

export interface PerfSong {
  song: Song;
  buffer: AudioBuffer;
  grid: Grid;
  views: SectionView[];
}

export async function perfSong(song: Song): Promise<PerfSong> {
  return { song, buffer: await loadBuffer(song.id), grid: songGrid(song), views: sectionViews(song) };
}

interface Segment {
  idx: number;
  pass: number;
  reason: Reason;
  landingCtx: number;
  landingAudio: number;
  seamAudio: number;
  startCtx: number;
  /** When the previous segment starts fading for this one. Before then, this segment can be revoked. */
  prevFadeCtx: number;
  /** When the previous segment has faded out. It can ring past this one's landing. */
  prevEndCtx: number;
  /** The previous segment's gain before this one faded it out. Revoking puts it back. */
  prevPoints: Points;
  voice: Voice;
}

type Planned = { idx: number; pass: number; reason: Reason; boundaryAudio: number } | 'end' | null;

export interface PadClock {
  anchor: number;
  bar: number;
  barLen: number;
  beatsPerBar: number;
}

export interface Snapshot {
  paused: boolean;
  song: null | {
    title: string;
    idx: number;
    pass: number;
    repeats: number;
    hold: boolean;
    bar: number;
    beat: number;
    beatsPerBar: number;
    /** Audio seconds of the segment now playing. */
    pos: number;
    barsLeft: number;
    secondsLeft: number;
    next: null | { idx: number; reason: Reason; bars: number; beats: number; landingCtx: number };
    ending: boolean;
  };
  pad: null | { tonic: number; since: number; next: { tonic: number; at: number } | null };
  clock: null | { bar: number; beat: number; beatsPerBar: number };
}

/** The downloaded pad recording for a key, or null when the library has none. */
export type PadSource = (tonic: number) => Promise<Blob | null>;

/**
 * Pads are 8-minute recordings, about 180 MB each once decoded, so they stream from an audio element.
 * The element starts muted and the gain ramp is scheduled on the audio clock, so fades still land on the beat.
 */
interface PadVoice extends Fader {
  tonic: number;
  at: number;
  el: HTMLAudioElement;
  /** Audio time after which the voice is silent and can be released. */
  until: number;
}

function releasePad(pad: PadVoice) {
  pad.el.pause();
  URL.revokeObjectURL(pad.el.src);
  pad.gain.disconnect();
}

/** Plays a set: section passes with pickups and seams, picks, hold, and pads between songs. */
export class PerformSession {
  ps: PerfSong | null = null;
  segments: Segment[] = [];
  planned: Planned = null;
  pick: number | null = null;
  holding = false;
  /** Audition: loop one section. `until` ends the last pass early, at that audio time. */
  only: { idx: number; passes: number; until?: number } | undefined;
  endAt: number | null = null;
  /** Set by "End song now". Picks and hold no longer apply. */
  forced = false;
  onSongEnd: (() => void) | null = null;
  padSource: PadSource;
  pads: PadVoice[] = [];
  private fading: PadVoice[] = [];
  /** Passes that have handed over but still ring out their fade-out. */
  private tails: Array<{ voice: Voice; end: number }> = [];
  private padTicket = 0;
  clock: PadClock | null = null;
  private timer: number;

  constructor(padSource: PadSource) {
    this.padSource = padSource;
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  dispose() {
    window.clearInterval(this.timer);
    for (const segment of this.segments) stop(segment.voice);
    for (const tail of this.tails) stop(tail.voice);
    this.padTicket++;
    [...this.pads, ...this.fading].forEach(releasePad);
    this.segments = [];
    this.pads = [];
    this.fading = [];
    void audio().ctx.resume();
  }

  startSong(ps: PerfSong, options: { from: number; landingCtx?: number; passes?: number; until?: number }) {
    for (const segment of this.segments) stop(segment.voice);
    for (const tail of this.tails) stop(tail.voice);
    this.tails = [];
    void audio().ctx.resume();
    this.ps = ps;
    this.segments = [];
    this.planned = null;
    this.pick = null;
    this.holding = false;
    this.endAt = null;
    this.forced = false;
    this.only = options.passes ? { idx: options.from, passes: options.passes, until: options.until } : undefined;
    const view = ps.views[options.from];
    const lead = view.start - leadIn(view, ps.grid).audioStart;
    this.enter(options.from, 1, 'plan', options.landingCtx ?? now() + 0.1 + lead, null, 0);
    this.tick();
  }

  /** Bring in the next song on the pad clock, with an optional one-bar count-in at its own tempo. */
  startNext(ps: PerfSong, options: { from: number; countIn: boolean; keepPad: boolean; crossfade: number }) {
    const view = ps.views[options.from];
    const lead = view.start - leadIn(view, ps.grid).audioStart;
    const bar = barSeconds(ps.grid, view.s);
    const earliest = now() + Math.max(lead, options.countIn ? bar : 0) + 0.05;
    const landing = this.clock ? clockBoundary(this.clock.anchor, this.clock.barLen, earliest) : earliest;
    if (options.countIn) {
      for (let k = 0; k < ps.song.beatsPerBar; k++) click(landing - bar + (k * bar) / ps.song.beatsPerBar, k === 0);
    }
    this.fadePads(landing, options.keepPad ? landing + 8 * bar : landing + options.crossfade);
    this.startSong(ps, { from: options.from, landingCtx: landing });
    return landing;
  }

  pickSection(idx: number) {
    const queued = this.segments[1]?.reason === 'pick' ? this.segments[1].idx : this.planned && this.planned !== 'end' && this.planned.reason === 'pick' ? this.planned.idx : null;
    if (queued === idx) return this.cancel();
    this.pick = idx;
    this.holding = false;
    this.replan();
  }

  cancel() {
    this.pick = null;
    this.replan();
  }

  /** Audition: change how many passes play, while it plays. Too late once the last pass has landed. */
  setPasses(passes: number) {
    if (!this.only) return;
    this.only.passes = passes;
    if (this.planned === 'end' && this.endAt === null) this.planned = null;
  }

  toggleHold() {
    this.holding = !this.holding;
    this.pick = null;
    this.replan();
  }

  endSong(bars = 2) {
    const ps = this.ps;
    const current = this.segments[0];
    if (!ps || !current) return;
    this.revoke();
    const t = now();
    const end = t + bars * barSeconds(ps.grid, ps.views[current.idx].s);
    for (const segment of this.segments) {
      fadeTo(segment.voice, 0, t, end);
      stop(segment.voice, end + 0.05);
    }
    this.planned = 'end';
    this.endAt = end;
    this.forced = true;
  }

  async pause() {
    await audio().ctx.suspend();
    for (const pad of [...this.pads, ...this.fading]) pad.el.pause();
  }

  async resume() {
    await audio().ctx.resume();
    for (const pad of [...this.pads, ...this.fading]) void pad.el.play();
  }

  /** Start or change the pad. The new pad fades in from `at` while the old one fades out. */
  async setPad(tonic: number, at: number, fade: number) {
    const ticket = ++this.padTicket;
    const blob = await this.padSource(tonic);
    if (!blob || ticket !== this.padTicket) return;
    const { ctx, pad: out } = audio();
    const el = new Audio(URL.createObjectURL(blob));
    el.loop = true;
    el.preload = 'auto';
    await new Promise<void>(resolve => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => resolve();
    });
    // Skip the recording's own fade-in.
    el.currentTime = Math.min(10, (el.duration || 0) * 0.1);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(out);
    await el.play().catch(() => undefined);
    const pad: PadVoice = { tonic, at, el, gain, points: [], until: Infinity };
    if (ticket !== this.padTicket) return releasePad(pad);
    const start = Math.max(at, now() + 0.02);
    pad.at = start;
    fadeTo(pad, 1, start, start + fade);
    for (const old of this.pads) {
      fadeTo(old, 0, start, start + fade);
      old.until = start + fade + 0.1;
    }
    this.fading.push(...this.pads);
    this.pads = [pad];
  }

  /** Pad that fades in under the song at its next phrase. */
  goToPad(tonic: number) {
    const ps = this.ps;
    const current = this.segments[0];
    if (!ps || !current) return void this.setPad(tonic, now(), 2);
    const view = ps.views[current.idx];
    const pos = current.landingAudio + Math.max(0, now() - current.landingCtx);
    const boundary = nextBoundary('phrase', pos + 0.05, view, ps.grid, current.seamAudio);
    const at = current.landingCtx + (boundary - current.landingAudio);
    void this.setPad(tonic, at, 2 * barSeconds(ps.grid, view.s));
  }

  fadePads(start: number, end: number) {
    this.padTicket++;
    for (const pad of this.pads) {
      fadeTo(pad, 0, start, end);
      pad.until = end + 0.1;
    }
    this.fading.push(...this.pads);
    this.pads = [];
  }

  padBoundary(rule: 'beat' | 'bar', earliest = now() + 0.05): number {
    if (!this.clock) return earliest;
    const period = rule === 'bar' ? this.clock.barLen : this.clock.barLen / this.clock.beatsPerBar;
    return clockBoundary(this.clock.anchor, period, earliest);
  }

  setPadVolume(value: number) {
    audio().pad.gain.setTargetAtTime(value, now(), 0.05);
  }

  /** Bars keep counting after a song ends. Practice starts a fresh clock at the given tempo. */
  startClock(barLen: number, beatsPerBar: number, bar = 1) {
    this.clock = { anchor: now(), bar, barLen, beatsPerBar };
  }

  private replan() {
    if (this.forced || this.only) return;
    this.revoke();
    this.planned = null;
    this.endAt = null;
    this.tick();
  }

  /** Undo committed transitions that have not started sounding yet. */
  private revoke() {
    const t = now();
    while (this.segments.length > 1) {
      const last = this.segments[this.segments.length - 1];
      if (t + 0.03 >= Math.min(last.startCtx, last.prevFadeCtx)) break;
      stop(last.voice);
      last.voice.gain.disconnect();
      this.segments.pop();
      restore(this.segments[this.segments.length - 1].voice, last.prevPoints, last.prevFadeCtx);
    }
  }

  private enter(idx: number, pass: number, reason: Reason, landing: number, prev: Segment | null, boundaryAudio: number) {
    const ps = this.ps!;
    const view = ps.views[idx];
    const { audioStart, singerStart } = leadIn(view, ps.grid);
    const t = now();
    let startCtx = landing - (view.start - audioStart);
    let offset = audioStart;
    if (startCtx < t + 0.02) {
      const late = t + 0.02 - startCtx;
      startCtx += late;
      offset += late;
    }
    const voice = play(ps.buffer, audio().song, startCtx, offset);
    fadeTo(voice, 1, startCtx, landing - (view.start - singerStart));
    let prevFadeCtx = Infinity;
    let prevEndCtx = landing;
    let prevPoints: Points = [];
    if (prev) {
      const fade = fadeOutSpan(ps.views[prev.idx], ps.grid, boundaryAudio);
      prevFadeCtx = Math.max(t + 0.01, landing - (boundaryAudio - fade.start));
      prevEndCtx = landing + (fade.end - boundaryAudio);
      prevPoints = prev.voice.points;
      fadeTo(prev.voice, 0, prevFadeCtx, prevEndCtx);
    }
    this.segments.push({
      idx,
      pass,
      reason,
      landingCtx: landing,
      landingAudio: view.start,
      seamAudio: seamEnd(view, ps.grid, ps.buffer.duration),
      startCtx,
      prevFadeCtx,
      prevEndCtx,
      prevPoints,
      voice,
    });
  }

  private decide(tail: Segment): Exclude<Planned, null> {
    const ps = this.ps!;
    const view = ps.views[tail.idx];
    const next = decideNext({
      idx: tail.idx,
      pass: tail.pass,
      repeats: view.section.repeats,
      count: ps.views.length,
      hold: this.holding,
      pick: this.pick,
      only: this.only,
    });
    if (next === 'end') return 'end';
    const pos = tail.landingAudio + Math.max(0, now() - tail.landingCtx);
    // Only a song's last pass plays past its seam, into the ring-out. A hold or pick there lands on the next bar line.
    const late = pos > tail.seamAudio - 0.01;
    if (next.reason !== 'pick' && !late) return { ...next, boundaryAudio: tail.seamAudio };
    if (next.reason === 'pick') this.pick = null;
    const target = ps.views[next.idx];
    const lead = target.start - leadIn(target, ps.grid).audioStart;
    const end = late ? ps.buffer.duration : tail.seamAudio;
    const boundary = nextBoundary(late ? 'bar' : view.section.jumpAt, pos + lead + 0.05, view, ps.grid, end);
    if (late && boundary >= end - 0.01) return 'end';
    return { ...next, boundaryAudio: boundary };
  }

  tick() {
    const t = now();
    const ps = this.ps;
    const done = this.fading.filter(pad => t >= pad.until);
    if (done.length) {
      done.forEach(releasePad);
      this.fading = this.fading.filter(pad => t < pad.until);
    }
    if (!ps || this.segments.length === 0) return;
    while (this.segments.length > 1 && t >= this.segments[1].landingCtx) {
      const old = this.segments.shift()!;
      const end = Math.max(t, this.segments[0].prevEndCtx) + 0.1;
      stop(old.voice, end);
      this.tails = [...this.tails.filter(tail => tail.end > t), { voice: old.voice, end }];
    }
    for (let guard = 0; guard < 8; guard++) {
      const tail = this.segments[this.segments.length - 1];
      const planned = this.planned ?? this.decide(tail);
      this.planned = planned;
      if (planned === 'end') break;
      const landing = tail.landingCtx + (planned.boundaryAudio - tail.landingAudio);
      const view = ps.views[planned.idx];
      if (t < landing - (view.start - leadIn(view, ps.grid).audioStart) - COMMIT_AHEAD) break;
      const { idx, pass, reason, boundaryAudio } = planned;
      this.planned = null;
      this.enter(idx, pass, reason, landing, tail, boundaryAudio);
    }
    if (this.planned === 'end' && this.segments.length === 1 && this.endAt === null) {
      const tail = this.segments[0];
      const endAudio = this.only ? (this.only.until ?? tail.seamAudio) : ps.buffer.duration;
      this.endAt = tail.landingCtx + (endAudio - tail.landingAudio);
      if (this.only) {
        // An early stop fades over one beat, whatever the section's own fade-out.
        const fadeAudio =
          this.only.until === undefined ? fadeOutStart(ps.views[tail.idx], ps.grid, endAudio) : beatTime(ps.grid, beatPos(ps.grid, endAudio) - 1);
        fadeTo(tail.voice, 0, Math.max(t, this.endAt - (endAudio - fadeAudio)), this.endAt);
        stop(tail.voice, this.endAt + 0.05);
      }
    }
    if (this.endAt !== null && t >= this.endAt) this.finishSong();
  }

  private finishSong() {
    const ps = this.ps!;
    const last = this.segments[0];
    if (last) {
      const pos = last.landingAudio + (now() - last.landingCtx);
      const d = ps.grid.downbeats;
      const i = Math.max(0, upper(d, pos) - 1);
      const barLen = barSeconds(ps.grid, i);
      this.clock = {
        anchor: last.landingCtx + (d[i] - last.landingAudio),
        bar: i + 1,
        barLen,
        beatsPerBar: ps.song.beatsPerBar,
      };
    }
    for (const segment of this.segments) stop(segment.voice, now() + 0.05);
    this.segments = [];
    this.planned = null;
    this.endAt = null;
    this.ps = null;
    this.onSongEnd?.();
  }

  snapshot(): Snapshot {
    const t = now();
    const ps = this.ps;
    const current = this.segments[0];
    let song: Snapshot['song'] = null;
    if (ps && current) {
      const view = ps.views[current.idx];
      const pos = current.landingAudio + (t - current.landingCtx);
      const at = barBeatAt(ps.grid, pos) ?? { bar: 0, beat: 1 };
      const d = ps.grid.downbeats;
      const following = this.segments[1];
      const tail = this.segments[this.segments.length - 1];
      const planned = this.planned && this.planned !== 'end' ? this.planned : null;
      const nextLanding = following
        ? following.landingCtx
        : planned
          ? tail.landingCtx + (planned.boundaryAudio - tail.landingAudio)
          : null;
      const nextInfo = following ?? planned;
      let next: NonNullable<Snapshot['song']>['next'] = null;
      if (nextInfo && nextLanding !== null) {
        const boundary = current.landingAudio + (nextLanding - current.landingCtx);
        next = {
          idx: nextInfo.idx,
          reason: nextInfo.reason,
          landingCtx: nextLanding,
          bars: upper(d, boundary - 1e-3) - upper(d, pos),
          beats: upper(ps.grid.beats, boundary - 1e-3) - upper(ps.grid.beats, pos),
        };
      }
      const passBars = view.e - view.s;
      const barsInPass = Math.max(0, view.e - Math.max(view.s, at.bar - 1));
      const remainingPasses = this.holding ? 0 : Math.max(0, view.section.repeats - current.pass);
      const later = ps.views.slice(current.idx + 1).reduce((sum, item) => sum + (item.end - item.start) * item.section.repeats, 0);
      song = {
        title: ps.song.title,
        idx: current.idx,
        pass: current.pass,
        repeats: view.section.repeats,
        hold: this.holding,
        bar: at.bar,
        beat: at.beat,
        beatsPerBar: ps.song.beatsPerBar,
        pos,
        barsLeft: barsInPass + remainingPasses * passBars,
        secondsLeft: Math.max(0, current.seamAudio - pos) + remainingPasses * (view.end - view.start) + later,
        next,
        ending: this.planned === 'end' || this.endAt !== null,
      };
    }
    const newest = this.pads[0] ?? null;
    const previous = this.fading[this.fading.length - 1] ?? null;
    const sounding = newest && newest.at <= t ? newest : newest && previous && previous.until > t ? previous : null;
    const coming = newest && newest.at > t ? newest : null;
    let clock: Snapshot['clock'] = null;
    if (this.clock) {
      const bars = (t - this.clock.anchor) / this.clock.barLen;
      clock = {
        bar: this.clock.bar + Math.floor(bars),
        beat: Math.min(this.clock.beatsPerBar, Math.floor((bars - Math.floor(bars)) * this.clock.beatsPerBar) + 1),
        beatsPerBar: this.clock.beatsPerBar,
      };
    }
    return {
      paused: audio().ctx.state === 'suspended',
      song,
      pad:
        sounding || coming
          ? {
              tonic: (sounding ?? coming)!.tonic,
              since: (sounding ?? coming)!.at,
              next: sounding && coming ? { tonic: coming.tonic, at: coming.at } : null,
            }
          : null,
      clock,
    };
  }
}

export function padSourceFor(pads: Pad[]): PadSource {
  return async tonic => {
    const pad = pads.find(item => item.tonic === tonic);
    return pad ? ((await getAudio(pad.id)) ?? null) : null;
  };
}
