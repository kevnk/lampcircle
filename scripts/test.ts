import { readFileSync } from 'node:fs';
import { registerTsHooks } from './registerTsHooks.ts';
import { RATE, SONG_A, beatTimes, renderSong } from './fixtures.ts';

registerTsHooks();

const map = await import('../src/lib/songMap.ts');
const music = await import('../src/lib/music.ts');
const { ONSET_LAG, analyze, onsets, sectionChroma, snapToOnset } = await import('../src/lib/analysis.ts');
const plan = await import('../src/lib/performPlan.ts');
const djw = await import('../src/lib/djw.ts');

let failed = 0;
function same(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return console.log(`ok   ${label}`);
  failed++;
  console.log(`FAIL ${label}\n     actual   ${a}\n     expected ${e}`);
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const names = (pcs: number[]) => pcs.map(p => music.KEY_NAMES[p]);

// Grid from taps.
const taps = Array.from({ length: 16 }, (_, i) => ({ t: 1 + i * 0.5, one: i % 4 === 0 }));
let grid = map.buildGrid(taps, 4, 20, false);
same('grid keeps every tap', grid.beats.length, 16);
same('grid downbeats follow shift-taps', grid.downbeats.map(r3), [1, 3, 5, 7]);
same('grid tempo', map.bpmOf(grid), 120);
grid = map.buildGrid([...taps.slice(0, 6), ...taps.slice(10)], 4, 20, false);
same('grid fills a gap between taps', grid.beats.map(r3), taps.map(tap => r3(tap.t)));
same('filled beats are marked untapped', grid.tapped.filter(x => !x).length, 4);
grid = map.buildGrid([...taps, { t: 1.04, one: false }], 4, 20, false);
same('a double tap counts once', grid.beats.length, 16);
grid = map.buildGrid([...taps, ...taps, ...taps], 4, 20, true);
same('repeated taps at the same times count once', grid.beats.filter((_, i) => grid.tapped[i]).length, 16);
same('taps all at one time do not hang', map.buildGrid(Array.from({ length: 9 }, () => ({ t: 3, one: false })), 4, 20, true).beats.length, 1);
grid = map.buildGrid(taps, 4, 10, true);
same('fill reaches back to the start', grid.beats.slice(0, 3).map(r3), [0, 0.5, 1]);
same('fill counts bars backwards from beat 1', grid.beatInBar.slice(0, 3), [3, 4, 1]);
same('fill stops before the end', r3(grid.beats[grid.beats.length - 1]), 9.5);
const drift = Array.from({ length: 12 }, (_, i) => ({ t: i < 6 ? i * 0.5 : 2.5 + (i - 5) * 0.6, one: i % 4 === 0 }));
same('live tempo follows the latest taps', map.liveBpm(map.buildGrid(drift, 4, 20, false)), 100);
same('bar and beat at a time', map.barBeatAt(map.buildGrid(taps, 4, 20, false), 3.6), { bar: 2, beat: 2 });
grid = map.buildGrid([...taps.slice(0, 8), ...taps.slice(8).map(tap => ({ ...tap, auto: true }))], 4, 20, false);
same('beats the app placed are not tapped', grid.tapped.filter(Boolean).length, 8);
grid = map.buildGrid([{ t: 1.48, one: false, auto: true }, ...taps], 4, 20, false);
same('a tap wins over a placed beat at the same spot', [grid.beats.length, r3(grid.beats[1]), grid.tapped[1]], [16, 1.5, true]);

// Snapping taps and mapping beats from the recording.
/** Clicks at the given times over a quiet tone. */
function clicks(times: number[], seconds: number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * RATE)).map((_, i) => 0.05 * Math.sin((2 * Math.PI * 220 * i) / RATE));
  let seed = 3;
  for (const t of times) {
    const a = Math.round(t * RATE);
    for (let i = 0; i < 0.02 * RATE && a + i < out.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out[a + i] += 0.3 * Math.exp(-i / (0.004 * RATE)) * (seed / 2 ** 31 - 1);
    }
  }
  return out;
}
const worst = (a: number[], b: number[]) => Math.max(...a.map((t, i) => Math.abs(t - b[i])));
const odd = Array.from({ length: 40 }, (_, i) => 0.5 + i * 0.5 + ((i * 0.0137) % 0.01));
const oddEnv = onsets([clicks(odd, 21)], RATE);
same('a tap 40 ms late snaps to its click within 2 ms, whatever the frame phase', worst(odd.map(t => snapToOnset(oddEnv, t + 0.04) ?? NaN), odd) < 0.002, true);
same('a tap 40 ms early snaps too', worst(odd.map(t => snapToOnset(oddEnv, t - 0.04) ?? NaN), odd) < 0.002, true);
same('a tap 150 ms off is left alone', snapToOnset(oddEnv, odd[5] + 0.15), null);
const bumps = new Float32Array(400);
bumps[100] = 4;
bumps[106] = 6;
same('a faint bump nearer the tap does not hide the clear attack', r3(snapToOnset({ flux: bumps, floor: 5, strength: bumps }, 1) ?? NaN), r3(1.06 + ONSET_LAG));
const envA = onsets([renderSong(SONG_A)], RATE);
const truthA = beatTimes(SONG_A);
same('no attack in the silence after the song: the tap stays', snapToOnset(envA, truthA[truthA.length - 1] + 1), null);

// A live band speeding up from 70 to 77 BPM, with the drums out for 12 beats in the middle.
const live: number[] = [];
for (let t = 0.5, k = 0; k < 160; k++, t += 60 / (70 + (7 * k) / 160)) live.push(t);
const heard = live.filter((_, k) => k < 70 || k >= 82);
const envLive = onsets([clicks(heard, live[159] + 2)], RATE);
const liveSong = (tapped: number[]) =>
  ({ beatsPerBar: 4, fill: false, duration: live[159] + 2, taps: tapped.map((k, i) => ({ t: live[k], one: i === 0 })) }) as unknown as import('../src/types.ts').Song;
const mappedLive = map.buildGrid(map.mapTaps(liveSong([0, 1, 2, 3, 4, 5, 6, 7]), envLive), 4, live[159] + 2, false);
const near = (beats: number[], t: number) => beats[map.nearestIndex(beats, t)];
same('mapping from 8 taps follows the drift', worst(heard.map(t => near(mappedLive.beats, t)), heard) < 0.003, true);
same('and holds the beat while the drums are out', worst(live.slice(70, 82).map(t => near(mappedLive.beats, t)), live.slice(70, 82)) < 0.05, true);
same('and keeps the bars: one beat per beat', mappedLive.beats.filter(t => t > live[0] - 0.2 && t < live[159] + 0.2).length, 160);
same('mapped beats are not tapped', mappedLive.tapped.filter(Boolean).length, 8);
const gapLive = map.buildGrid(map.mapTaps(liveSong([0, 1, 2, 3, 4, 5, 6, 7, 120, 121, 122, 123]), envLive), 4, live[159] + 2, false);
same('a gap between taps is followed too', worst(heard.slice(0, 100).map(t => near(gapLive.beats, t)), heard.slice(0, 100)) < 0.003, true);
same('with under 2 taps there is nothing to follow', map.mapTaps(liveSong([0]), envLive).length, 1);

// Titles from YouTube.
const lib = await import('../src/lib/library.ts');
same('pad keys from album titles', ['A Pad', 'A# Pad', 'D# Pad', 'C Pad', 'G# Pad', 'Warm Pad in F#', 'Ambient pad in Bb'].map(lib.padKeyFromTitle), [9, 10, 3, 0, 8, 6, 10]);
same('no key in a song title', lib.padKeyFromTitle('Way Maker (Live)'), null);
same('artist and title from a video title', lib.splitTitle('Leeland - Way Maker (Official Live Video)'), { artist: 'Leeland', title: 'Way Maker' });
same('album links are playlists', [lib.isPlaylist(lib.PAD_ALBUM.url), lib.isPlaylist('https://music.youtube.com/watch?v=YcNmidI4dAg&si=x')], [true, false]);

// Keys and theory.
const D = music.parseKey('D')!;
const E = music.parseKey('E')!;
const key = (name: string) => music.parseKey(name)!;
// The routes from docs/universal_key_modulation_strategy_guide.md.
same('route D to E rolls down the Anthem Roll', names(music.route(D, E)), ['D', 'A', 'E']);
same('route C to D rolls down the Anthem Roll', names(music.route(key('C'), D)), ['C', 'G', 'D']);
same('route G to D is IV to I', names(music.route(key('G'), D)), ['G', 'D']);
same('route A to D', names(music.route(key('A'), D)), ['A', 'D']);
same('route F# to B', names(music.route(key('F#'), key('B'))), ['F#', 'B']);
same('route E to D rides II V I', names(music.route(E, D)), ['E', 'A', 'D']);
same('route A to C rides up three 4ths', names(music.route(key('A'), key('C'))), ['A', 'D', 'G', 'C']);
same('route C to E jumps to the Dominant Cascade', names(music.route(key('C'), E)), ['C', 'F#', 'B', 'E']);
same('route G to E jumps to the V on the shared B', names(music.route(key('G'), E)), ['G', 'B', 'E']);
same('route C# to C jumps to the Anthem Roll on the shared F', names(music.route(key('C#'), key('C'))), ['C#', 'Bb', 'F', 'C']);
same('route Em to C jumps to the V on the shared G and B', names(music.route(key('Em'), key('C'))), ['E', 'G', 'C']);
same('route to the end', names(music.route(key('B'), null)), ['B']);
same('ways into D', music.waysIn(D).map(names), [['E', 'A'], ['A'], ['C', 'G']]);
same('the Anthem Roll pad is named, not outside', music.padFit(0, key('A'), D), 'bVII in D');
const groups = music.padGroups(D, E);
same('pads that fit both D and E', names(groups.both), ['E', 'F#', 'A', 'B']);
same('pads that fit only D', names(groups.from), ['D', 'G']);
same('pads that fit only E', names(groups.to), ['G#', 'C#']);
same('pads outside both', names(groups.other), ['Eb', 'F', 'Bb', 'C']);
same('numeral of A in D', music.numeral(9, D), 'V');
same('half-time note', music.tempoNote(64, 128)?.includes('half-time'), true);
same('no note for close tempos', music.tempoNote(72, 68), null);
same('relative minor is the same signature', music.sameSignature(music.parseKey('C#m')!, E), true);

// Key finding on synthetic audio.
const audio = renderSong(SONG_A);
const { chroma, peaks } = analyze([audio], RATE);
same('peaks are normalized', Math.max(...peaks), 1);
const beat = 60 / SONG_A.bpm;
const found = SONG_A.sections.map((section, i) => {
  const start = SONG_A.firstDownbeat + i * 16 * beat;
  return music.keyName(music.detectKey(sectionChroma(chroma, start, start + 16 * beat))!);
});
same('key per section of the fixture', found, SONG_A.sections.map(section => section.key));

// A song built from the fixture grid and sections.
const truth = beatTimes(SONG_A);
const song = {
  id: 's1',
  title: SONG_A.title,
  artist: 'Test',
  duration: audio.length / RATE,
  peaks,
  chroma,
  beatsPerBar: 4,
  taps: truth.slice(0, 24).map((t, i) => ({ t, one: i % 4 === 0 })),
  fill: true,
  sections: [] as import('../src/types.ts').Section[],
  marksEnd: 0,
  refined: false,
  updatedAt: 1,
  addedAt: 1,
};
same('next step before marking', map.nextStep(song, false), 'sections');
let s = song as import('../src/types.ts').Song;
SONG_A.sections.forEach((section, i) => {
  s = map.markSection(s, section.type as never, SONG_A.firstDownbeat + i * 16 * beat + 0.3);
});
const views = map.sectionViews(s);
same('section names', views.map(v => v.name), ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Outro']);
same('sections snap to the nearest bar', views.map(v => v.s), [0, 4, 8, 12, 16, 20]);
same('found keys', views.map(v => v.key), ['G', 'G', 'G', 'G', 'A', 'A']);
same('rest of the song is unmarked', map.unmarked(s)?.key, 'A');
const throughVerse2 = { ...s, sections: s.sections.slice(0, 4), marksEnd: SONG_A.firstDownbeat + 64 * beat };
same('the unmarked rest flags a key change', map.unmarked(throughVerse2), { start: 32.5, key: 'A', change: true });
s = { ...s, marksEnd: s.duration };
same('marking to the end covers the song', map.unmarked(s), null);
same('plan text marks the key change', map.planText(s), 'I · V1 · C · V2 · C(A) · O');
same('all checks pass', map.checks(s).map(c => c.ok), [true, true, true, true]);
same('next step after marking', map.nextStep(s, false), 'refine');
s = map.markSection(s, 'bridge', views[4].start + 0.1);
same('marking an existing bar replaces its type', map.sectionViews(s)[4].name, 'Bridge');
s = map.moveSection(s, map.sectionViews(s)[4].section.id, -1);
same('moving a section by a bar', map.sectionViews(s)[4].s, 15);
same('moving stops a bar short of the next section', map.sectionViews(map.moveSection(s, map.sectionViews(s)[3].section.id, 5)).map(v => v.s), [0, 4, 8, 14, 15, 20]);
const bridge = map.sectionViews(s)[4];
same('no cut on the edge of a section', map.cutBar(s, bridge.start + 0.1), null);
const cut = map.cutSection(s, map.songGrid(s).downbeats[17] - 0.3);
same('cutting splits a section at the nearest bar', map.sectionViews(cut).map(v => [v.name, v.s, v.e]).slice(4, 6), [['Bridge 1', 15, 17], ['Bridge 2', 17, 20]]);
same('the second half starts fresh', map.sectionViews(cut)[5].section.pickupBeats, 0);

// Perform scheduling.
const g = map.buildGrid([0, 0.5, 1, 1.5, 2, 2.6, 3.2, 3.8, 4.4].map((t, i) => ({ t, one: i % 4 === 0 })), 4, 6, false);
const view = { section: { pickupBeats: 2, fadeInBeats: 1 }, start: 4.4, s: 2, e: 3 } as never;
const lead = plan.leadIn(view, g);
same('pickup walks back along tapped beats', [r3(lead.singerStart), r3(lead.audioStart)], [3.2, 2.6]);
const fadeSpan = (fadeOutEndBeats?: number) => Object.values(plan.fadeOutSpan({ section: { fadeOutBeats: 1, fadeOutEndBeats } } as never, g, 2)).map(r3);
same('the fade-out ends on the boundary by default', fadeSpan(), [1.5, 2]);
same('a late fade-out end rings over the boundary', fadeSpan(1), [2, 2.6]);
same('an early fade-out end stops before the boundary', fadeSpan(-1), [1, 1.5]);
// Seams between sections, on a steady half-second beat. "Chorus 2" fades out early for its own loop; "Chorus 4" fades in on the 1.
const steady = map.buildGrid(Array.from({ length: 60 }, (_, i) => ({ t: i * 0.5, one: i % 4 === 0 })), 4, 30, false);
const part = (index: number, start: number, section: object) => ({ index, start, section: { pickupBeats: 0, fadeInBeats: 1, fadeOutBeats: 1, ...section } }) as never;
const chorus2 = part(2, 10, { pickupBeats: 3, fadeInBeats: 2, fadeOutBeats: 2, fadeOutEndBeats: -3 });
const chorus4 = part(4, 18, {});
const seam = (to: never, match: 'out' | 'in' | 'edited') => plan.seamFades(chorus2, to, 14, steady, match);
same('as edited, a jump keeps both fades and leaves a gap', seam(chorus4, 'edited'), { out: [-2.5, -1.5], in: [-0.5, 0] });
same('matching the fade-out brings the new section in over it', seam(chorus4, 'out'), { out: [-2.5, -1.5], in: [-2.5, -1.5] });
same('matching the fade-in takes the old section out over it', seam(chorus4, 'in'), { out: [-0.5, 0], in: [-0.5, 0] });
same('a loop keeps its own seam whatever the jump setting', plan.seamFades(chorus2, chorus2, 14, steady, 'out'), { out: [-2.5, -1.5], in: [-2.5, -1.5] });
same('going on to the next section plays straight through', seam(part(3, 14, {}), 'out'), null);
same('a matched fade-in cannot start before the recording', plan.seamFades(chorus2, part(0, 1, {}), 14, steady, 'out')!.in, [-1, -1]);
// A jump to another song, here with one-second beats: the next index is not straight on, the same index is not a loop.
const slow = map.buildGrid(Array.from({ length: 30 }, (_, i) => ({ t: i, one: i % 4 === 0 })), 4, 30, false);
same('a jump to another song never plays straight on', plan.seamFades(chorus2, part(3, 14, {}), 14, steady, 'out', slow), { out: [-2.5, -1.5], in: [-2.5, -1.5] });
same('nor counts as a loop', plan.seamFades(chorus2, part(2, 8, { pickupBeats: 1 }), 14, steady, 'out', slow), { out: [-2.5, -1.5], in: [-2.5, -1.5] });
same("the other song's pickup and fade-in follow its own beats", plan.seamFades(chorus2, part(2, 8, { pickupBeats: 1 }), 14, steady, 'edited', slow), { out: [-2.5, -1.5], in: [-2, -1] });
const chorus = map.sectionViews(s)[2];
const sg = map.songGrid(s);
same('next beat boundary', r3(plan.nextBoundary('beat', 17.3, chorus, sg, chorus.end)), 17.5);
same('next bar boundary', r3(plan.nextBoundary('bar', 17.3, chorus, sg, chorus.end)), 18.5);
same('phrase boundary counts from the section start', r3(plan.nextBoundary('phrase', 17.3, chorus, sg, 30)), 24.5);
same('section boundary is the end', r3(plan.nextBoundary('section', 17.3, chorus, sg, chorus.end)), r3(chorus.end));
same('seam end of the last section stops at the end of the audio', r3(plan.seamEnd(map.sectionViews(s)[5], sg, s.duration)), 50);
const base = { idx: 2, pass: 1, repeats: 2, count: 6, hold: false, pick: null };
same('repeats loop the section', plan.decideNext(base), { idx: 2, pass: 2, reason: 'plan' });
same('then the plan moves on', plan.decideNext({ ...base, pass: 2 }), { idx: 3, pass: 1, reason: 'plan' });
same('hold keeps the section', plan.decideNext({ ...base, pass: 2, hold: true }), { idx: 2, pass: 3, reason: 'hold' });
same('a pick wins', plan.decideNext({ ...base, pick: 5 }), { idx: 5, pass: 1, reason: 'pick' });
same('the song ends after the last section', plan.decideNext({ ...base, idx: 5, pass: 1, repeats: 1 }), 'end');
same('audition stops after its passes', plan.decideNext({ ...base, only: { idx: 2, passes: 2 }, pass: 2 }), 'end');
same('pad clock boundary', plan.clockBoundary(10, 2, 13.1), 14);
const fadeOut = plan.fadeCurve(1, 0, 10, 12);
const fadeIn = plan.fadeCurve(0, 1, 10, 12);
same('fades run from their start to their end', [fadeOut[0], fadeOut.at(-1), fadeIn[0], fadeIn.at(-1)], [{ t: 10, v: 1 }, { t: 12, v: 0 }, { t: 10, v: 0 }, { t: 12, v: 1 }]);
same('a crossfade keeps its power steady', fadeOut.map((point, i) => r3(point.v ** 2 + fadeIn[i].v ** 2)), fadeOut.map(() => 1));
same('half way through a crossfade, each side is 3 dB down', r3(fadeOut[8].v), 0.707);
same('a fade can start partway', plan.fadeCurve(0.5, 0, 0, 1)[0].v, 0.5);
const quiet = plan.fadeCurve(1, 0, 0, 6, plan.EVEN_LOUDNESS);
same('a pause fade lowers heard loudness (gain^0.6) in a straight line', quiet.map(point => r3(point.v ** 0.6)), quiet.map((_, i) => r3(1 - i / 16)));
same('half way through a pause fade, it is 10 dB down', Math.round(20 * Math.log10(quiet[8].v)), -10);

// .djw round trip and v1 read.
const text = djw.serializeDjw({ ...s, source: 'https://youtu.be/x', audioFile: '/tmp/a.mp3' }, { includeAudioPath: false });
const back = djw.parseDjw(text);
same('djw keeps the source but not the path', [back.source, back.audioFile], ['https://youtu.be/x', undefined]);
same('djw round trip sections', back.sections.map(x => [x.type, r3(x.at)]), map.sectionViews(s).map(v => [v.section.type, r3(v.start)]));
same('djw round trip keys', back.sections.map(x => x.key), map.sectionViews(s).map(v => v.key));
same('djw round trip beats', back.taps.length, map.songGrid(s).beats.length);
same('djw round trip ones', back.taps.filter(x => x.one).length, map.songGrid(s).downbeats.length);
const v1 = djw.parseDjw(readFileSync(new URL('../way-maker.sample.djw', import.meta.url), 'utf8'));
same('djw v1 title', v1.title, 'Way Maker');
same('djw v1 parts become sections', v1.sections.slice(0, 2).map(x => [x.type, x.at, x.pickupBeats]), [['intro', 3.2, 0], ['verse', 17.33, 1]]);

// Library file round trip.
const backup = await import('../src/lib/backup.ts');
const packed = backup.packLibrary({
  songs: [{ id: 's1', title: 'Way Maker', taps: [{ t: 1.5, one: true }] }, { id: 's2', title: 'Gratitude', taps: [] }],
  pads: [{ id: 'p1', title: 'D Pad', tonic: 2 }],
  sets: [{ id: 'set1', name: 'Sunday', songIds: ['s2', 's1'] }],
  audio: [
    ['s1', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' })],
    ['s2', new Blob([new Uint8Array([0, 255])], { type: 'audio/wav' })],
    ['p1', new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'audio/mpeg' })],
  ],
} as never);
const unpacked = await backup.unpackLibrary(packed);
same('library file keeps every record', [unpacked.songs, unpacked.pads, unpacked.sets], [
  [{ id: 's1', title: 'Way Maker', taps: [{ t: 1.5, one: true }] }, { id: 's2', title: 'Gratitude', taps: [] }],
  [{ id: 'p1', title: 'D Pad', tonic: 2 }],
  [{ id: 'set1', name: 'Sunday', songIds: ['s2', 's1'] }],
]);
const bytes = await Promise.all(unpacked.audio.map(async ([id, blob]) => [id, blob.type, [...new Uint8Array(await blob.arrayBuffer())]]));
same('library file keeps every recording, byte for byte', bytes, [['s1', 'audio/mpeg', [1, 2, 3]], ['s2', 'audio/wav', [0, 255]], ['p1', 'audio/mpeg', [9, 8, 7, 6]]]);
const problem = (file: Blob) => backup.unpackLibrary(file).then(() => 'read', error => error.message);
same('a file that is not a library says so', await problem(new Blob(['{"songs": []}'])), 'This is not a Lampcircle library file.');
same('a library file cut short says so', await problem(packed.slice(0, packed.size - 1)), 'This library file is incomplete. Export it again.');
same('library file name', backup.libraryFileName(new Date(2026, 9, 21)), 'lampcircle-library-2026-10-21.lampcircle');

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nALL PASS');
