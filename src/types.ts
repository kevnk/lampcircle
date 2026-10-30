export type SectionType =
  | 'intro'
  | 'verse'
  | 'prechorus'
  | 'chorus'
  | 'bridge'
  | 'tag'
  | 'instrumental'
  | 'outro'
  | 'custom';

/** Where a tapped pad change lands while a section plays. Phrase = every 4 bars from the section's start. */
export type JumpAt = 'beat' | 'bar' | 'phrase' | 'section';

/** A tap on a beat. `one` marks beat 1 of a bar (Shift+Space). */
export interface Tap {
  t: number;
  one: boolean;
  /** Placed by the app from the recording, not tapped. A tap wins over it. */
  auto?: boolean;
}

export interface Section {
  id: string;
  type: SectionType;
  /** Only for custom sections. Others are named by type and order ("Verse 2"). */
  name?: string;
  /** Seconds where it was marked. Read code snaps it to the nearest downbeat. */
  at: number;
  /** Set by the person. Otherwise the key comes from the audio. */
  key?: string;
  pickupBeats: number;
  fadeInBeats: number;
  fadeOutBeats: number;
  /** Beats after the loop point where the fade-out ends, so the old pass rings over the new one. Negative ends it early. Missing means 0. */
  fadeOutEndBeats?: number;
  repeats: number;
  jumpAt: JumpAt;
  /** Missing means the screen stays blank through this section. */
  lyric?: SectionLyric;
}

/** The block a section shows, and the bar each slide comes in on, counted from the section's first bar (0). */
export interface SectionLyric {
  block: string;
  slideBars: number[];
}

/** Words for the screen. Each block holds its words once, and sections point to one, so repeated choruses share it. */
export interface Lyrics {
  /** Where the words came from: youtube-subs, youtube-auto, lrclib:<id>, whisper or manual. Playback never reads it. */
  source?: string;
  /** Seconds the words were nudged when they were placed. Playback never reads it. */
  offset?: number;
  /** Slides change this many beats before their bar, 0 to 8 in half beats. Missing means the app default, 2. */
  leadBeats?: number;
  /** Beats a slide takes to fade out and in. Missing means the app default, 1. */
  fadeBeats?: number;
  /** Block id to its slides, each slide the lines on screen. An empty slide is a deliberate blank. */
  blocks: Record<string, string[][]>;
}

/** A line of words and when it is sung, in seconds of the recording, before it is placed on bars. */
export interface TimedLine {
  start: number;
  end: number;
  text: string;
  /** Where its timing came from: YouTube manual or auto captions, or LRCLIB's LRC. */
  kind: 'manual' | 'auto' | 'lrc';
}

/** Audio lives in its own store, keyed by the song id. */
export interface Song {
  id: string;
  title: string;
  artist: string;
  duration: number;
  source?: string;
  audioFile?: string;
  peaks: number[];
  /** One 12-bin pitch-class vector per CHROMA_HOP seconds. */
  chroma: number[][];
  beatsPerBar: number;
  taps: Tap[];
  /** Extend the grid from the edge tempos to the start and end of the song. */
  fill: boolean;
  sections: Section[];
  lyrics?: Lyrics;
  /** The timed lines Find lyrics found, kept in the app for placement. Never written to a .djw. */
  timedLyrics?: TimedLine[];
  /** How the timed lines were last placed, so Place again and the nudge place them the same way. Never written to a .djw. */
  lyricsPlacing?: { linesPerSlide: number; autoOffset: boolean };
  /** Seconds. The last section ends here. */
  marksEnd: number;
  refined: boolean;
  exportedAt?: number;
  updatedAt: number;
  addedAt: number;
}

export interface Pad {
  id: string;
  title: string;
  /** Pitch class 0 to 11, C = 0. */
  tonic: number;
  duration: number;
  source?: string;
  addedAt: number;
}

export interface WorshipSet {
  id: string;
  name: string;
  songIds: string[];
  /** Pads you picked for the gap after a song, in play order, keyed by `gapKey`. A gap without one plays the suggested way in. */
  pads?: Record<string, number[]>;
  updatedAt: number;
}
