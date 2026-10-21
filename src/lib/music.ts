export const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

export interface MusicKey {
  tonic: number;
  minor: boolean;
}

// Krumhansl-Kessler key profiles, degree 0 = tonic.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const DEGREES: Record<'major' | 'minor', Array<[number, string]>> = {
  major: [[0, 'I'], [2, 'ii'], [4, 'iii'], [5, 'IV'], [7, 'V'], [9, 'vi']],
  minor: [[0, 'i'], [3, 'III'], [5, 'iv'], [7, 'v'], [8, 'VI'], [10, 'VII']],
};

export function keyName(key: MusicKey): string {
  return KEY_NAMES[key.tonic] + (key.minor ? 'm' : '');
}

export function parseKey(name: string): MusicKey | null {
  const match = /^([A-Ga-g])([#♯b♭]?)(m|min|minor)?$/.exec(name.trim());
  if (!match) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase() as 'c'];
  const shift = match[2] === '#' || match[2] === '♯' ? 1 : match[2] ? -1 : 0;
  return { tonic: (base + shift + 12) % 12, minor: Boolean(match[3]) };
}

export function pc(name: string): number {
  return parseKey(name)?.tonic ?? 0;
}

/** Best of the 24 major and minor keys by Pearson correlation. Null for silence. */
export function detectKey(chroma: number[]): MusicKey | null {
  const total = chroma.reduce((sum, value) => sum + value, 0);
  if (!(total > 1e-9)) return null;
  let best: MusicKey | null = null;
  let bestScore = -Infinity;
  for (const minor of [false, true]) {
    const profile = minor ? MINOR_PROFILE : MAJOR_PROFILE;
    for (let tonic = 0; tonic < 12; tonic++) {
      const score = pearson(chroma, chroma.map((_, i) => profile[(i - tonic + 12) % 12]));
      if (score > bestScore) {
        bestScore = score;
        best = { tonic, minor };
      }
    }
  }
  return best;
}

/** Relative majors share a signature, so C#m to E is not a key change. */
export function signature(key: MusicKey): number {
  return key.minor ? (key.tonic + 3) % 12 : key.tonic;
}

export function sameSignature(a: MusicKey, b: MusicKey): boolean {
  return signature(a) === signature(b);
}

/** Roman numeral of a pad's root inside a key, or null when it is outside the key. */
export function numeral(pad: number, key: MusicKey): string | null {
  const step = (pad - key.tonic + 12) % 12;
  return DEGREES[key.minor ? 'minor' : 'major'].find(([degree]) => degree === step)?.[1] ?? null;
}

export interface PadGroups {
  both: number[];
  from: number[];
  to: number[];
  other: number[];
}

export function padGroups(from: MusicKey, to: MusicKey | null): PadGroups {
  const groups: PadGroups = { both: [], from: [], to: [], other: [] };
  for (let i = 0; i < 12; i++) {
    const pad = (from.tonic + i) % 12;
    const inFrom = numeral(pad, from) !== null;
    const inTo = to !== null && numeral(pad, to) !== null;
    if (inFrom && inTo) groups.both.push(pad);
    else if (inFrom) groups.from.push(pad);
    else if (inTo) groups.to.push(pad);
    else groups.other.push(pad);
  }
  return groups;
}

/** Where a pad sits in the key you leave and the key you need, like "V in A · I in D". */
export function padFit(pad: number, from: MusicKey, to: MusicKey | null): string {
  const a = numeral(pad, from);
  // The Anthem Roll's ♭VII is outside a major key but still a way into it.
  const b = to ? (numeral(pad, to) ?? ((pad - to.tonic + 12) % 12 === 10 ? 'bVII' : null)) : null;
  const fromName = KEY_NAMES[from.tonic];
  const toName = to ? KEY_NAMES[to.tonic] : '';
  if (a && b) return `${a} in ${fromName} · ${b} in ${toName}`;
  if (a) return `${a} in ${fromName}`;
  if (b) return `${b} in ${toName}`;
  return to ? 'outside both keys' : `outside ${fromName}`;
}

/**
 * Pads from the key you left to the next song's key, moving in 4ths as in
 * docs/universal_key_modulation_strategy_guide.md. Within 3 steps below the next key on the circle of 4ths,
 * ride up it into a V to I. Within 2 steps above, roll down it as the Anthem Roll, ♭VII to IV to I.
 * Farther away, jump onto one of the guide's ways in: II V I, V I, or ♭VII IV I, whichever first chord
 * keeps the most notes of the old key's chord. Pads count as major chords, as in the guide.
 */
export function route(from: MusicKey, to: MusicKey | null): number[] {
  if (!to || from.tonic === to.tonic) return [to?.tonic ?? from.tonic];
  const steps = (5 * (to.tonic - from.tonic + 12)) % 12;
  if (steps <= 3) return Array.from({ length: steps + 1 }, (_, i) => (from.tonic + 5 * i) % 12);
  if (steps >= 10) return Array.from({ length: 13 - steps }, (_, i) => (from.tonic + 7 * i) % 12);
  const chord = (root: number, minor = false) => [root, (root + (minor ? 3 : 4)) % 12, (root + 7) % 12];
  const held = chord(from.tonic, from.minor);
  const shared = (pad: number) => chord(pad).filter(note => held.includes(note)).length;
  // Ties go to the first: the guide's default II V I, then the shorter V I.
  const way = waysIn(to).reduce((best, next) => (shared(next[0]) > shared(best[0]) ? next : best));
  return [from.tonic, ...way, to.tonic];
}

/** The guide's ways into a key, before its I: II V, then V alone, then the Anthem Roll's ♭VII IV. */
export function waysIn(to: MusicKey): number[][] {
  return [[2, 7], [7], [10, 5]].map(way => way.map(step => (to.tonic + step) % 12));
}

export function tempoNote(from: number, to: number): string | null {
  const ratio = Math.max(from, to) / Math.min(from, to);
  if (Math.abs(ratio - 2) <= 0.03) {
    return `${Math.round(from)} to ${Math.round(to)} BPM. That is exactly half-time, so the pad can hold one pulse across both.`;
  }
  return null;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let top = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - meanA;
    const y = b[i] - meanB;
    top += x * y;
    varA += x * x;
    varB += y * y;
  }
  return varA === 0 || varB === 0 ? 0 : top / Math.sqrt(varA * varB);
}
