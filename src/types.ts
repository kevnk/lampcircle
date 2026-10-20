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
  repeats: number;
  jumpAt: JumpAt;
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
  updatedAt: number;
}
