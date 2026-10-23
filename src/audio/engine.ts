import type { Pad, Song } from '../types';
import { getAudio } from '../lib/db';
import { barBeatAt, barSeconds, beatPos, beatTime, keyOf, sectionViews, songGrid, upper, type Grid, type SectionView } from '../lib/songMap';
import { EVEN_LOUDNESS, clockBoundary, decideNext, fadeCurve, fadeOutStart, leadIn, nextBoundary, seamEnd, seamFades, type FadeShape, type JumpFade, type Reason, type SeamFades } from '../lib/performPlan';

const COMMIT_AHEAD = 3;
const MIN_RAMP = 0.005;
/** Seconds a loop's lead-in takes to fade away when you let go of a hold after it started. */
const LET_GO_FADE = 0.2;

interface Bus {
  ctx: AudioContext;
  /** Song and pads together. */
  main: GainNode;
  song: GainNode;
  pad: GainNode;
  meter: AnalyserNode;
}

let bus: Bus | null = null;

export function audio(): Bus {
  if (bus) return bus;
  const ctx = new AudioContext();
  const main = ctx.createGain();
  const song = ctx.createGain();
  const pad = ctx.createGain();
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  song.connect(main);
  pad.connect(main);
  pad.gain.value = 0.8;
  main.connect(meter);
  main.connect(ctx.destination);
  bus = { ctx, main, song, pad, meter };
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
function fadeTo(fader: Fader, value: number, start: number, end: number, shape?: FadeShape) {
  const param = fader.gain.gain;
  const curve = fadeCurve(valueAt(fader.points, start), value, start, Math.max(end, start + MIN_RAMP), shape);
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
  /** The pad that fills the silence between the previous segment's fade-out and this one's fade-in. */
  gapPad?: Promise<PadVoice | null>;
  /** Shared with the previous segment when the recording runs straight on into this one. */
  voice: Voice;
  /** A pad under the song has been told about this section's key. */
  keyed?: boolean;
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
    /** Ending early, from End song now or Go to pad. */
    forced: boolean;
    /** Brought in, and not landed yet. */
    arriving: boolean;
  };
  pad: null | { tonic: number; since: number; next: { tonic: number; at: number } | null };
  /** A pad still fading out, after a new song or a new pad took over or it was turned off. */
  padFading: boolean;
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
  /** The pad that takes over when the song ends, or null for none. It rises over the song's last 2 bars. */
  endPad: (() => number | null) | null = null;
  /** The pad brought in for the song's end. It fades back out if the song goes on after all. */
  private endingPad: Promise<PadVoice | null> | null = null;
  /** setPad calls still loading their recording. */
  private padLoads = 0;
  /** How jumps between different sections line up their fades. */
  jumpFade: JumpFade = 'edited';
  /** Bring in a pad in the new section's key when a jump would leave silence. */
  fillGaps = false;
  /** A pad is under the song, and changes to each new section's key as it lands. */
  under = false;
  /** How long a pad takes to change into another pad. */
  padCrossfade: 'beat' | 'bar' | 'bars' = 'beat';
  padSource: PadSource;
  pads: PadVoice[] = [];
  private fading: PadVoice[] = [];
  /** Passes that have handed over but still ring out their fade-out. */
  private tails: Array<{ voice: Voice; end: number }> = [];
  private padTicket = 0;
  clock: PadClock | null = null;
  /** True from the moment Pause is pressed, through the fade-out. */
  paused = false;
  /** When the fade-out is done and the audio clock stops. */
  private suspendAt: number | null = null;
  private master: Fader = { gain: audio().main, points: [{ t: now(), v: 1 }] };
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
    // Other screens share the bus: leave it running and at full volume, even partway through a fade back in.
    this.resume();
    fadeTo(this.master, 1, now(), now());
  }

  startSong(ps: PerfSong, options: { from: number; landingCtx?: number; passes?: number; until?: number }) {
    for (const segment of this.segments) stop(segment.voice);
    for (const tail of this.tails) stop(tail.voice);
    this.tails = [];
    this.begin(ps, options.passes ? { idx: options.from, passes: options.passes, until: options.until } : undefined);
    const view = ps.views[options.from];
    const lead = view.start - leadIn(view, ps.grid).audioStart;
    this.enter(options.from, 1, 'plan', options.landingCtx ?? now() + 0.1 + lead, null, null);
    this.tick();
  }

  /** Bring in the next song on the pad clock. */
  startNext(ps: PerfSong, options: { from: number; keepPad: boolean; crossfade: number }) {
    const view = ps.views[options.from];
    const lead = view.start - leadIn(view, ps.grid).audioStart;
    const bar = barSeconds(ps.grid, view.s);
    const earliest = now() + lead + 0.05;
    const landing = this.clock ? clockBoundary(this.clock.anchor, this.clock.barLen, earliest) : earliest;
    this.fadePads(landing, options.keepPad ? landing + 2 * bar : landing + options.crossfade);
    this.startSong(ps, { from: options.from, landingCtx: landing });
    return landing;
  }

  /**
   * Jump to a section of another song. It lands on the first bar line of the song playing that leaves room for its
   * fades, and the two meet the way the Jumps setting says. With no song playing, it comes in like the
   * next song. Returns the landing, or null while a song brought in earlier has not landed yet.
   */
  switchSong(ps: PerfSong, from: number, options: { keepPad: boolean; crossfade: number }): number | null {
    const old = this.ps;
    if (!old || this.segments.length === 0) return this.startNext(ps, { from, ...options });
    const t = now();
    if (t < this.segments[0].landingCtx) return null;
    this.revoke();
    const playing = this.segments;
    const tail = playing[playing.length - 1];
    const view = ps.views[from];
    const bar = barSeconds(ps.grid, view.s);
    const d = old.grid.downbeats;
    const last = d.length - 1;
    // Past the last bar line, in the ring-out, bars keep the last bar's length.
    const barLine = (k: number) => (k <= last ? d[k] : d[last] + (k - last) * barSeconds(old.grid, last));
    let k = upper(d, tail.landingAudio + Math.max(0, t - tail.landingCtx));
    let found: { landing: number; fades: SeamFades } | null = null;
    for (let tries = 0; tries < 64 && !found; tries++, k++) {
      const boundary = barLine(k);
      const landing = tail.landingCtx + (boundary - tail.landingAudio);
      const fades = seamFades(old.views[tail.idx], view, boundary, old.grid, this.jumpFade, ps.grid);
      if (fades && landing + Math.min(fades.in[0], fades.out[0]) >= t + 0.05) found = { landing, fades };
    }
    // Only a broken grid gets here. The plan was made from passes just revoked, so let the next tick make it again.
    if (!found) {
      this.planned = null;
      return null;
    }
    const { landing, fades } = found;
    this.fadePads(landing, options.keepPad ? landing + 2 * bar : landing + options.crossfade);
    this.begin(ps);
    this.enter(from, 1, 'pick', landing, tail, fades);
    // The old song rings out under the new one, then stops.
    playing.forEach((segment, j) => {
      const after = playing[j + 1] ?? this.segments[0];
      if (after.voice === segment.voice) return;
      const end = Math.max(t, after.prevEndCtx) + 0.1;
      stop(segment.voice, end);
      this.tails.push({ voice: segment.voice, end });
    });
    this.tick();
    return landing;
  }

  /** Clear the song state for a new song. Passes still sounding are the caller's to stop. */
  private begin(ps: PerfSong, only?: PerformSession['only']) {
    this.resume();
    this.ps = ps;
    this.segments = [];
    this.planned = null;
    this.pick = null;
    this.holding = false;
    this.endAt = null;
    this.forced = false;
    this.only = only;
    this.under = false;
    this.endingPad = null;
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

  /** Toggles what the Hold button shows, so letting go of a loop already on its way never turns hold back on. */
  toggleHold() {
    const letGo = this.held();
    this.holding = !letGo;
    this.pick = null;
    this.replan(letGo);
  }

  /** Holding as heard: asked for and able to loop, or a loop already coming in that letting go was too late to take back. */
  private held(): boolean {
    const t = now();
    if (this.segments.some((segment, k) => k > 0 && segment.reason === 'hold' && t < segment.landingCtx)) return true;
    return this.holding && !this.forced && !this.only && this.planned !== 'end';
  }

  /** Fade the song out over `bars` from `from`, and end it there. */
  endSong(bars = 2, from = now()) {
    const ps = this.ps;
    const current = this.segments[0];
    if (!ps || !current) return;
    this.revoke();
    const t = Math.max(from, now());
    const end = t + bars * barSeconds(ps.grid, ps.views[current.idx].s);
    for (const segment of this.segments) {
      fadeTo(segment.voice, 0, t, end);
      stop(segment.voice, end + 0.05);
      // A handover already under way would otherwise stop the outgoing pass at its own seam, partway through this fade.
      segment.prevEndCtx = Math.max(segment.prevEndCtx, end);
    }
    const last = this.segments[this.segments.length - 1];
    this.planned = 'end';
    this.endAt = Math.min(end, last.landingCtx + (ps.buffer.duration - last.landingAudio));
    this.forced = true;
  }

  /** Seconds in a bar now: the song's, else the pad clock's. */
  barLen(): number {
    const current = this.segments[0];
    if (this.ps && current) return barSeconds(this.ps.grid, this.ps.views[current.idx].s);
    return this.clock?.barLen ?? 2;
  }

  /**
   * Fade song and pads out over `bars`, then stop the audio clock, which holds every scheduled pass and fade.
   * The set keeps moving while it fades, so it picks up where it went quiet.
   */
  pause(bars = 0) {
    if (this.paused) return;
    this.paused = true;
    const t = now();
    this.suspendAt = t + Math.max(MIN_RAMP, bars * this.barLen());
    fadeTo(this.master, 0, t, this.suspendAt, EVEN_LOUDNESS);
  }

  /** Start the clock again and fade back in over `bars`. Mid fade-out, it turns back from the level it reached. */
  resume(bars = 0) {
    // Also wakes a context the browser started suspended. Calls to the context run in order, so this wins over a suspend still in flight.
    void audio().ctx.resume();
    if (!this.paused) return;
    this.paused = false;
    this.suspendAt = null;
    for (const pad of [...this.pads, ...this.fading]) void pad.el.play();
    const t = now();
    fadeTo(this.master, 1, t, t + bars * this.barLen(), EVEN_LOUDNESS);
  }

  /** Start or change the pad. The new pad fades in from `at` while the old one fades out. */
  setPad(tonic: number, at: number, fade: number): Promise<PadVoice | null> {
    this.padLoads++;
    return this.loadPad(tonic, at, fade).finally(() => this.padLoads--);
  }

  private async loadPad(tonic: number, at: number, fade: number): Promise<PadVoice | null> {
    const ticket = ++this.padTicket;
    const blob = await this.padSource(tonic);
    if (!blob || ticket !== this.padTicket) return null;
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
    if (ticket !== this.padTicket) {
      releasePad(pad);
      return null;
    }
    const start = Math.max(at, now() + 0.02);
    pad.at = start;
    fadeTo(pad, 1, start, start + fade);
    for (const old of this.pads) {
      fadeTo(old, 0, start, start + fade);
      old.until = start + fade + 0.1;
    }
    this.fading.push(...this.pads);
    this.pads = [pad];
    return pad;
  }

  private dropPad(pad: PadVoice) {
    releasePad(pad);
    this.pads = this.pads.filter(item => item !== pad);
    this.fading = this.fading.filter(item => item !== pad);
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
    this.under = true;
    void this.setPad(tonic, at, 2 * barSeconds(ps.grid, view.s));
  }

  /** Bring in or change the pad under the song on its next bar line or beat. The next new section brings its own key. */
  changePadUnder(tonic: number, rule: 'beat' | 'bar') {
    const ps = this.ps;
    const current = this.segments[0];
    if (!ps || !current) return;
    const view = ps.views[current.idx];
    const pos = current.landingAudio + Math.max(0, now() - current.landingCtx);
    const end = pos > current.seamAudio - 0.01 ? ps.buffer.duration : current.seamAudio;
    const boundary = nextBoundary(rule, pos + 0.05, view, ps.grid, end);
    const at = Math.max(now(), current.landingCtx + (boundary - current.landingAudio));
    // A section landing by then would take the key back at once.
    for (const segment of this.segments) if (segment.landingCtx <= at + 0.01) segment.keyed = true;
    this.under = true;
    void this.setPad(tonic, at, this.padFadeSeconds());
  }

  private padFadeSeconds(): number {
    const bar = this.barLen();
    const beats = this.ps?.song.beatsPerBar ?? this.clock?.beatsPerBar ?? 4;
    return this.padCrossfade === 'beat' ? bar / beats : this.padCrossfade === 'bar' ? bar : 2 * bar;
  }

  /**
   * A pad under the song changes to the key of each new section as it lands. It waits until the section can no
   * longer be taken back, so a pick or cancel never leaves the pad in the wrong key. A repeat keeps a key you tapped.
   */
  private followKeys(t: number) {
    const ps = this.ps!;
    for (let k = 1; k < this.segments.length; k++) {
      const segment = this.segments[k];
      if (segment.keyed || t + 0.03 < Math.min(segment.startCtx, segment.prevFadeCtx) || t < segment.landingCtx - 0.5) continue;
      const pad = this.pads[0];
      // No pad under the song yet: look again next tick, so one brought in just before the landing still follows.
      if (!this.under || !pad) continue;
      segment.keyed = true;
      const tonic = keyOf(ps.views[segment.idx].key)?.tonic;
      if (tonic !== undefined && tonic !== pad.tonic && segment.idx !== this.segments[k - 1].idx) {
        void this.setPad(tonic, segment.landingCtx, this.padFadeSeconds());
      }
    }
  }

  /** Leave the song for the pad: from the next bar line the pad rises over `bars` as the song fades out. A pad already in stays. */
  leaveForPad(tonic: number, bars = 2) {
    const ps = this.ps;
    const current = this.segments[0];
    if (!ps || !current) return;
    const view = ps.views[current.idx];
    const pos = current.landingAudio + Math.max(0, now() - current.landingCtx);
    // In the last pass's ring-out, past the seam, bar lines run on to the end of the recording.
    const end = pos > current.seamAudio - 0.01 ? ps.buffer.duration : current.seamAudio;
    const boundary = nextBoundary('bar', pos + 0.05, view, ps.grid, end);
    const at = Math.max(now(), current.landingCtx + (boundary - current.landingAudio));
    if (this.pads.length === 0) void this.setPad(tonic, at, bars * barSeconds(ps.grid, view.s));
    this.under = false;
    this.endSong(bars, at);
  }

  /** `all` also shortens pads already fading, such as one kept under a new song, so they are gone by `end`. */
  fadePads(start: number, end: number, all = false) {
    this.padTicket++;
    this.under = false;
    for (const pad of all ? [...this.pads, ...this.fading.filter(item => item.until > end + 0.1)] : this.pads) {
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

  private replan(letGo = false) {
    if (this.forced || this.only) return;
    this.revoke(letGo);
    this.planned = null;
    this.endAt = null;
    this.tick();
    // A pick or hold in the last bars keeps the song going: the pad that was rising for its end goes back out.
    if (this.endAt === null && this.endingPad) {
      const pending = this.endingPad;
      this.endingPad = null;
      // A pad still loading fades straight back out once it loads, so a pad you asked for meanwhile is not cancelled.
      void pending.then(pad => pad && this.pads.includes(pad) && this.fadePads(now(), now() + this.padFadeSeconds()));
    }
  }

  /**
   * Undo committed transitions that have not started sounding yet. Letting go of a hold also takes back a loop whose
   * lead-in has started, until the pass before it starts fading out: the lead-in fades away and that pass plays on.
   */
  private revoke(letGo = false) {
    const t = now();
    while (this.segments.length > 1) {
      const last = this.segments[this.segments.length - 1];
      const locked = letGo && last.reason === 'hold' ? Math.min(last.prevFadeCtx, last.landingCtx) : Math.min(last.startCtx, last.prevFadeCtx);
      if (t + 0.03 >= locked) break;
      this.segments.pop();
      const prev = this.segments[this.segments.length - 1];
      if (last.voice === prev.voice) continue;
      if (t + 0.03 < last.startCtx) {
        stop(last.voice);
        last.voice.gain.disconnect();
      } else {
        fadeTo(last.voice, 0, t, t + LET_GO_FADE);
        stop(last.voice, t + LET_GO_FADE + 0.05);
      }
      restore(prev.voice, last.prevPoints, last.prevFadeCtx);
      if (last.gapPad) {
        this.padTicket++;
        void last.gapPad.then(pad => pad && this.dropPad(pad));
      }
    }
  }

  private fades(from: Segment, idx: number, boundaryAudio: number) {
    const ps = this.ps!;
    return seamFades(ps.views[from.idx], ps.views[idx], boundaryAudio, ps.grid, this.jumpFade);
  }

  /** `fades` null with a `prev` runs the recording straight on from it. */
  private enter(idx: number, pass: number, reason: Reason, landing: number, prev: Segment | null, fades: SeamFades | null) {
    const ps = this.ps!;
    const view = ps.views[idx];
    const seamAudio = seamEnd(view, ps.grid, ps.buffer.duration);
    if (prev && !fades) {
      this.segments.push({ idx, pass, reason, landingCtx: landing, landingAudio: view.start, seamAudio, startCtx: landing, prevFadeCtx: landing, prevEndCtx: landing, prevPoints: prev.voice.points, voice: prev.voice });
      return;
    }
    const { audioStart, singerStart } = leadIn(view, ps.grid);
    const into = fades?.in ?? [audioStart - view.start, singerStart - view.start];
    const t = now();
    let startCtx = landing + into[0];
    let offset = view.start + into[0];
    if (startCtx < t + 0.02) {
      const late = t + 0.02 - startCtx;
      startCtx += late;
      offset += late;
    }
    const voice = play(ps.buffer, audio().song, startCtx, offset);
    fadeTo(voice, 1, startCtx, landing + into[1]);
    let prevFadeCtx = Infinity;
    let prevEndCtx = landing;
    let prevPoints: Points = [];
    let gapPad: Promise<PadVoice | null> | undefined;
    if (prev && fades) {
      prevFadeCtx = Math.max(t + 0.01, landing + fades.out[0]);
      prevEndCtx = landing + fades.out[1];
      prevPoints = prev.voice.points;
      fadeTo(prev.voice, 0, prevFadeCtx, prevEndCtx);
      const tonic = keyOf(view.key)?.tonic;
      // The pad rises as the old pass fades and falls as the new one comes in.
      if (this.fillGaps && tonic !== undefined && fades.out[1] < fades.in[0] - 0.01 && this.pads.length === 0) {
        gapPad = this.setPad(tonic, prevFadeCtx, Math.max(0.25, prevEndCtx - prevFadeCtx));
        void gapPad.then(pad => pad && this.pads[0] === pad && this.fadePads(startCtx, landing + into[1]));
      }
    }
    this.segments.push({ idx, pass, reason, landingCtx: landing, landingAudio: view.start, seamAudio, startCtx, prevFadeCtx, prevEndCtx, prevPoints, gapPad, voice });
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
    if (this.suspendAt !== null && t >= this.suspendAt) {
      this.suspendAt = null;
      void audio().ctx.suspend();
      for (const pad of [...this.pads, ...this.fading]) pad.el.pause();
    }
    const done = this.fading.filter(pad => t >= pad.until);
    if (done.length) {
      done.forEach(releasePad);
      this.fading = this.fading.filter(pad => t < pad.until);
    }
    // Each one holds a decoded song.
    if (this.tails.some(tail => tail.end <= t)) this.tails = this.tails.filter(tail => tail.end > t);
    if (!ps || this.segments.length === 0) return;
    this.followKeys(t);
    while (this.segments.length > 1 && t >= this.segments[1].landingCtx) {
      const old = this.segments.shift()!;
      if (old.voice === this.segments[0].voice) continue;
      const end = Math.max(t, this.segments[0].prevEndCtx) + 0.1;
      stop(old.voice, end);
      this.tails.push({ voice: old.voice, end });
    }
    for (let guard = 0; guard < 8; guard++) {
      const tail = this.segments[this.segments.length - 1];
      const planned = this.planned ?? this.decide(tail);
      this.planned = planned;
      if (planned === 'end') break;
      const landing = tail.landingCtx + (planned.boundaryAudio - tail.landingAudio);
      // Commit before the first fade starts, so even a long fade-out plays in full.
      const fades = this.fades(tail, planned.idx, planned.boundaryAudio);
      if (t < landing + (fades ? Math.min(fades.in[0], fades.out[0]) : 0) - COMMIT_AHEAD) break;
      const { idx, pass, reason } = planned;
      this.planned = null;
      this.enter(idx, pass, reason, landing, tail, fades);
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
    // The pad after the song rises over its last 2 bars, unless a pad is in or on its way. It loads a second ahead.
    const rise = this.endAt === null ? Infinity : this.endAt - 2 * this.barLen();
    if (t >= rise - 1 && !this.endingPad && !this.only && this.pads.length === 0 && this.padLoads === 0) {
      const tonic = this.endPad?.() ?? null;
      if (tonic !== null && this.endAt !== null) {
        const at = Math.max(t, rise);
        this.endingPad = this.setPad(tonic, at, Math.max(this.barLen(), this.endAt - at));
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
    this.under = false;
    this.endingPad = null;
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
      const hold = this.held();
      const remainingPasses = hold ? 0 : Math.max(0, view.section.repeats - current.pass);
      const later = ps.views.slice(current.idx + 1).reduce((sum, item) => sum + (item.end - item.start) * item.section.repeats, 0);
      song = {
        title: ps.song.title,
        idx: current.idx,
        pass: current.pass,
        repeats: view.section.repeats,
        hold,
        bar: at.bar,
        beat: at.beat,
        beatsPerBar: ps.song.beatsPerBar,
        pos,
        barsLeft: barsInPass + remainingPasses * passBars,
        secondsLeft: Math.max(0, current.seamAudio - pos) + remainingPasses * (view.end - view.start) + later,
        next,
        ending: this.planned === 'end' || this.endAt !== null,
        forced: this.forced,
        arriving: t < current.landingCtx,
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
      paused: this.paused,
      song,
      padFading: this.fading.some(pad => pad.until > t),
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
