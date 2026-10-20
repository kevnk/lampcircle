export interface LyricLine {
  id: string;
  text: string;
  startTime: number;
  endTime?: number;
  beatIndex?: number;
}

export type LoopSnapMode = 'off' | 'beat' | 'measure';
export type FadeCurve = 'equal-power' | 'linear';
export type LoopOverlapBeats = 0 | 0.5 | 1 | 2;

export interface LoopSettings {
  snapMode: LoopSnapMode;
  overlapBeats: LoopOverlapBeats;
  fadeCurve: FadeCurve;
}

export const DEFAULT_LOOP_SETTINGS: LoopSettings = {
  snapMode: 'measure',
  overlapBeats: 1,
  fadeCurve: 'equal-power',
};

/** Named reusable A–B loop persisted on the song */
export interface SongLoop {
  id: string;
  name: string;
  start: number;
  end: number;
  color?: string;
}

export interface Song {
  id: string;
  name: string;
  audioBlob: Blob;
  duration: number;
  bpm?: number;
  timeSignature?: string;
  key?: string;
  dateAdded: number;
  regions: Region[];
  beats: Beat[];
  sessionPreset?: SessionPreset;
  /** Plain-text lyrics (paste buffer / legacy) */
  lyrics?: string;
  /** Timed lyric lines aligned to the beat grid */
  lyricLines?: LyricLine[];
  /** Per-song loop / crossfade preferences */
  loopSettings?: LoopSettings;
  /** Named multi-loops (playback uses activeLoopId) */
  loops?: SongLoop[];
  /** Which named loop is active for playback; null = draft / none */
  activeLoopId?: string | null;
  phase?: SongPhase;
  sourceUrl?: string;
  audioSha256?: string;
}

export interface SectionMark {
  bar: number;
  name: string;
}

export type SongPhase =
  | { kind: 'needs-tap' }
  | {
      kind: 'tapped';
      downbeats: number[];
      taps: number[];
      lockedBpm: number | null;
      marks: SectionMark[];
    }
  | {
      kind: 'ready';
      downbeats: number[];
      taps: number[];
      lockedBpm: number | null;
      parts: SongPart[];
    };

export interface SongPart {
  id: string;
  name: string;
  /** 1-based bar whose downbeat is the landing "1". */
  startBar: number;
  /** Exclusive. Equals the next part's startBar. musical end is that bar's downbeat. */
  endBar: number;
  /** Half-beat steps, 0 through 16. */
  pickupBeats: number;
  fadeInBeats: number;
  fadeOutBeats: number;
  loop: boolean;
  color: string;
}

export type TempoVerdict =
  | { kind: 'keep-tapping'; bars: number }
  | { kind: 'steady'; bpm: number; barSeconds: number }
  | { kind: 'drifts'; bpmMin: number; bpmMax: number; barSeconds: number };

export interface PartWindow {
  landing: number;
  singerStart: number;
  audioStart: number;
  musicalEnd: number;
  fadeOutStart: number;
}

export interface Region {
  id: string;
  name: string;
  start: number;
  end: number;
  color: string;
}

export interface Beat {
  time: number;
  bar: number;
  beat: number;
  confidence: number;
}

export interface SessionPreset {
  tempoAdjust: number;
  pitchShift: number;
  crossfadeDuration: number;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  countInBars: number;
  regionHotkeys: { [key: string]: string };
  defaultQueue: string[];
}

export interface LoopState {
  enabled: boolean;
  start: number;
  end: number;
  count: number;
  currentIteration: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  loop: LoopState;
  queuedRegion: string | null;
  currentRegion: string | null;
  tempoAdjust: number;
  pitchShift: number;
  volume: number;
  /** Legacy ms-style hint; overlap beats is the primary crossfade control */
  crossfadeDuration: number;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  loopSnapMode: LoopSnapMode;
  loopOverlapBeats: LoopOverlapBeats;
  fadeCurve: FadeCurve;
  activePartId: string | null;
  queuedPartId: string | null;
}

export interface SetlistItem {
  id: string;
  songId: string;
  notes: string;
  order: number;
}
