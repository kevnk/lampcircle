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
  const b = to ? numeral(pad, to) : null;
  const fromName = KEY_NAMES[from.tonic];
  const toName = to ? KEY_NAMES[to.tonic] : '';
  if (a && b) return `${a} in ${fromName} · ${b} in ${toName}`;
  if (a) return `${a} in ${fromName}`;
  if (b) return `${b} in ${toName}`;
  return to ? 'outside both keys' : `outside ${fromName}`;
}

/** Pads from the key you left to the next song's key, ending on a V to I cadence. */
export function route(from: MusicKey, to: MusicKey | null): number[] {
  if (!to || from.tonic === to.tonic) return [to?.tonic ?? from.tonic];
  const five = (to.tonic + 7) % 12;
  if (from.tonic === five) return [from.tonic, to.tonic];
  if (numeral(from.tonic, to) !== null) return [from.tonic, five, to.tonic];
  const pivot = (to.minor ? [5, 8, 3] : [5, 2, 9])
    .map(step => (to.tonic + step) % 12)
    .find(pad => numeral(pad, from) !== null && numeral(pad, to) !== null);
  return pivot === undefined ? [from.tonic, five, to.tonic] : [from.tonic, pivot, five, to.tonic];
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
