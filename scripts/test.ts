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
// .djw maps with no audio wait for you to choose it. A second one waits behind the first instead of replacing it.
const [wayMaker, goodFather] = [{ title: 'Way Maker' }, { title: 'Good Good Father' }] as never[];
same('a recording goes to the map waiting longest', lib.mapForRecording([wayMaker, goodFather], null), wayMaker);
same('or to the map you chose audio for', lib.mapForRecording([wayMaker, goodFather], goodFather), goodFather);
same('a choice that is no longer waiting goes to the oldest', lib.mapForRecording([goodFather], wayMaker), goodFather);

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
same('a map without lyrics writes no lyrics keys', /\blyrics:|slide_bars/.test(text), false);
// A map opened from a .djw, the way importSong builds it, minus the audio.
const opened = (m: import('../src/lib/djw.ts').DjwMap, duration = 30) =>
  ({
    ...{ id: 'w', title: m.title, artist: m.artist, duration, source: m.source, peaks: [], chroma: [], beatsPerBar: m.beatsPerBar, taps: m.taps, fill: false },
    ...{ sections: m.sections.map((x, i) => ({ id: `w${i}`, ...x })), lyrics: m.lyrics, marksEnd: m.marksEnd ?? duration, refined: true, updatedAt: 0, addedAt: 0 },
  }) as import('../src/types.ts').Song;
const meaning = (x: import('../src/types.ts').Song) => [
  [x.title, x.artist, x.source, map.songGrid(x).beats.map(r3)],
  map.sectionViews(x).map(v => [v.name, v.s, v.e, v.section.pickupBeats, v.section.fadeInBeats, v.section.fadeOutBeats, v.section.repeats, v.section.jumpAt]),
];
const sampleSong = opened(v1);
const sampleText = djw.serializeDjw(sampleSong, { includeAudioPath: false });
same('the v1 sample exported and read back means the same', meaning(opened(djw.parseDjw(sampleText))), meaning(sampleSong));
same('and exports the same again', djw.serializeDjw(opened(djw.parseDjw(sampleText)), { includeAudioPath: false }), sampleText);
same('the v1 sample writes no lyrics keys', /\blyrics:|slide_bars/.test(sampleText), false);

// Lyrics round trip: slides of several lines, a deliberate blank, a chorus shared by two sections. Placeholder words.
const words = {
  source: 'lrclib:5170474',
  offset: -0.25,
  leadBeats: 1.5,
  fadeBeats: 1,
  blocks: {
    'verse-1': [['First line', 'second line'], ['Third line: with # marks', '- and a dash']],
    chorus: [['Chorus one', 'chorus two'], [], ['Chorus three']],
    bridge: [['Bridge line']],
  },
};
const lyricFor: Record<string, import('../src/types.ts').SectionLyric> = {
  'Verse 1': { block: 'verse-1', slideBars: [0, 2] },
  Chorus: { block: 'chorus', slideBars: [0, 1, 3] },
  Bridge: { block: 'bridge', slideBars: [0] },
  Outro: { block: 'chorus', slideBars: [0, 2, 3] },
};
const sung = { ...s, lyrics: words, sections: map.sectionViews(s).map(v => (lyricFor[v.name] ? { ...v.section, lyric: lyricFor[v.name] } : v.section)) };
const sungText = djw.serializeDjw(sung, { includeAudioPath: false });
const sungWarnings: string[] = [];
const sungBack = djw.parseDjw(sungText, sungWarnings);
same('lyrics survive export and import', sungBack.lyrics, words);
same('so does the block and slide bars of each section', sungBack.sections.map(x => x.lyric ?? null), map.sectionViews(sung).map(v => v.section.lyric ?? null));
same('and reading them back warns of nothing', sungWarnings, []);
same('blocks are written as literal text, a blank line between slides', sungText.includes('    chorus: |\n      Chorus one\n      chorus two\n\n      -\n\n      Chorus three\n'), true);
same('slide bars are written on one line', sungText.includes('    lyrics: chorus\n    slide_bars: [ 0, 1, 3 ]\n'), true);
const again = djw.parseDjw(djw.serializeDjw(opened(sungBack, s.duration), { includeAudioPath: false }));
same('a second export and import keeps them too', [again.lyrics, again.sections.map(x => x.lyric ?? null)], [words, sungBack.sections.map(x => x.lyric ?? null)]);

// Bad lyrics never stop a map from opening. What can't be used is left out or clamped, with a warning.
// The Verse's end_bar says 3, but the Chorus starts on bar 5, and that is where the app ends the Verse.
const badMap = (lyrics: string, verse = '', chorus = '') => `djw: 2
song: { title: Bad Lyrics, meter: 4/4 }
grid:
  beats: [${Array.from({ length: 32 }, (_, i) => i / 2).join(', ')}]
  downbeats: [0, 2, 4, 6, 8, 10, 12, 14]
${lyrics}
sections:
  - { name: Verse, type: verse, start_bar: 1, end_bar: 3, pickup_beats: 0, fade_in: 1, fade_out: 1, repeats: 1, jump_at: bar${verse} }
  - { name: Chorus, type: chorus, start_bar: 5, end_bar: 9, pickup_beats: 0, fade_in: 1, fade_out: 1, repeats: 1, jump_at: bar${chorus} }
`;
const openBad = (text: string) => {
  const warnings: string[] = [];
  const m = djw.parseDjw(text, warnings);
  return { sections: m.sections.map(x => [x.type, x.at, x.lyric ?? null]), lyrics: m.lyrics ?? null, warnings };
};
same('lyrics that are a number are left out', openBad(badMap('lyrics: 5', '', ', lyrics: chorus, slide_bars: [0]')), {
  sections: [['verse', 0, null], ['chorus', 8, null]],
  lyrics: null,
  warnings: ['The lyrics in this file could not be read, so they were left out.', 'Chorus shows lyrics "chorus", which this file does not have, so it stays blank.'],
});
same('blocks as a list are left out and lead_beats is clamped', openBad(badMap('lyrics:\n  lead_beats: 100\n  blocks: [a, b]')), {
  sections: [['verse', 0, null], ['chorus', 8, null]],
  lyrics: { leadBeats: 8, blocks: {} },
  warnings: ['lyrics.blocks is not a set of named blocks, so it was left out.', 'lyrics.lead_beats 100 became 8.'],
});
const badBlocks = 'lyrics:\n  source: 7\n  fade_beats: 1.2\n  blocks:\n    verse: |\n      One\n      two\n\n      Three\n\n\n      Four\n    empty: ""\n    number: 12';
same('bad blocks and slide bars are dropped or clamped, a missing block shows blank', openBad(badMap(badBlocks, ', lyrics: verse, slide_bars: ["x", -3, 99, 2, 2]', ', lyrics: verse, slide_bars: [0, 1, 2, 3]')), {
  sections: [['verse', 0, { block: 'verse', slideBars: [0, 2, 3] }], ['chorus', 8, { block: 'verse', slideBars: [0, 1, 2] }]],
  lyrics: { fadeBeats: 1, blocks: { verse: [['One', 'two'], ['Three'], ['Four']] } },
  warnings: [
    'Lyrics block "empty" has no words to show, so it was left out.',
    'Lyrics block "number" has no words to show, so it was left out.',
    'lyrics.source could not be read, so it was left out.',
    'lyrics.fade_beats 1.2 became 1.',
    'Verse slide_bars ["x",-3,99,2,2] became [0,2,3].',
    'Chorus slide_bars [0,1,2,3] became [0,1,2].',
  ],
});
same('a section pointing to a missing block shows blank', openBad(badMap(badBlocks, ', lyrics: nope')).sections[0], ['verse', 0, null]);
same('slide bars that loop back on themselves still open', openBad(badMap(badBlocks, ', lyrics: verse, slide_bars: &x [*x]', ', lyrics: &y [*y]')).sections, [['verse', 0, { block: 'verse', slideBars: [0] }], ['chorus', 8, null]]);

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
same('a file that is not a library says so', await problem(new Blob(['{"songs": []}'])), 'This is not a Lamp Circle library file.');
same('a library file cut short says so', await problem(packed.slice(0, packed.size - 1)), 'This library file is incomplete. Export it again.');
same('library file name', backup.libraryFileName(new Date(2026, 9, 21)), 'lampcircle-library-2026-10-21.lampcircle');

// Hold in Perform, on an audio clock the test moves. Bars are 2 s. The Verse (8-16 s) has a 2-beat pickup and a
// 2-beat fade-in, so its next pass starts sounding 2 s before its seam, and this pass fades out over the last beat.
let clockNow = 0;
const gainNode = () => ({ gain: { value: 0, cancelScheduledValues() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }, connect: (to: unknown) => to, disconnect() {} });
Object.assign(globalThis, {
  window: { setInterval: () => 0, clearInterval() {} },
  AudioContext: class {
    destination = {};
    get currentTime() {
      return clockNow;
    }
    createGain = gainNode;
    createAnalyser = () => ({ ...gainNode(), fftSize: 0 });
    createBufferSource = () => ({ connect: (to: unknown) => to, start() {}, stop() {} });
    resume = async () => {};
  },
});
const engine = await import('../src/audio/engine.ts');
const holdSection = (type: string, at: number, more = {}) => ({ id: type, type, at, pickupBeats: 0, fadeInBeats: 0, fadeOutBeats: 1, repeats: 1, jumpAt: 'section', ...more });
const holdSong = {
  ...{ id: 'hold', title: 'Hold', artist: '', duration: 32, peaks: [], chroma: [], beatsPerBar: 4, fill: false, marksEnd: 32, refined: true, updatedAt: 0, addedAt: 0 },
  taps: Array.from({ length: 64 }, (_, i) => ({ t: i * 0.5, one: i % 4 === 0 })),
  sections: [holdSection('intro', 0), holdSection('verse', 8, { pickupBeats: 2, fadeInBeats: 2 }), holdSection('chorus', 16)],
} as never;
const holdPs = { song: holdSong, grid: map.songGrid(holdSong), views: map.sectionViews(holdSong), buffer: { duration: 32 } } as never;
type Session = InstanceType<typeof engine.PerformSession>;
/** Plays the Verse, doing each step the given seconds before its seam. Returns the passes as they land, as "section.pass". */
function perform(steps: Array<[number, (session: Session) => void]>): string[] {
  clockNow = 0;
  const session = new engine.PerformSession(async () => null);
  session.startSong(holdPs, { from: 1 });
  const first = session.segments[0];
  const seamAt = first.landingCtx + (first.seamAudio - first.landingAudio);
  const landed: string[] = [];
  for (let i = 0; clockNow < seamAt + 9; clockNow += 0.01) {
    while (i < steps.length && clockNow >= seamAt - steps[i][0]) steps[i++][1](session);
    session.tick();
    const now = session.segments[0];
    if (now && clockNow >= now.landingCtx && landed.at(-1) !== `${now.idx}.${now.pass}`) landed.push(`${now.idx}.${now.pass}`);
  }
  return landed;
}
let shown: boolean[] = [];
const look = (session: Session) => shown.push(session.snapshot().song!.hold);
same('hold loops the Verse', perform([[6, session => session.toggleHold()]]).slice(0, 3), ['1.1', '1.2', '1.3']);
const letGo = perform([[6, session => session.toggleHold()], [1.5, session => (session.toggleHold(), look(session))]]);
same('letting go after the loop starts coming in still moves on, not round again', letGo, ['1.1', '2.1']);
same('and Hold shows off at once', shown, [false]);
shown = [];
const tooLate = perform([[6, session => session.toggleHold()], [0.3, session => (session.toggleHold(), look(session), session.toggleHold(), look(session))], [-0.1, look]]);
same('once the Verse is fading out under the loop, it plays once more and then moves on', tooLate, ['1.1', '1.2', '2.1']);
same('Hold stays lit until that loop lands, a second press keeps it letting go, then it shows off', shown, [true, true, false]);

// Finding lyrics: caption and LRC parsers, clean-up, LRCLIB, and the order sources are tried in. Words are made up.
const lyr = await import('../src/lib/lyricsFetch.ts');
const timed = (lines: Array<{ start: number; end: number; text: string; kind: string }>) => lines.map(line => [r3(line.start), r3(line.end), line.text, line.kind]);
const json3 = (events: unknown[]) => JSON.stringify({ wireMagic: 'pb3', events });
const autoJson3 = json3([
  { tStartMs: 0, dDurationMs: 484210, id: 1 },
  { tStartMs: 440, dDurationMs: 6930, segs: [{ utf8: '[Music]' }] },
  { tStartMs: 4090, dDurationMs: 3280, aAppend: 1, segs: [{ utf8: '\n' }] },
  { tStartMs: 19800, dDurationMs: 12759, segs: [{ utf8: 'shine' }, { utf8: ' a', tOffsetMs: 840 }, { utf8: ' light', tOffsetMs: 920 }] },
  { tStartMs: 24000, dDurationMs: 9000, segs: [{ utf8: '♪ ' }, { utf8: 'on', tOffsetMs: 500 }, { utf8: ' the hill', tOffsetMs: 900 }] },
  { tStartMs: 30000, dDurationMs: 2000, segs: [{ utf8: '  ' }] },
  { tStartMs: 31000, dDurationMs: 6000, segs: [{ utf8: 'on the hill' }] },
]);
same('json3: [Music], newline and blank events are skipped, a line runs until the next starts', timed(lyr.parseJson3(autoJson3, 'auto')), [
  [19.8, 24, 'shine a light', 'auto'],
  [24.5, 30, 'on the hill', 'auto'],
  [31, 37, 'on the hill', 'auto'],
]);
const autoVtt = [
  'WEBVTT', 'Kind: captions', 'Language: en', '', 'NOTE made up words', '', 'STYLE', '::cue { color: white }', '',
  '00:00:01.000 --> 00:00:04.000 align:start position:0%', ' ', 'shine<00:00:01.500><c> a</c><00:00:02.000><c> light</c>', '',
  '00:00:04.000 --> 00:00:04.010 align:start position:0%', 'shine a light', ' ', '',
  '00:00:04.010 --> 00:00:07.000 align:start position:0%', 'shine a light', 'on<00:00:05.000><c> the</c><00:00:05.500><c> hill</c>', '',
  '00:00:07.000 --> 00:00:07.010 align:start position:0%', 'on the hill', ' ', '',
  '00:00:07.010 --> 00:00:09.000 align:start position:0%', 'on the hill', 'on<00:00:07.500><c> the</c><00:00:08.000><c> hill</c>', '',
  '01:02.000 --> 01:04.500', '[Music] bread &amp; wine', '',
  '01:10.000 --> 01:12.000', 'bread &amp; wine', '',
].join('\n');
same('vtt: word tags out, rolling repeats once, a line sung twice kept twice, also after a gap, mm:ss cues', timed(lyr.parseVtt(autoVtt, 'auto')), [
  [1, 4, 'shine a light', 'auto'],
  [4.01, 7, 'on the hill', 'auto'],
  [7.01, 9, 'on the hill', 'auto'],
  [62, 64.5, 'bread & wine', 'auto'],
  [70, 72, 'bread & wine', 'auto'],
]);
const manualVtt = 'WEBVTT\n\n1\n00:00:20.000 --> 00:00:30.000\nLine one here\nline two here\n\n2\n00:00:30,000 --> 00:00:39,500 line:90%\n<i>Third</i> line\n';
same('vtt: a manual cue is one line, SRT commas read too', timed(lyr.parseVtt(manualVtt, 'manual')), [
  [20, 30, 'Line one here line two here', 'manual'],
  [30, 39.5, 'Third line', 'manual'],
]);
const lrc = '[ar:Made Up Band]\n[ti:Made Up Song]\n[offset:+500]\n[00:12.00]Shine a light\n[00:15.50][01:10.00]On the hill\n[00:20.00]\n[00:21.00]<00:21.00>Word <00:21.50>by word\n';
same('lrc: tags skipped, offset applied, one line at two times, gaps end lines, last runs to the song end', timed(lyr.parseLrc(lrc, 72)), [
  [11.5, 15, 'Shine a light', 'lrc'],
  [15, 19.5, 'On the hill', 'lrc'],
  [20.5, 28.5, 'Word by word', 'lrc'],
  [69.5, 72, 'On the hill', 'lrc'],
]);
same('lrc: without the song length the last line lasts 5 s', timed(lyr.parseLrc(lrc)).at(-1), [69.5, 74.5, 'On the hill', 'lrc']);
same('lrc: a line ends by the song end', timed(lyr.parseLrc('[00:09.00]a\n[00:12.00]b', 10)), [[9, 10, 'a', 'lrc'], [12, 17, 'b', 'lrc']]);
const rolling = [
  { start: 0, end: 3, text: '[Music]', kind: 'auto' },
  { start: 3, end: 6, text: '♪ shine a light ♪', kind: 'auto' },
  { start: 5, end: 8, text: 'shine a light', kind: 'auto' },
  { start: 7, end: 10, text: 'shine a light on', kind: 'auto' },
  { start: 9.5, end: 12, text: 'shine a  light on the hill', kind: 'auto' },
  { start: 12.5, end: 14, text: 'shine a light', kind: 'auto' },
] as const;
same('clean-up: [Music] and ♪ out, an overlapping repeat or a line growing word by word is one line', timed(lyr.cleanLines(rolling.map(line => ({ ...line })))), [
  [3, 12, 'shine a light on the hill', 'auto'],
  [12.5, 14, 'shine a light', 'auto'],
]);

/** A stand-in for fetch: answers by LRCLIB path, and remembers what was asked. */
function fakeLrclib(answer: (path: string, url: URL) => Response | Promise<Response>) {
  const calls: Array<{ path: string; params: Record<string, string>; client: string | null }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api', '');
    calls.push({ path, params: Object.fromEntries(url.searchParams), client: new Headers(init?.headers).get('Lrclib-Client') });
    return answer(path, url);
  }) as typeof fetch;
  return { fetchFn, calls };
}
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const record = (id: number, duration: number, more = {}) => ({
  ...{ id, trackName: 'Made Up Song', artistName: 'Made Up Band', duration, instrumental: false, plainLyrics: 'Shine a light' },
  ...{ syncedLyrics: '[00:01.00]Shine a light\n[00:04.00]On the hill' },
  ...more,
});
const lookup = { title: 'Made Up Song', artist: 'Made Up Band', duration: 198.1 };
const summary = (found: Awaited<ReturnType<typeof lyr.findLyrics>>) => (found ? [found.source, found.kind, found.lines.length, found.note ?? null] : null);

let lrclib = fakeLrclib(() => jsonResponse(record(7, 198)));
same('LRCLIB: a duration match from get', summary(await lyr.lrclibLyrics(lookup, lrclib.fetchFn)), ['lrclib:7', 'lrc', 2, null]);
same('and it asks with the rounded length, naming the app', [lrclib.calls[0].path, lrclib.calls[0].params.duration, /^LampCircle\/\S+ \(https:\/\/github\.com\/kevnk\/lampcircle\)$/.test(lrclib.calls[0].client ?? '')], ['/get', '198', true]);
lrclib = fakeLrclib(path =>
  path === '/get'
    ? jsonResponse({ code: 404, name: 'TrackNotFound' }, 404)
    : jsonResponse([record(1, 198, { syncedLyrics: null }), record(2, 198, { instrumental: true, syncedLyrics: '' }), record(3, 240), record(4, 199.5)]),
);
same('LRCLIB: a get miss searches, and takes the synced record closest in length', summary(await lyr.lrclibLyrics(lookup, lrclib.fetchFn)), ['lrclib:4', 'lrc', 2, null]);
lrclib = fakeLrclib((path, url) => (path === '/search' && !url.searchParams.has('artist_name') ? jsonResponse([record(5, 260)]) : jsonResponse(path === '/get' ? { code: 404 } : [], path === '/get' ? 404 : 200)));
const far = await lyr.lrclibLyrics(lookup, lrclib.fetchFn);
same('LRCLIB: then by title alone, and a record far in length says so', [summary(far)?.slice(0, 3), /61\.9 s off/.test(far?.note ?? ''), lrclib.calls.map(call => call.path)], [['lrclib:5', 'lrc', 2], true, ['/get', '/search', '/search']]);
lrclib = fakeLrclib(() => jsonResponse(record(9, 98)));
same('LRCLIB: a get answer over 2 s off says so too', summary(await lyr.lrclibLyrics({ ...lookup, duration: 100.49 }, lrclib.fetchFn))?.[3], "LRCLIB's closest synced lyrics are 2.5 s off this recording's length, so the times may not fit.");
lrclib = fakeLrclib(() => jsonResponse({ message: 'slow down' }, 429, { 'Retry-After': '120' }));
same('LRCLIB: a long 429 is a miss, with no retries', [await lyr.lrclibLyrics(lookup, lrclib.fetchFn), lrclib.calls.length], [null, 3]);
let tries = 0;
lrclib = fakeLrclib(() => (tries++ ? jsonResponse(record(8, 198)) : jsonResponse({}, 429, { 'Retry-After': '0' })));
same('LRCLIB: a short 429 is tried once more', [summary(await lyr.lrclibLyrics(lookup, lrclib.fetchFn)), lrclib.calls.length], [['lrclib:8', 'lrc', 2, null], 2]);
lrclib = fakeLrclib(path => (path === '/get' ? Promise.reject(new TypeError('offline')) : new Response('<html>', { status: 200 })));
same('LRCLIB: no network or a page that is not JSON is a miss', await lyr.lrclibLyrics(lookup, lrclib.fetchFn), null);
same('a title is looked up without the video extras', [
  lyr.songQuery({ title: 'Housefires - Good Good Father ⧸⧸ feat. Pat Barrett (Official Music Video)', artist: '' }),
  lyr.songQuery({ title: 'Good Good Father ⧸⧸ feat. Pat Barrett', artist: 'Housefires' }),
  lyr.songQuery({ title: 'Way Maker Official Live Video', artist: 'Leeland VEVO' }),
  lyr.songQuery({ title: 'Made Up Song | Made Up Band', artist: '' }),
], [
  { title: 'Good Good Father', artist: 'Housefires' },
  { title: 'Good Good Father', artist: 'Housefires' },
  { title: 'Way Maker', artist: 'Leeland' },
  { title: 'Made Up Song', artist: 'Made Up Band' },
]);

const tube = { ...(s as object), ...lookup, source: 'https://www.youtube.com/watch?v=abcdefghijk' } as never;
const manualTrack = { kind: 'manual', lang: 'en', ext: 'json3', text: json3([{ tStartMs: 20000, dDurationMs: 10000, segs: [{ utf8: 'Shine a light on the hill' }] }]) } as const;
const autoTrack = { kind: 'auto', lang: 'en-orig', ext: 'vtt', text: autoVtt } as const;
const lrclibHit = () => fakeLrclib(() => jsonResponse(record(7, 198))).fetchFn;
const lrclibMiss = () => fakeLrclib(path => jsonResponse(path === '/get' ? { code: 404 } : [], path === '/get' ? 404 : 200)).fetchFn;
const lrclibFar = () => fakeLrclib(path => jsonResponse(path === '/get' ? { code: 404 } : [record(5, 260)], path === '/get' ? 404 : 200)).fetchFn;
const tracks = (...list: unknown[]) => async () => list as never;
same('order: manual captions win over LRCLIB', summary(await lyr.findLyrics(tube, { captions: tracks(autoTrack, manualTrack), fetch: lrclibHit() })), ['youtube-subs', 'manual', 1, null]);
same('order: LRCLIB wins over auto captions', summary(await lyr.findLyrics(tube, { captions: tracks(autoTrack), fetch: lrclibHit() })), ['lrclib:7', 'lrc', 2, null]);
same('order: auto captions when LRCLIB misses, flagged to check', summary(await lyr.findLyrics(tube, { captions: tracks(autoTrack), fetch: lrclibMiss() })), [
  'youtube-auto', 'auto', 5, 'These are YouTube auto captions, so check the words.',
]);
same('order: auto captions win over an LRCLIB record far in length', summary(await lyr.findLyrics(tube, { captions: tracks(autoTrack), fetch: lrclibFar() }))?.[0], 'youtube-auto');
same('order: a far LRCLIB record when there are no captions, with its note', summary(await lyr.findLyrics(tube, { captions: tracks(), fetch: lrclibFar() }))?.slice(0, 2), ['lrclib:5', 'lrc']);
same('order: nothing anywhere is null', await lyr.findLyrics(tube, { captions: tracks(), fetch: lrclibMiss() }), null);
same('order: captions failing still tries LRCLIB', summary(await lyr.findLyrics(tube, { captions: async () => Promise.reject(new Error('no yt-dlp')), fetch: lrclibHit() }))?.[0], 'lrclib:7');
let asked = false;
const local = { ...(tube as object), source: 'https://soundcloud.com/x/y' } as never;
same('order: a song not from YouTube goes straight to LRCLIB', [summary(await lyr.findLyrics(local, { captions: async () => ((asked = true), [manualTrack]), fetch: lrclibHit() }))?.[0], asked], ['lrclib:7', false]);

// Found lyrics keep their source on the song. Until they're placed there are no blocks, and the .djw stays clean.
const sourced = lyr.withFoundLyrics(s, (await lyr.findLyrics(tube, { captions: tracks(), fetch: lrclibHit() }))!);
same('the song keeps the source and the timed lines', [sourced.lyrics, sourced.timedLyrics?.length], [{ source: 'lrclib:7', blocks: {} }, 2]);
const sourcedText = djw.serializeDjw(sourced, { includeAudioPath: false });
const sourcedWarnings: string[] = [];
same('a source with no blocks writes just the source, no timed lines', [sourcedText.includes('lyrics:\n  source: lrclib:7\nsections:'), /blocks|timed|Shine/.test(sourcedText)], [true, false]);
same('and reads back the same, with no warnings', [djw.parseDjw(sourcedText, sourcedWarnings).lyrics, sourcedWarnings], [{ source: 'lrclib:7', blocks: {} }, []]);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nALL PASS');
