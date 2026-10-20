// Synthetic recordings with a known grid, sections and keys, for tests and e2e.
export const RATE = 22050;

const NOTE = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, Bb: 10, B: 11 } as const;
type Note = keyof typeof NOTE;

export interface FixtureSong {
  title: string;
  bpm: number;
  firstDownbeat: number;
  /** One chord root per bar, major triads, grouped into sections. */
  sections: Array<{ type: string; key: string; chords: Note[] }>;
  tail: number;
}

export const SONG_A: FixtureSong = {
  title: 'Morning Test',
  bpm: 120,
  firstDownbeat: 0.5,
  sections: [
    { type: 'intro', key: 'G', chords: ['G', 'C', 'D', 'G'] },
    { type: 'verse', key: 'G', chords: ['G', 'C', 'D', 'G'] },
    { type: 'chorus', key: 'G', chords: ['C', 'D', 'G', 'G'] },
    { type: 'verse', key: 'G', chords: ['G', 'C', 'D', 'G'] },
    { type: 'chorus', key: 'A', chords: ['D', 'E', 'A', 'A'] },
    { type: 'outro', key: 'A', chords: ['A', 'D', 'E', 'A'] },
  ],
  tail: 1.5,
};

export const SONG_B: FixtureSong = {
  title: 'Evening Test',
  bpm: 60,
  firstDownbeat: 0.25,
  sections: [
    { type: 'intro', key: 'D', chords: ['D', 'G', 'A', 'D'] },
    { type: 'chorus', key: 'D', chords: ['G', 'A', 'D', 'D'] },
  ],
  tail: 1,
};

export function beatTimes(song: FixtureSong): number[] {
  const beat = 60 / song.bpm;
  const bars = song.sections.reduce((sum, section) => sum + section.chords.length, 0);
  return Array.from({ length: bars * 4 }, (_, i) => song.firstDownbeat + i * beat);
}

export function renderSong(song: FixtureSong): Float32Array {
  const beat = 60 / song.bpm;
  const roots = song.sections.flatMap(section => section.chords);
  const total = song.firstDownbeat + roots.length * 4 * beat + song.tail;
  const out = new Float32Array(Math.ceil(total * RATE));
  roots.forEach((root, bar) => {
    const start = song.firstDownbeat + bar * 4 * beat;
    for (const step of [0, 4, 7]) tone(out, freq(NOTE[root] + step, step === 0 ? 3 : 4), start, 4 * beat, 0.08);
    tone(out, freq(NOTE[root], 2), start, 4 * beat, 0.06);
  });
  beatTimes(song).forEach((t, i) => click(out, t, i % 4 === 0 ? 0.5 : 0.25));
  return out;
}

export function renderPad(tonic: Note, seconds = 20): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * RATE));
  for (const [step, octave] of [[0, 3], [7, 3], [0, 4]] as const) tone(out, freq(NOTE[tonic] + step, octave), 0, seconds, 0.1);
  return out;
}

function freq(pc: number, octave: number): number {
  return 440 * 2 ** ((pc + 12 * (octave + 1) - 69) / 12);
}

function tone(out: Float32Array, hz: number, start: number, length: number, amp: number) {
  const a = Math.floor(start * RATE);
  const b = Math.min(out.length, Math.floor((start + length) * RATE));
  for (let h = 1; h <= 6 && h * hz < RATE / 2; h++) {
    const w = (2 * Math.PI * h * hz) / RATE;
    for (let i = a; i < b; i++) {
      const env = Math.min(1, (i - a) / (0.02 * RATE), (b - i) / (0.02 * RATE));
      out[i] += (amp / h) * env * Math.sin(w * i);
    }
  }
}

let seed = 7;
function click(out: Float32Array, t: number, amp: number) {
  const a = Math.floor(t * RATE);
  for (let i = 0; i < 0.02 * RATE && a + i < out.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out[a + i] += amp * Math.exp(-i / (0.004 * RATE)) * (seed / 2 ** 31 - 1);
  }
}

export function wav(samples: Float32Array): Uint8Array {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset: number, text: string) => [...text].forEach((c, i) => data.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  data.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, RATE, true);
  data.setUint32(28, RATE * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  ascii(36, 'data');
  data.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return new Uint8Array(data.buffer);
}
