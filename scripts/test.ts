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
// On iOS a map and its recording come in together, so a recording's file name finds its map.
const exported = { title: 'Holy Forever', audioFile: '/Users/me/Music/hf-live.m4a' } as never;
same('a file name with the title goes to that map', lib.mapForRecording([wayMaker, goodFather], null, 'Good-Good-Father [abc123].mp3'), goodFather);
same('a file name matching the saved audio path goes to that map', lib.mapForRecording([wayMaker, exported], null, 'hf-live.m4a'), exported);
same('a file name matching no map goes to the oldest', lib.mapForRecording([wayMaker, goodFather], null, 'voice memo.m4a'), wayMaker);
same('the map you chose audio for still wins', lib.mapForRecording([wayMaker, goodFather], wayMaker, 'good-good-father.mp3'), wayMaker);
same('a recording names its map by title or saved file', [lib.nameMatch(goodFather, 'Good Good Father.m4a') > 0, lib.nameMatch(exported, 'HF-Live.M4A') > 0, lib.nameMatch(wayMaker, 'Track 01.mp3')], [true, true, 0]);
const [holy, holyForever, cuan] = [{ title: 'Holy' }, { title: 'Holy Forever' }, { title: 'Cuán Grande Es Él' }] as never[];
same('the longest title a file name holds wins', [lib.mapForRecording([holy, holyForever], null, 'Holy Forever (Live).mp3'), lib.mapForRecording([holyForever, holy], null, 'holy.mp3')], [holyForever, holy]);
same('accents do not stop a match', lib.mapForRecording([wayMaker, cuan], null, 'Cuan Grande Es El.m4a'), cuan);

// iOS hands Files picks and the dev seed over as one body: a u32 header length, a JSON header, then the bytes (src-tauri/src/ios.rs).
const { unpack } = await import('../src/platform/tauri.ts');
const header = new TextEncoder().encode(JSON.stringify({ route: 'tap', files: [{ name: 'a.djw', size: 6 }, { name: 'b.mp3', size: 2 }] }));
const body = new Uint8Array(4 + header.length + 8);
new DataView(body.buffer).setUint32(0, header.length, true);
body.set(header, 4);
body.set([...new TextEncoder().encode('djw: 2'), 0, 255], 4 + header.length);
const framed = unpack(body.buffer);
same('framed files come back by name, type and bytes', await Promise.all(framed.files.map(async file => [file.name, file.type, [...new Uint8Array(await file.arrayBuffer())]])), [
  ['a.djw', '', [100, 106, 119, 58, 32, 50]],
  ['b.mp3', 'audio/mpeg', [0, 255]],
]);
same('framed files keep the route', framed.route, 'tap');

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

// Placing lyrics on bars: clean-up, sections, slides, blocks and the offset. 120 BPM in 4/4, so bar n (from 0)
// starts at 2n s and each beat is 0.5 s. Words are made up.
const place = await import('../src/lib/lyricsPlace.ts');
type Line = import('../src/types.ts').TimedLine;
type PlacedSong = import('../src/types.ts').Song;
const at = (bar: number, beat = 1) => bar * 2 + (beat - 1) * 0.5;
/** Sections as [type, first bar, pickup beats], marked up to `marksEnd` bars. */
const barSong = (sections: Array<[string, number, number?]>, bars: number, marksEnd = bars) =>
  ({
    ...{ id: 'bars', title: 'Made Up Song', artist: 'Made Up Band', duration: bars * 2, peaks: [], chroma: [], beatsPerBar: 4, fill: false },
    taps: Array.from({ length: bars * 4 }, (_, i) => ({ t: i * 0.5, one: i % 4 === 0 })),
    sections: sections.map(([type, bar, pickupBeats = 1], i) => ({ id: `s${i}`, type, at: at(bar), pickupBeats, fadeInBeats: 1, fadeOutBeats: 1, repeats: 1, jumpAt: 'phrase' })),
    ...{ marksEnd: at(marksEnd), refined: true, updatedAt: 0, addedAt: 0 },
  }) as PlacedSong;
const line = (start: number, end: number, text: string, kind: Line['kind'] = 'lrc'): Line => ({ start, end, text, kind });
/** A record keyed by section id, keyed by section name instead. */
const byName = <T>(song: PlacedSong, record: Record<string, T>) =>
  Object.fromEntries(map.sectionViews(song).filter(v => record[v.section.id]).map(v => [v.name, record[v.section.id]]));

const twoSong = barSong([['verse', 0], ['chorus', 4]], 8);
const twoGrid = map.songGrid(twoSong);
const tidy = (lines: Line[]) => timed(place.tidyLines(lyr.cleanLines(lines), twoGrid, 4));
same('clean-up: [Music] out, the same words starting within a beat are one line, a real repeat stays', tidy([
  line(0.5, 2, '[Music]', 'manual'),
  line(2, 4, 'Alpha beta gamma', 'manual'),
  line(2.3, 4.5, 'alpha beta gamma!', 'manual'),
  line(6, 8, 'Alpha beta gamma', 'manual'),
]), [[2, 4.5, 'Alpha beta gamma', 'manual'], [6, 8, 'Alpha beta gamma', 'manual']]);
const autoLines = [
  line(2, 7, 'one two three four five six seven eight nine ten', 'auto'),
  line(7.3, 8.3, 'eleven twelve', 'auto'),
  line(8.4, 8.9, 'thirteen', 'auto'),
];
same('auto captions are rebuilt: a new line on a downbeat after 6 words, or at a half-beat gap, capitalized', tidy(autoLines), [
  [2, 6, 'One two three four five six seven eight', 'auto'],
  [6, 7, 'Nine ten', 'auto'],
  [7.3, 8.9, 'Eleven twelve thirteen', 'auto'],
]);
same('a long line splits at a comma near the middle, else the middle word, its time split to match', tidy([
  line(1, 6.1, 'Alpha beta gamma delta, epsilon zeta eta theta iota', 'manual'),
  line(8, 13.6, 'Alpha beta gamma delta epsilon zeta eta theta iota kappa', 'manual'),
]), [
  [1, 3.3, 'Alpha beta gamma delta,', 'manual'],
  [3.3, 6.1, 'epsilon zeta eta theta iota', 'manual'],
  [8, 11, 'Alpha beta gamma delta epsilon', 'manual'],
  [11, 13.6, 'zeta eta theta iota kappa', 'manual'],
]);
same('an LRC line lasts until the next starts, at most 2 bars; a caption keeps its end', [tidy([line(2, 10, 'Alpha'), line(12, 13, 'Beta')]), tidy([line(2, 10, 'Alpha', 'manual')])], [
  [[2, 6, 'Alpha', 'lrc'], [12, 13, 'Beta', 'lrc']],
  [[2, 10, 'Alpha', 'manual']],
]);
same('auto caption slides are marked to check, by section and slide', byName(twoSong, place.placeLyrics(twoSong, autoLines, { source: 'youtube-auto' }).checkWords), { Verse: [0], Chorus: [0] });

/** Which sections a single line lands in. The Verse is bars 0-4, the Chorus bars 4-8 (8 s on), with a 1-beat pickup. */
const home = (one: Line, options: Partial<import('../src/lib/lyricsPlace.ts').PlaceOptions> = {}) =>
  Object.keys(byName(twoSong, place.placeLyrics(twoSong, [one], { source: 'manual', ...options }).sectionLyrics));
same('a line goes to the section it overlaps most, or the next one when it starts in its pickup or a beat before', [
  home(line(2, 4, 'Inside the verse')),
  home(line(5.5, 8.5, 'Mostly in the verse')),
  home(line(6.5, 10, 'Mostly in the chorus')),
  home(line(7, 7.9, 'Two beats early')),
  home(line(6.5, 7.9, 'Three beats early')),
], [['Verse'], ['Verse'], ['Chorus'], ['Chorus'], ['Verse']]);
const nudged = (offset: number, autoOffset = false) => {
  const placed = place.placeLyrics(twoSong, [line(6, 7.5, 'Bar three')], { source: 'manual', offset, autoOffset });
  return [Object.keys(byName(twoSong, placed.sectionLyrics)), placed.offsetUsed, placed.lyrics.offset];
};
same('a nudge moves every line before placing, at most 2 s either way, and is what lyrics.offset keeps', [nudged(2), nudged(5), nudged(-1)], [
  [['Chorus'], 2, 2],
  [['Chorus'], 2, 2],
  [['Verse'], -1, -1],
]);

// A whole song: Intro 0-4, Verse 1 4-12, Chorus 1 12-16, Verse 2 16-24, Chorus 2 24-28, Chorus 3 28-32, Bridge 32-36,
// then 4 bars not in a section. Chorus 2 changes one word of a 14-word slide, Chorus 3 changes a line.
const sungSong = barSong([['intro', 0, 0], ['verse', 4], ['chorus', 12], ['verse', 16], ['chorus', 24], ['chorus', 28], ['bridge', 32, 0]], 40, 36);
const chorusAt = (bar: number, words: string[]) =>
  words.map((text, i) => line(i ? at(bar + i) : at(bar - 1, 4), at(bar + i) + 1.8, text));
const chorusWords = ['Chorus line one of made up words', 'Chorus line two of made up words', 'Chorus line three of made up words', 'Chorus line four of made up words'];
const sungLines = [
  line(at(3, 4), 9.8, 'Verse one first'),
  line(at(5), 11.4, 'Verse one second'),
  line(at(5, 4), 13.8, 'Verse one third'),
  line(at(7), 15.8, 'Verse one fourth'),
  line(at(8, 2), 17.8, 'Verse one fifth'),
  line(at(11, 2), 23.4, 'Verse one sixth'),
  ...chorusAt(12, chorusWords),
  line(at(16), 33.8, 'Verse two first'),
  line(at(17), 35.8, 'Verse two second'),
  line(at(22), 45.8, 'Verse two third'),
  line(at(23), 47.4, 'Verse two fourth'),
  ...chorusAt(24, chorusWords.map(text => text.replace('two', 'too'))),
  ...chorusAt(28, [...chorusWords.slice(0, 3), 'A different ending']),
  line(at(32), 66, 'Bridge words here'),
  line(at(37), 76, 'Words after the last section'),
];
const placedSong = place.placeLyrics(sungSong, sungLines, { source: 'lrclib:1' });
same('blocks: 2 lines a slide, a slide early after 2 bars of quiet, a blank for 4, a chorus shared, a changed one apart', placedSong.lyrics, {
  source: 'lrclib:1',
  offset: 0,
  blocks: {
    'verse-1': [['Verse one first', 'Verse one second'], ['Verse one third', 'Verse one fourth'], ['Verse one fifth'], ['Verse one sixth']],
    chorus: [chorusWords.slice(0, 2), chorusWords.slice(2)],
    'verse-2': [['Verse two first', 'Verse two second'], [], ['Verse two third', 'Verse two fourth']],
    'chorus-3': [chorusWords.slice(0, 2), [chorusWords[2], 'A different ending']],
    bridge: [['Bridge words here']],
  },
});
same('slide bars: from each section start, a beat before a bar snaps on to it, later in a bar snaps back', byName(sungSong, placedSong.sectionLyrics), {
  'Verse 1': { block: 'verse-1', slideBars: [0, 2, 4, 7] },
  'Chorus 1': { block: 'chorus', slideBars: [0, 2] },
  'Verse 2': { block: 'verse-2', slideBars: [0, 2, 6] },
  'Chorus 2': { block: 'chorus', slideBars: [0, 2] },
  'Chorus 3': { block: 'chorus-3', slideBars: [0, 2] },
  Bridge: { block: 'bridge', slideBars: [0] },
});
same('words after the last section are unplaced, and nothing needs checking', [timed(placedSong.unplaced), placedSong.checkWords, placedSong.offsetUsed, placedSong.offsetEstimated], [
  [[74, 76, 'Words after the last section', 'lrc']],
  {},
  0,
  false,
]);
const perSlide = (n: number) => {
  const placed = place.placeLyrics(sungSong, sungLines, { source: 'lrclib:1', linesPerSlide: n });
  return [placed.lyrics.blocks['verse-1'].map(slide => slide.length), byName(sungSong, placed.sectionLyrics)['Verse 1'].slideBars];
};
same('lines per slide: 1 and 4', [perSlide(1), perSlide(4)], [[[1, 1, 1, 1, 1, 1], [0, 1, 2, 3, 4, 7]], [[4, 1, 1], [0, 4, 7]]]);
const longSong = barSong([['verse', 0]], 16);
const lone = (lines: Line[]) => {
  const placed = place.placeLyrics(longSong, lines, { source: 'manual', linesPerSlide: 1 });
  return [placed.lyrics.blocks.verse, placed.sectionLyrics.s0.slideBars];
};
same('words 4 bars into a section open on a blank, 4 quiet bars at its end go blank, slides on one bar are one', [
  lone([line(at(6), at(7), 'Late words')]),
  lone([line(at(1), at(1, 2), 'Quick'), line(at(1, 2), at(1, 3), 'words')]),
], [
  [[[], ['Late words'], []], [0, 6, 7]],
  [[['Quick', 'words'], []], [0, 2]],
]);
const twoVerses = barSong([['verse', 0], ['verse', 4]], 8);
const versesWith = (second: string) =>
  Object.keys(place.placeLyrics(twoVerses, [
    line(0, 1.5, 'a b c d e f g h i j'), line(at(2), at(2) + 1.5, 'yes'), line(at(4), at(4) + 1.5, 'a b c d e f g h i j'), line(at(6), at(6) + 1.5, second),
  ], { source: 'manual', linesPerSlide: 1 }).lyrics.blocks);
same('verses share a block only when every slide matches: 10 of 11 words is not enough if a slide differs', [versesWith('yes'), versesWith('no')], [['verse'], ['verse-1', 'verse-2']]);
const pickupSong = barSong([['intro', 0, 0], ['verse', 4, 2]], 8);
same('quiet after a pickup line counts from where it ends, before the section starts', place.placeLyrics(pickupSong, [line(7, 7.5, 'Pickup'), line(11.5, 12.5, 'Two bars on')], { source: 'manual' }).sectionLyrics.s1, {
  block: 'verse',
  slideBars: [0, 2],
});

const moved = (by: number) => sungLines.map(item => ({ ...item, start: item.start + by, end: item.end + by }));
const estimated = place.placeLyrics(sungSong, moved(-3), { source: 'lrclib:1', autoOffset: true });
same('auto-offset finds a record 3 s early from downbeats and section starts, and places it the same', [
  estimated.offsetUsed, estimated.offsetEstimated, estimated.lyrics, estimated.sectionLyrics,
], [3, true, placedSong.lyrics, placedSong.sectionLyrics]);
same('and one 3 s late, not a whole bar or two off', place.placeLyrics(sungSong, moved(3), { source: 'lrclib:1', autoOffset: true }).offsetUsed, -3);
const estimatedNudge = place.placeLyrics(sungSong, moved(-3), { source: 'lrclib:1', autoOffset: true, offset: 0.5 });
same('a nudge moves the estimate, and lyrics.offset keeps just the nudge', [estimatedNudge.offsetUsed, estimatedNudge.lyrics.offset], [3.5, 0.5]);

// A placed song keeps its lead and fade, drops a lyric its section no longer has, and survives a .djw round trip.
const before = { ...sungSong, lyrics: { leadBeats: 3, fadeBeats: 0.5, blocks: { old: [['Old words']] } }, sections: sungSong.sections.map((x, i) => (i ? x : { ...x, lyric: { block: 'old', slideBars: [0] } })) };
const sungPlaced = place.withPlacement(before, placedSong);
const placedWarnings: string[] = [];
const placedBack = djw.parseDjw(djw.serializeDjw(sungPlaced, { includeAudioPath: false }), placedWarnings);
same('a placed song exported and read back keeps its words, lead, fade and slide bars', [placedBack.lyrics, placedBack.sections.map(x => x.lyric ?? null), placedWarnings], [
  { source: 'lrclib:1', offset: 0, leadBeats: 3, fadeBeats: 0.5, blocks: placedSong.lyrics.blocks },
  [null, ...Object.values(byName(sungSong, placedSong.sectionLyrics))],
  [],
]);

const farPlaced = await place.findAndPlaceLyrics(tube, { captions: tracks(), fetch: lrclibFar() });
const nearPlaced = await place.findAndPlaceLyrics(tube, { captions: tracks(), fetch: lrclibHit() });
same('find and place: a far LRCLIB record gets its offset estimated, a matching one does not', [
  farPlaced?.placement.offsetEstimated, nearPlaced?.placement.offsetEstimated, nearPlaced?.song.lyrics?.source, nearPlaced?.song.timedLyrics?.length,
], [true, false, 'lrclib:7', 2]);

// Slide changes on the screen: the cue from a Perform snapshot, then the cues a display gets. 120 BPM in 4/4, so bar n
// starts at 2n s and a beat is 0.5 s. Intro 0-4, Verse 4-12, Chorus 12-16, Bridge 16-20 with a 2-beat pickup, then an
// Instrumental with no words to bar 24. The Verse's third slide is a "-" blank. Words are made up.
const cueLib = await import('../src/lib/lyricsCue.ts');
type CueSnap = import('../src/audio/engine.ts').Snapshot;
type CueIn = import('../src/lib/lyricsCue.ts').CueInput;
const withWords = (song: PlacedSong, more: Partial<import('../src/types.ts').Lyrics> = {}) => {
  const slideBars: Record<string, number[]> = { verse: [0, 2, 4, 6], chorus: [0, 2], bridge: [0] };
  return {
    ...song,
    lyrics: { blocks: { verse: [['Verse a'], ['Verse b'], [], ['Verse c']], chorus: [['Chorus a'], ['Chorus b']], bridge: [['Bridge a']] }, ...more },
    sections: song.sections.map(x => (slideBars[x.type] ? { ...x, lyric: { block: x.type, slideBars: slideBars[x.type] } } : x)),
  } as PlacedSong;
};
const cueBase = barSong([['intro', 0, 0], ['verse', 4], ['chorus', 12], ['bridge', 16, 2], ['instrumental', 20, 0]], 24);
const psOf = (song: PlacedSong) => ({ song, grid: map.songGrid(song), views: map.sectionViews(song) });
const cuePs = psOf(withWords(cueBase));
/** `pos` audio seconds into section `idx` (Verse 1, Chorus 2, Bridge 3), the next pass landing at `next[1]`, in this pass's audio seconds. */
const snapAt = (idx: number, pos: number, next?: [number, number], more: Partial<NonNullable<CueSnap['song']>> = {}, paused = false): CueSnap => ({
  paused,
  song: {
    ...{ title: 'Made Up Song', idx, pass: 1, repeats: 1, hold: false, bar: 0, beat: 1, beatsPerBar: 4, pos, barsLeft: 0, secondsLeft: 0 },
    next: next ? { idx: next[0], reason: 'plan', bars: 0, beats: 0, landingCtx: next[1] + 100 } : null,
    ...{ ending: false, forced: false, arriving: false, ...more },
  },
  ...{ pad: null, padFading: false, clock: null },
});
/** The cue, with context time 100 s ahead of audio time. Gives [now, next, change time in audio seconds, fade seconds]. */
const cueOf = (snapshot: CueSnap, ps = cuePs, prefs?: import('../src/lib/lyricsCue.ts').LyricsPrefs) => {
  const cue = cueLib.lyricsCue(snapshot, ps, snapshot.song!.pos + 100, prefs);
  return [cue.now, cue.next, cue.changeAt === null ? null : r3(cue.changeAt - 100), r3(cue.fadeSeconds)];
};
const inVerse = (pos: number) => snapAt(1, pos, [2, 24]);
same('in a section: the next slide comes in 2 beats before its bar and fades over a beat; a "-" blank comes in on its bar', [inVerse(10), inVerse(11.2), inVerse(16.2)].map(x => cueOf(x)), [
  [['Verse a'], ['Verse b'], 11, 0.5],
  [['Verse b'], [], 16, 0.5],
  [[], ['Verse c'], 19, 0.5],
]);
same('in order across a section change: the next section first slide counts back from where it lands', cueOf(inVerse(22)), [['Verse c'], ['Chorus a'], 23, 0.5]);
same('a loop back to the same section, and a hold, bring back its first slide', [cueOf(snapAt(2, 30, [2, 32])), cueOf(snapAt(1, 22, [1, 24], { hold: true }))], [
  [['Chorus b'], ['Chorus a'], 31, 0.5],
  [['Verse c'], ['Verse a'], 23, 0.5],
]);
const toBridge = (pos: number) => snapAt(1, pos, [3, 16]);
same('a picked jump: the Bridge comes in 2.5 beats ahead for its 2-beat pickup, and Verse slides past the jump never show', [10, 13, 15].map(pos => cueOf(toBridge(pos))), [
  [['Verse a'], ['Verse b'], 11, 0.5],
  [['Verse b'], ['Bridge a'], 14.75, 0.5],
  [['Bridge a'], null, null, 0.5],
]);
const tightBase = withWords(cueBase, { leadBeats: 5 });
const tightPs = psOf({ ...tightBase, sections: tightBase.sections.map(x => (x.type === 'chorus' ? { ...x, lyric: { block: 'chorus', slideBars: [0, 1] } } : x)) });
same('a 5-beat lead with the next section slides a bar apart cues its second slide before it lands too', cueOf(inVerse(23), tightPs), [['Chorus a'], ['Chorus b'], 23.5, 0.5]);
same('a jump that lands on a bar with its own slide, into a section with no words, never shows that slide', cueOf(snapAt(2, 27.2, [4, 28])), [['Chorus a'], [], 28, 0.5]);
same('a pick too late for its lead puts its slide up now; taking the plan back returns to the slide that was up', [cueOf(toBridge(15.5)), cueOf(inVerse(15.55))], [
  [['Bridge a'], null, null, 0.5],
  [['Verse b'], [], 16, 0.5],
]);
same('paused: the slide stays and nothing is cued', cueOf(snapAt(1, 10, [2, 24], {}, true)), [['Verse a'], null, null, 0.5]);
same('between songs, and through a song with no words, the screen is idle', [
  cueLib.lyricsCue({ ...inVerse(10), song: null }, null, 50),
  cueLib.lyricsCue(inVerse(10), psOf(cueBase), 110).idle,
], [{ now: [], since: null, next: null, changeAt: null, fadeSeconds: 0.5, idle: true }, true]);
same('a song coming in before its first slide is due leaves up what is up', cueOf(snapAt(1, 6.9, [2, 24], { arriving: true })), [null, ['Verse a'], 7, 0.5]);
const leadIs = (lyrics: Partial<import('../src/types.ts').Lyrics>, prefs?: import('../src/lib/lyricsCue.ts').LyricsPrefs) => {
  const ps = psOf(withWords(cueBase, lyrics));
  return [cueOf(inVerse(10), ps, prefs).slice(2), cueOf(inVerse(22), ps, prefs)[2]];
};
same('lead and fade: the song value, else the app value; a first slide never later than half a beat before its pickup', [
  leadIs({ leadBeats: 3 }),
  leadIs({ leadBeats: 1 }),
  leadIs({}, { leadBeats: 1, fadeBeats: 2 }),
  leadIs({ leadBeats: 3, fadeBeats: 1.5 }, { leadBeats: 1, fadeBeats: 2 }),
], [
  [[10.5, 0.5], 22.5],
  [[11.5, 0.5], 23.25],
  [[11.5, 1], 23.25],
  [[10.5, 0.75], 22.5],
]);
const slowSong = {
  ...withWords(cueBase),
  duration: 60,
  taps: Array.from({ length: 100 }, (_, i) => ({ t: i < 20 ? i * 0.5 : 10 + (i - 20) * 0.6, one: i % 4 === 0 })),
} as PlacedSong;
same('a slower stretch on the tapped grid moves the change and lengthens the fade', cueOf(snapAt(1, 10), psOf(slowSong)), [['Verse a'], ['Verse b'], 11.2, 0.6]);
same('held, a Verse that starts faster than it ends counts the lead on its own first beats', cueOf(snapAt(1, 23, [1, 24.4]), psOf(slowSong)), [['Verse c'], ['Verse a'], 23.4, 0.6]);

/** Feeds the sequencer one [context time, snapshot, input] per tick, the display clock in ms on the context clock. The cues sent per tick, as [seq, words or "-" or "logo", at, fade ms]. */
function feed(ticks: Array<[number, CueSnap, Partial<CueIn>?]>, ps: Parameters<typeof cueLib.lyricsCue>[1] = cuePs) {
  let state = cueLib.CUE_START;
  return ticks.map(([ctxNow, snapshot, input = {}]) => {
    const step = cueLib.nextCue(state, cueLib.lyricsCue(snapshot, ps, ctxNow), { ctxNow, ms: ctxNow * 1000, ...input });
    state = step.state;
    return step.cues.map(cue => [cue.seq, cue.text || (cue.logo ? 'logo' : '-'), r3(cue.changeAtMs / 1000 - 100), cue.fadeMs]);
  });
}
const tick = (pos: number, input?: Partial<CueIn>, paused = false): [number, CueSnap, Partial<CueIn>?] => [pos + 100, snapAt(1, pos, [2, 24], {}, paused), input];
const scripted = feed([
  tick(10),
  tick(10.1, { mode: 'blank' }),
  tick(10.2, { mode: 'logo' }),
  tick(10.3),
  tick(10.4, { tap: ['Chorus b'] }),
  tick(10.5),
  tick(11.2),
  tick(11.3, {}, true),
  tick(11.35, {}, true),
  tick(11.4),
]);
same('display cues: the slide up now with a quick fade, then the next cued ahead with the full fade', scripted[0], [[1, 'Verse a', 10, 250], [2, 'Verse b', 11, 500]]);
same('Blank goes to black and Logo to the logo at once, dropping the cue to come; back to words cues it again', scripted.slice(1, 4), [
  [[3, '-', 10.1, 250]],
  [[4, 'logo', 10.2, 250]],
  [[5, 'Verse a', 10.3, 250], [6, 'Verse b', 11, 500]],
]);
same('a tapped slide goes up now and stays until the next change comes due, then the words follow on', scripted.slice(4, 7), [
  [[7, 'Chorus b', 10.4, 250], [8, 'Verse b', 11, 500]],
  [],
  [[9, '-', 16, 500]],
]);
same('pause sends what is up again to clear the cue to come, sends nothing while paused, and cues it again after', scripted.slice(7), [
  [[10, 'Verse b', 11.3, 0]],
  [],
  [[11, '-', 16, 500]],
]);
const idleSnap = { ...inVerse(0), song: null };
same('between songs: black, or the logo; a song with no words shows the same', [
  feed([[50, idleSnap]]),
  feed([[50, idleSnap, { idle: 'logo' }]]),
  feed([tick(10, { idle: 'logo' })], psOf(cueBase)),
], [[[[1, '-', -50, 250]]], [[[1, 'logo', -50, 250]]], [[[1, 'logo', 10, 250]]]]);
same('the next song coming in keeps the last words up until its first slide is cued', feed([tick(22), [122.1, snapAt(1, 6.6, [2, 24], { arriving: true })]]), [
  [[1, 'Verse c', 22, 250], [2, 'Chorus a', 23, 500]],
  [[3, 'Verse a', 22.5, 500]],
]);
same('clocks 30 ms apart around a change: nothing is resent and the change lands once', feed([
  tick(10.9),
  tick(10.985, { ms: 110985 + 30 }),
  tick(11.01, { ms: 111010 - 30 }),
  tick(11.1),
]), [[[1, 'Verse a', 10.9, 250], [2, 'Verse b', 11, 500]], [], [], [[3, '-', 16, 500]]]);

const displayCue = (seq: number, text: string, changeAtMs: number) => ({ seq, text, logo: false, changeAtMs, fadeMs: 500 });
const displaySteps: Array<[ReturnType<typeof displayCue>, number]> = [
  [displayCue(1, 'A', 0), 0],
  [displayCue(2, 'B', 1000), 10],
  [displayCue(3, 'C', 2000), 20],
  [displayCue(2, 'B', 1000), 30],
  [displayCue(4, 'D', 3000), 2500],
];
let display: import('../src/lib/lyricsCue.ts').DisplayState = { seq: 0, up: null, pending: null };
same('a display: a higher seq replaces the cue to come, an older one is ignored, one already due goes up first', displaySteps.map(([cue, ms]) => {
  display = cueLib.takeCue(display, cue, ms);
  return [display.up?.text ?? null, display.pending?.text ?? null];
}), [['A', null], ['A', 'B'], ['A', 'C'], ['A', 'C'], ['C', 'D']]);

// Through the engine: Perform plays from the Verse on the test clock (it lands at 1.1 s, so the context time is 6.9 s
// behind audio time), ticking every 10 ms. Each step runs at its context time. The cues as [words, at, fade ms].
function cuesFrom(ps: ReturnType<typeof psOf>, steps: Array<[number, (session: Session) => void]>, until: number, input: Partial<CueIn> = {}) {
  clockNow = 0;
  const session = new engine.PerformSession(async () => null);
  session.startSong({ ...ps, buffer: { duration: ps.song.duration } } as never, { from: 1 });
  let state = cueLib.CUE_START;
  const out: Array<[string, number, number]> = [];
  for (let k = 0, i = 0; k <= until * 100; k++) {
    clockNow = k / 100;
    while (i < steps.length && clockNow >= steps[i][0]) steps[i++][1](session);
    session.tick();
    const step = cueLib.nextCue(state, cueLib.lyricsCue(session.snapshot(), ps, clockNow), { ctxNow: clockNow, ms: clockNow * 1000, ...input });
    state = step.state;
    out.push(...step.cues.map(cue => [cue.text || (cue.logo ? 'logo' : '-'), r3(cue.changeAtMs / 1000), cue.fadeMs] as [string, number, number]));
  }
  return out;
}
const opening: Array<[string, number, number]> = [['-', 0, 250], ['Verse a', 0.1, 500], ['Verse b', 4.1, 500]];
same('played in order through the engine: one cue per change, each cued ahead, then the logo when the song ends', cuesFrom(cuePs, [], 42, { idle: 'logo' }), [
  ...opening,
  ['-', 9.1, 500],
  ['Verse c', 12.1, 500],
  ['Chorus a', 16.1, 500],
  ['Chorus b', 20.1, 500],
  ['Bridge a', 23.85, 500],
  ['-', 33.1, 500],
  ['logo', 41.1, 250],
]);
same('Hold through the engine brings the Verse round again', cuesFrom(cuePs, [[10, session => session.toggleHold()]], 21).slice(4), [
  ['Verse c', 12.1, 500],
  ['Verse a', 16.1, 500],
  ['Verse b', 20.1, 500],
  ['-', 25.1, 500],
]);
same('a pick through the engine cues the Bridge ahead of where it lands, and cancelling it cues the Verse again', [
  cuesFrom(cuePs, [[2, session => session.pickSection(3)]], 18),
  cuesFrom(cuePs, [[2, session => session.pickSection(3)], [5, session => session.cancel()]], 13),
], [
  [...opening, ['Bridge a', 7.85, 500], ['-', 17.1, 500]],
  [...opening, ['Bridge a', 7.85, 500], ['-', 9.1, 500], ['Verse c', 12.1, 500], ['Chorus a', 16.1, 500]],
]);
same('with a 4-beat lead, a late pick puts the Chorus up at once, and cancelling it goes back to the Verse', cuesFrom(psOf(withWords(cueBase, { leadBeats: 4 })), [
  [7.6, session => session.pickSection(2)],
  [7.7, session => session.cancel()],
], 9.5), [
  ['Verse a', 0, 250],
  ['Verse b', 3.1, 500],
  ['-', 9.1, 500],
  ['Chorus a', 7.6, 250],
  ['Chorus b', 11.1, 500],
  ['Verse b', 7.7, 250],
  ['-', 9.1, 500],
  ['Verse c', 11.1, 500],
]);

// Finessing lyrics on Map Song: the lane's boxes and the slide edits. 120 BPM in 4/4, so bar n starts at 2n s. Intro
// bars 0-2, Verse 1 2-6, Chorus 1 6-12, Verse 2 12-16, Chorus 2 16-20 with no pickup. The choruses share a block, and
// so do the verses. Words are made up.
const lyricsEdit = await import('../src/lib/lyricsEdit.ts');
const editBase = barSong([['intro', 0, 0], ['verse', 2], ['chorus', 6], ['verse', 12], ['chorus', 16, 0]], 20);
const editSong = {
  ...editBase,
  lyrics: { source: 'manual', blocks: { verse: [['Alpha one', 'alpha two'], ['Beta one']], chorus: [['Gamma one', 'gamma two', 'gamma three'], [], ['Delta one']] } },
  sections: editBase.sections.map(x => (x.type === 'intro' ? x : { ...x, lyric: { block: x.type, slideBars: x.type === 'verse' ? [0, 2] : [0, 2, 3] } })),
} as PlacedSong;
/** Each section's slide bars, and the blocks. */
const shape = (song: PlacedSong) => [Object.fromEntries(song.sections.filter(x => x.lyric).map(x => [x.id, x.lyric!.slideBars])), song.lyrics?.blocks];
const lane = (song: PlacedSong) =>
  lyricsEdit.laneSlides(song).map(x => [x.sectionId, x.i, x.start, x.end, x.changeAt, x.lines[0] ?? '-', x.shared, x.last, x.check]);
same('the lane: a box per slide from its bar to the next, the change 2 beats ahead, a blank on its bar', lane(editSong).slice(0, 5), [
  ['s1', 0, 4, 8, 3, 'Alpha one', true, false, false],
  ['s1', 1, 8, 12, 7, 'Beta one', true, true, false],
  ['s2', 0, 12, 16, 11, 'Gamma one', true, false, false],
  ['s2', 1, 16, 18, 16, '-', true, false, false],
  ['s2', 2, 18, 24, 17, 'Delta one', true, true, false],
]);
const autoSong = { ...editSong, lyrics: { ...editSong.lyrics!, source: 'youtube-auto' }, timedLyrics: [line(4, 6, 'alpha one alpha two', 'auto'), line(8, 9, 'Beta one', 'auto')] };
const checked = (song: PlacedSong) => lyricsEdit.laneSlides(song).filter(x => x.check).map(x => `${x.sectionId}:${x.i}`);
same('check words: auto caption words nobody changed, every worded slide when the captions are gone, none for other sources', [
  checked(autoSong),
  checked(lyricsEdit.setSlideText(autoSong, 's1', 0, 'Alpha won\nalpha two')),
  checked({ ...autoSong, timedLyrics: undefined }).length,
  checked(editSong),
], [['s1:0', 's1:1', 's3:0', 's3:1'], ['s1:1', 's3:1'], 8, []]);

same('dragging an edge snaps to the nearest bar, stays inside its section and between its neighbours; the first slide stays put', [
  shape(lyricsEdit.moveSlideEdge(editSong, 's1', 1, 6.9))[0].s1,
  shape(lyricsEdit.moveSlideEdge(editSong, 's1', 1, 30))[0].s1,
  shape(lyricsEdit.moveSlideEdge(editSong, 's2', 1, 12))[0],
  lyricsEdit.moveSlideEdge(editSong, 's2', 2, 12) === editSong,
  lyricsEdit.moveSlideEdge(editSong, 's1', 0, 8) === editSong,
], [[0, 1], [0, 3], { s1: [0, 2], s2: [0, 1, 3], s3: [0, 2], s4: [0, 2, 3] }, true, true]);
same('split: halves its lines, and every section on the block gets the new slide halfway to its next one', shape(lyricsEdit.splitSlide(editSong, 's2', 0)), [
  { s1: [0, 2], s2: [0, 1, 2, 3], s3: [0, 2], s4: [0, 1, 2, 3] },
  { verse: editSong.lyrics!.blocks.verse, chorus: [['Gamma one', 'gamma two'], ['gamma three'], [], ['Delta one']] },
]);
same('split at the cursor, mid-line; refused for a blank, a single word, or when a section on the block has no bar for it', [
  lyricsEdit.splitText('Gamma one\ngamma two\ngamma three', 14),
  lyricsEdit.splitSlide(editSong, 's2', 1) === editSong,
  ((oneWord: PlacedSong) => lyricsEdit.splitSlide(oneWord, 's1', 1) === oneWord)(lyricsEdit.setSlideText(editSong, 's1', 1, 'Beta')),
  lyricsEdit.splitSlide(editSong, 's2', 2, [['Delta'], ['one']]) === editSong,
  shape(lyricsEdit.splitSlide(editSong, 's1', 1))[1]!.verse,
], [[['Gamma one', 'gamm'], ['a two', 'gamma three']], true, true, true, [['Alpha one', 'alpha two'], ['Beta'], ['one']]]);
same('merge with next joins the words (a blank adds none) in every section on the block; the last slide has no next', [
  shape(lyricsEdit.mergeNext(editSong, 's2', 1)),
  lyricsEdit.mergeNext(editSong, 's2', 2) === editSong,
], [[{ s1: [0, 2], s2: [0, 2], s3: [0, 2], s4: [0, 2] }, { verse: editSong.lyrics!.blocks.verse, chorus: [['Gamma one', 'gamma two', 'gamma three'], ['Delta one']] }], true]);
same('make blank and new words change the block; a lone "-" is a blank; no change gives the same song', [
  shape(lyricsEdit.makeBlank(editSong, 's1', 1))[1]!.verse,
  shape(lyricsEdit.setSlideText(editSong, 's4', 2, '  Delta won \n\n delta two '))[1]!.chorus[2],
  shape(lyricsEdit.setSlideText(editSong, 's2', 0, '-'))[1]!.chorus[0],
  lyricsEdit.makeBlank(editSong, 's2', 1) === editSong,
  lyricsEdit.setSlideText(editSong, 's1', 1, 'Beta one') === editSong,
], [[['Alpha one', 'alpha two'], []], ['Delta won', 'delta two'], [], true, true]);
const spread = lyricsEdit.moveSlideEdge(editSong, 's2', 2, at(11));
same('use these bar positions for every section on the block: a shorter section leaves out bars past its end', [
  shape(lyricsEdit.applyBarsToBlock(spread, 's2'))[0],
  lyricsEdit.applyBarsToBlock(lyricsEdit.applyBarsToBlock(spread, 's2'), 's2') === lyricsEdit.applyBarsToBlock(spread, 's2'),
  shape(lyricsEdit.applyBarsToBlock(spread, 's4'))[0].s2,
], [{ s1: [0, 2], s2: [0, 2, 5], s3: [0, 2], s4: [0, 2] }, false, [0, 2, 3]]);
// Chorus 2 cut short after its slides were placed, so its third slide is past its end.
const cutShort = { ...editSong, sections: editSong.sections.map(x => (x.id === 's4' ? { ...x, lyric: { block: 'chorus', slideBars: [0, 2, 5] } } : x)) };
same("a split where a section's slide is past its end drops its bars there, so none points at the wrong words later", shape(lyricsEdit.splitSlide(cutShort, 's2', 2))[0], {
  s1: [0, 2], s2: [0, 2, 3, 4], s3: [0, 2], s4: [0, 2],
});
const editedSong = [
  (x: PlacedSong) => lyricsEdit.splitSlide(x, 's2', 0),
  (x: PlacedSong) => lyricsEdit.mergeNext(x, 's2', 2),
  (x: PlacedSong) => lyricsEdit.makeBlank(x, 's1', 1),
  (x: PlacedSong) => lyricsEdit.setSlideText(x, 's3', 0, 'Alpha one\nalpha two\n-'),
  (x: PlacedSong) => lyricsEdit.moveSlideEdge(x, 's2', 2, at(10)),
  (x: PlacedSong) => lyricsEdit.applyBarsToBlock(x, 's2'),
].reduce((song, op) => op(song), editSong);
const editedWarnings: string[] = [];
const editedBack = opened(djw.parseDjw(djw.serializeDjw(editedSong, { includeAudioPath: false }), editedWarnings), editedSong.duration);
// Opening a .djw gives sections new ids, so they are compared in order.
same('edited lyrics survive a .djw export and import, with no warnings', [editedBack.sections.map(x => x.lyric ?? null), editedBack.lyrics, editedWarnings], [
  [null, { block: 'verse', slideBars: [0, 2] }, { block: 'chorus', slideBars: [0, 1, 4] }, { block: 'verse', slideBars: [0, 2] }, { block: 'chorus', slideBars: [0, 1] }],
  { source: 'manual', blocks: { verse: [['Alpha one', 'alpha two', '-'], []], chorus: [['Gamma one', 'gamma two'], ['gamma three'], ['Delta one']] } },
  [],
]);

const editPs = psOf(editSong);
const previewAt = (pos: number, paused = false) => {
  const cue = cueLib.lyricsCue(lyricsEdit.previewSnapshot(editPs.views, pos, pos + 100, paused), editPs, pos + 100);
  return [cue.now, cue.next, cue.changeAt === null ? null : r3(cue.changeAt - 100)];
};
same('the preview plays the song straight through: the intro blank, a slide 2 beats ahead, the next section, paused, then idle past the end', [
  previewAt(1),
  previewAt(7.5),
  previewAt(7.5, true),
  lyricsEdit.previewSnapshot(editPs.views, 40.5, 140.5, false).song,
], [[[], ['Alpha one', 'alpha two'], 3], [['Beta one'], ['Gamma one', 'gamma two', 'gamma three'], 11], [['Beta one'], null, null], null]);

const timedSong = {
  ...barSong([['verse', 0], ['chorus', 4]], 12, 8),
  lyrics: { source: 'lrclib:1', leadBeats: 3, blocks: {} },
  timedLyrics: [line(0.1, 1.9, 'One a'), line(2.1, 3.9, 'One b'), line(4.1, 5.9, 'One c'), line(8.1, 9.9, 'Two a'), line(18, 19, 'Tail words')],
} as PlacedSong;
const againOne = lyricsEdit.placeAgain(timedSong, { linesPerSlide: 1 })!.song;
const nudgedAgain = lyricsEdit.placeAgain(againOne, { offset: 0.5 })!.song;
same('place again: lines per slide and the nudge place the found lines again, keep how, and leave the lead alone; unplaced lines are found', [
  againOne.lyrics?.blocks,
  againOne.lyricsPlacing,
  [nudgedAgain.lyrics?.offset, nudgedAgain.lyrics?.leadBeats, nudgedAgain.lyricsPlacing],
  lyricsEdit.placementOf(againOne)?.unplaced.map(x => x.text),
  lyricsEdit.placeAgain(editSong),
], [
  { verse: [['One a'], ['One b'], ['One c']], chorus: [['Two a']] },
  { linesPerSlide: 1, autoOffset: false },
  [0.5, 3, { linesPerSlide: 1, autoOffset: false }],
  ['Tail words'],
  null,
]);

// The Words strip on Perform: the beats to the change, Blank and Logo, tapped slides, and the app-wide lead and fade.
// On `cuePs`, Verse b comes in at 11 s, then a blank at 16 s. Words are made up.
const wordsLib = await import('../src/lib/lyricsDisplay.ts');
type WordsState = import('../src/lib/lyricsDisplay.ts').WordsState;
const beatsAt = (snapshot: CueSnap) => {
  const ctxNow = snapshot.song!.pos + 100;
  return wordsLib.beatsToChange(cueLib.lyricsCue(snapshot, cuePs, ctxNow), cuePs.grid, snapshot.song!.pos, ctxNow);
};
const someCue = cueLib.lyricsCue(inVerse(10), cuePs, 110);
same('the countdown: whole beats to the change, 1 through the last beat, counted on the real grid, and none while paused or after the last slide', [
  [10, 10.25, 10.5, 10.99, 11.1].map(pos => beatsAt(inVerse(pos))),
  wordsLib.beatsToChange({ ...someCue, changeAt: 102 }, { beats: [0, 0.5, 1, 2, 3] } as never, 0.5, 100),
  beatsAt(snapAt(1, 10, [2, 24], {}, true)),
  wordsLib.beatsToChange({ ...someCue, changeAt: null }, cuePs.grid, 10, 110),
], [[2, 2, 1, 1, 10], 3, null, null]);

const faceText = (state: WordsState) => (state.faces.up?.logo ? 'logo' : state.faces.up?.text || '-');
const blank = (state: WordsState) => wordsLib.toggleScreen(state, 'blank');
const logo = (state: WordsState) => wordsLib.toggleScreen(state, 'logo');
const tapped = (...lines: string[]) => (state: WordsState) => wordsLib.tapSlide(state, lines);
/** One tick per [pos, press], gives what is on the screen after each. `wobble` is seconds between the snapshot's clock and `ctxNow`, on every other tick. */
const screenAfter = (steps: Array<[number, ((state: WordsState) => WordsState)?]>, wobble = 0) => {
  let state = wordsLib.WORDS_START;
  return steps.map(([pos, press], k) => {
    if (press) state = press(state);
    const ctxNow = pos + 100 + (k % 2) * wobble;
    state = wordsLib.tickWords(state, cueLib.lyricsCue(inVerse(pos), cuePs, ctxNow), { ctxNow, ms: ctxNow * 1000 }).state;
    return faceText(state);
  });
};
same('Blank and Logo hold the screen and a second press goes back; one to the other just swaps', screenAfter([[10], [10.1, blank], [10.2], [10.3, blank], [10.4, logo], [10.5, blank], [10.6, logo], [10.7, logo]]), [
  'Verse a', '-', '-', 'Verse a', 'logo', '-', 'logo', 'Verse a',
]);
same('going back from Blank shows the slide the song is on by then, not the one it covered', screenAfter([[10], [10.5, blank], [11.2], [11.3, blank]]), ['Verse a', '-', '-', 'Verse b']);
same('a tap shows that slide now, it stays through the change it came early for, and the next change takes over', screenAfter([[10], [10.1, tapped('Verse b')], [10.5], [11.1], [12], [16.1]]), [
  'Verse a', 'Verse b', 'Verse b', 'Verse b', 'Verse b', '-',
]);
same('a tap on a slide comes out of Blank and Logo, and a tap on a blank slide blacks the screen', [
  screenAfter([[10], [10.1, blank], [10.2, tapped('Verse a')], [10.3, logo], [10.4, tapped('Verse b')]]),
  screenAfter([[10], [10.1, tapped()]]),
], [['Verse a', '-', 'Verse a', 'logo', 'Verse b'], ['Verse a', '-']]);
same('Blank and back goes to the slide the song is on, past an earlier tap', screenAfter([[10], [10.1, tapped('Chorus a')], [10.2, blank], [10.3, blank]]), ['Verse a', 'Chorus a', '-', 'Verse a']);
same('a tap holds when the clock read beside the snapshot wobbles by 3 ms, as two reads of the audio clock can', screenAfter([[10], [10.1, tapped('Chorus a')], [10.2], [10.3]], 0.003), ['Verse a', 'Chorus a', 'Chorus a', 'Chorus a']);

/** Ticks at [pos, ms past the pos's own time, paused], gives the last state and the cues sent. */
const fadeRun = (ticks: Array<[number, number?, boolean?]>) => {
  let state = wordsLib.WORDS_START;
  const sent: string[] = [];
  for (const [pos, after = 0, paused = false] of ticks) {
    const ctxNow = pos + 100;
    const step = wordsLib.tickWords(state, cueLib.lyricsCue(snapAt(1, pos, [2, 24], {}, paused), cuePs, ctxNow), { ctxNow, ms: ctxNow * 1000 + after });
    state = step.state;
    sent.push(...step.cues.map(cue => cue.text || '-'));
  }
  return [faceText(state), state.faces.was?.text ?? null, r3(state.faces.p), sent];
};
same('the screen follows the real fade: halfway through the beat-long change it holds both slides', fadeRun([[10.9], [11.25]]), ['Verse b', 'Verse a', 0.5, ['Verse a', 'Verse b', '-']]);
same('pause freezes: a fade under way finishes, a change still to come is called off and never lands', [
  fadeRun([[10.9], [11.1, 0, true], [11.1, 1000, true]]),
  fadeRun([[10.9], [10.9, 0, true], [10.9, 5000, true]]),
  fadeRun([[10.9], [11.1], [11.2, 0, true]]),
], [
  ['Verse b', 'Verse a', 1, ['Verse a', 'Verse b']],
  ['Verse a', null, 1, ['Verse a', 'Verse b', 'Verse a']],
  ['Verse b', 'Verse a', 0.4, ['Verse a', 'Verse b', '-', 'Verse b']],
]);

const faceCue = (seq: number, text: string, at: number) => ({ seq, text, logo: false, changeAtMs: at, fadeMs: 500 });
const cutIn = (p: number, ms: number) => {
  const faces = wordsLib.facesAt({ up: faceCue(2, 'B', 1000), was: faceCue(1, 'A', 0), p, from: 1 }, { seq: 3, up: faceCue(3, 'C', ms), pending: null }, ms);
  return [faces.up?.text, faces.was?.text, faces.from, faces.p];
};
same('a new slide cutting into a fade leaves from whichever face is stronger, at the strength it had', [cutIn(0.2, 1100), cutIn(0.7, 1350)], [['C', 'A', 0.8, 0], ['C', 'B', 0.7, 0]]);

const offerAt = (press?: (state: WordsState) => WordsState, snapshot = inVerse(10)) => {
  let state = wordsLib.tickWords(wordsLib.WORDS_START, cueLib.lyricsCue(inVerse(10), cuePs, 110), { ctxNow: 110, ms: 110000 }).state;
  if (press) state = wordsLib.tickWords(press(state), cueLib.lyricsCue(inVerse(10), cuePs, 110), { ctxNow: 110, ms: 110000 }).state;
  return wordsLib.slidesToOffer(state, cueLib.lyricsCue(snapshot, cuePs, snapshot.song!.pos + 100));
};
same('beside the screen: the next slide; the current one too once Blank, Logo or a tap covers it; nothing that would change nothing; none while paused', [
  offerAt(),
  offerAt(blank),
  offerAt(logo),
  offerAt(tapped('Verse b')),
  offerAt(blank, inVerse(11.5)),
  offerAt(undefined, snapAt(1, 10, [2, 24], {}, true)),
], [
  { current: null, next: ['Verse b'] },
  { current: ['Verse a'], next: ['Verse b'] },
  { current: ['Verse a'], next: ['Verse b'] },
  { current: ['Verse a'], next: null },
  { current: ['Verse b'], next: null },
  { current: null, next: null },
]);

/** Through the engine, as in the cue tests above: each step runs at its context time, and the screen's cues come back as [words, at, fade ms]. */
function holderCues(steps: Array<[number, (state: WordsState) => WordsState]>, until: number) {
  clockNow = 0;
  const session = new engine.PerformSession(async () => null);
  session.startSong({ ...cuePs, buffer: { duration: cuePs.song.duration } } as never, { from: 1 });
  let state = wordsLib.WORDS_START;
  const out: Array<[string, number, number]> = [];
  for (let k = 0, i = 0; k <= until * 100; k++) {
    clockNow = k / 100;
    while (i < steps.length && clockNow >= steps[i][0]) state = steps[i++][1](state);
    session.tick();
    const step = wordsLib.tickWords(state, cueLib.lyricsCue(session.snapshot(), session.ps, clockNow), { ctxNow: clockNow, ms: clockNow * 1000 });
    state = step.state;
    out.push(...step.cues.map(cue => [cue.text || (cue.logo ? 'logo' : '-'), r3(cue.changeAtMs / 1000), cue.fadeMs] as [string, number, number]));
  }
  return out;
}
same('through the engine: Blank clears the change to come, the song plays on under it, and back goes to the slide it reached', holderCues([[2, blank], [6, blank]], 10), [
  ['-', 0, 250],
  ['Verse a', 0.1, 500],
  ['Verse b', 4.1, 500],
  ['-', 2, 250],
  ['Verse b', 6, 250],
  ['-', 9.1, 500],
  ['Verse c', 12.1, 500],
]);

const prefsFor = (lyrics: Partial<import('../src/types.ts').Lyrics>, prefs: import('../src/lib/lyricsCue.ts').LyricsPrefs) => cueOf(inVerse(10), psOf(withWords(cueBase, lyrics)), prefs).slice(2);
same('lead and fade: the app default for a song with none, the song value wins, field by field', [
  prefsFor({}, { leadBeats: 3, fadeBeats: 0 }),
  prefsFor({ leadBeats: 1 }, { leadBeats: 3, fadeBeats: 2 }),
  prefsFor({ fadeBeats: 0 }, { leadBeats: 3, fadeBeats: 2 }),
  lyricsEdit.laneSlides(editSong, { leadBeats: 3, fadeBeats: 1 })[0].changeAt,
], [[10.5, 0], [11.5, 1], [10.5, 0], 2.5]);
same('the saved default: kept when good, held to its range on half beats, back to the start when broken', [
  wordsLib.parseLyricsPrefs(null),
  wordsLib.parseLyricsPrefs('{"leadBeats":2.5,"fadeBeats":0}'),
  wordsLib.parseLyricsPrefs('{"leadBeats":9,"fadeBeats":-1}'),
  wordsLib.parseLyricsPrefs('{"leadBeats":1.3}'),
  wordsLib.parseLyricsPrefs('{"leadBeats":"x","fadeBeats":null}'),
  wordsLib.parseLyricsPrefs('null'),
  wordsLib.parseLyricsPrefs('not json'),
], [
  { leadBeats: 2, fadeBeats: 1 },
  { leadBeats: 2.5, fadeBeats: 0 },
  { leadBeats: 3, fadeBeats: 0 },
  { leadBeats: 1.5, fadeBeats: 1 },
  { leadBeats: 2, fadeBeats: 1 },
  { leadBeats: 2, fadeBeats: 1 },
  { leadBeats: 2, fadeBeats: 1 },
]);
same('a song with no lead or fade writes none to its .djw, and only slides with words count as words', [
  ['lead_beats', 'fade_beats'].map(field => djw.serializeDjw(withWords(cueBase), { includeAudioPath: false }).includes(field)),
  [cueBase, withWords(cueBase), { ...withWords(cueBase), lyrics: { blocks: { verse: [[]] } } }].map(song => wordsLib.hasWords(song)),
], [[false, false], [false, true, false]]);

// The Mac lyrics window: cues from a real PerformSession on the test clock, sent the way Perform sends them, into a
// display built the way the window builds it.
const windowLib = await import('../src/lib/lyricsWindow.ts');
type Shown = Array<[string, number]>;
type WindowDisplay = import('../src/lib/lyricsCue.ts').DisplayState;
const blankDisplay = (): WindowDisplay => ({ seq: 0, up: null, pending: null });
const faceName = (cue: import('../src/lib/lyricsCue.ts').DisplayCue | null) => (cue ? cue.text || (cue.logo ? 'logo' : '-') : null);

/** What a window shows and when: `joinAt` is when it opens and catches up, `until` is in seconds. */
function windowRun({ delay = 0, joinAt = 0, until, steps = [] }: { delay?: number; joinAt?: number; until: number; steps?: Array<[number, (state: WordsState) => WordsState]> }) {
  clockNow = 0;
  const session = new engine.PerformSession(async () => null);
  session.startSong({ ...cuePs, buffer: { duration: cuePs.song.duration } } as never, { from: 1 });
  let state = windowLib.wordsStartAt(5000);
  let shownDisplay: WindowDisplay | null = null;
  let faces = wordsLib.WORDS_START.faces;
  const shown: Shown = [];
  const strip: Shown = [];
  let stripFace: string | null = null;
  for (let k = 0, i = 0; k <= until * 100; k++) {
    clockNow = k / 100;
    const ms = clockNow * 1000;
    while (i < steps.length && clockNow >= steps[i][0]) state = steps[i++][1](state);
    session.tick();
    const step = wordsLib.tickWords(state, cueLib.lyricsCue(session.snapshot(), session.ps, clockNow), { ctxNow: clockNow, ms });
    state = step.state;
    const take = (cues: import('../src/lib/lyricsCue.ts').DisplayCue[]) => {
      shownDisplay = cues.map(cue => windowLib.scheduleCue(cue, delay, ms)).reduce((held, cue) => cueLib.takeCue(held, cue, ms), shownDisplay!);
    };
    if (!shownDisplay && clockNow >= joinAt) {
      shownDisplay = blankDisplay();
      take(windowLib.catchUpCues(state.display));
    } else if (shownDisplay) take(step.cues);
    if (shownDisplay) {
      const before = faceName(faces.up);
      faces = wordsLib.facesAt(faces, shownDisplay, ms);
      if (faceName(faces.up) !== before) shown.push([faceName(faces.up)!, clockNow]);
    }
    if (faceName(state.faces.up) !== stripFace) strip.push([(stripFace = faceName(state.faces.up))!, clockNow]);
  }
  return { shown, strip, state, faces };
}
same('the window: no delay, every change lands when it lands on the Words strip', [windowRun({ until: 10 }).shown, windowRun({ until: 10 }).strip], [
  [['-', 0], ['Verse a', 0.1], ['Verse b', 4.1], ['-', 9.1]],
  [['-', 0], ['Verse a', 0.1], ['Verse b', 4.1], ['-', 9.1]],
]);
same('the display delay: changes cued ahead come that much sooner, one due within it goes up now, and the strip keeps real time', [windowRun({ delay: 200, until: 10 }).shown, windowRun({ delay: 200, until: 10 }).strip], [
  [['Verse a', 0], ['Verse b', 3.9], ['-', 8.9]],
  [['-', 0], ['Verse a', 0.1], ['Verse b', 4.1], ['-', 9.1]],
]);
same('the display delay: a change to go up now cannot come sooner, a near one goes up now, and the fade stays', [
  windowLib.scheduleCue({ seq: 1, text: 'Now', logo: false, changeAtMs: 1000, fadeMs: 250 }, 300, 1000).changeAtMs,
  windowLib.scheduleCue({ seq: 2, text: 'Near', logo: false, changeAtMs: 1100, fadeMs: 500 }, 300, 1000),
  windowLib.scheduleCue({ seq: 3, text: 'Later', logo: false, changeAtMs: 4000, fadeMs: 500 }, 300, 1000).changeAtMs,
], [1000, { seq: 2, text: 'Near', logo: false, changeAtMs: 1000, fadeMs: 500 }, 3700]);
same('Blank goes up at once on the window, however long the delay', windowRun({ delay: 500, until: 3, steps: [[2, blank]] }).shown, [['Verse a', 0], ['-', 2]]);

const late = windowRun({ joinAt: 6, until: 10 });
same('a window opened late: the slide the strip has up at once, fully faded in, then the next on time', [late.shown, windowRun({ joinAt: 6, until: 6 }).faces.p], [[['Verse b', 6], ['-', 9.1]], 1]);
same('a window opened over Blank or the logo shows that, and one opened before any cue waits for the first', [
  windowRun({ joinAt: 3, until: 4, steps: [[2, blank]] }).shown,
  windowRun({ joinAt: 3, until: 4, steps: [[2, logo]] }).shown,
  windowLib.catchUpCues(wordsLib.WORDS_START.display),
], [[['-', 3]], [['logo', 3]], []]);
same('catching up sends the slide up, then the one to come, so it reads the same as the strip', (() => {
  const up = { seq: 7, text: 'A', logo: false, changeAtMs: 0, fadeMs: 250 };
  const pending = { seq: 8, text: 'B', logo: false, changeAtMs: 9000, fadeMs: 500 };
  return windowLib.catchUpCues({ seq: 8, up, pending }).reduce((held, cue) => cueLib.takeCue(held, cue, 5000), blankDisplay());
})(), { seq: 8, up: { seq: 7, text: 'A', logo: false, changeAtMs: 0, fadeMs: 250 }, pending: { seq: 8, text: 'B', logo: false, changeAtMs: 9000, fadeMs: 500 } });

const faceAt = (seq: number, text: string, changeAtMs = 0) => ({ seq, text, logo: false, changeAtMs, fadeMs: 250 });
same('seq: an open window ignores a cue that arrives late, and a new strip, counting from later, still gets through', (() => {
  let held = cueLib.takeCue(blankDisplay(), faceAt(101, 'New'), 10);
  held = cueLib.takeCue(held, faceAt(100, 'Old'), 20);
  const first = held.up?.text;
  const again = wordsLib.tickWords(windowLib.wordsStartAt(5000), cueLib.lyricsCue(inVerse(10), cuePs, 110), { ctxNow: 110, ms: 110000 }).cues[0];
  held = cueLib.takeCue(held, again, 110000);
  return [first, held.up?.text, again.seq];
})(), ['New', 'Verse a', 5001]);
same('leaving Perform: black now, past the cue to come, and the state sends what is up again if the strip comes back', (() => {
  let { state } = wordsLib.tickWords(windowLib.wordsStartAt(5000), cueLib.lyricsCue(inVerse(10), cuePs, 110), { ctxNow: 110, ms: 110000 });
  const held = cueLib.takeCue(cueLib.takeCue(blankDisplay(), { seq: 5001, text: 'Verse a', logo: false, changeAtMs: 110000, fadeMs: 250 }, 110000), { seq: 5002, text: 'Verse b', logo: false, changeAtMs: 111000, fadeMs: 500 }, 110000);
  const left = windowLib.leaveCue(state, 110500);
  state = left.state;
  const after = cueLib.takeCue(held, left.cue, 110500);
  const back = wordsLib.tickWords(state, cueLib.lyricsCue(inVerse(10), cuePs, 110.6), { ctxNow: 110.6, ms: 110600 }).cues.map(cue => [cue.seq, cue.text]);
  return [faceName(after.up), after.pending, left.cue.seq, back];
})(), ['-', null, 5003, [[5004, 'Verse a'], [5005, 'Verse b']]]);

const windowSteps: string[] = [];
const inTurn = windowLib.oneAtATime();
await Promise.all([
  inTurn(async () => {
    windowSteps.push('move starts');
    await new Promise(done => setTimeout(done, 5));
    windowSteps.push('move ends');
  }),
  inTurn(async () => void windowSteps.push('turn off')),
  inTurn(async () => {
    throw new Error('a job that fails');
  }).catch(() => windowSteps.push('failure seen')),
  inTurn(async () => void windowSteps.push('check')),
]);
same('open, close and checks: Turn off waits for a move under way, and a failed job does not stop the next', windowSteps, ['move starts', 'move ends', 'turn off', 'failure seen', 'check']);

const screen = (id: string, isPrimary = false) => ({ id, name: `Monitor #${id}`, width: 1920, height: 1080, x: 0, y: 0, isPrimary });
const mac = screen('mac', true);
same('the screen offered first: a second one if there is one, else the only one; each named by its place', [
  windowLib.defaultMonitor([mac, screen('tv')])?.id,
  windowLib.defaultMonitor([screen('tv'), mac])?.id,
  windowLib.defaultMonitor([mac])?.id,
  windowLib.defaultMonitor([]),
  windowLib.monitorChoices([mac, screen('tv'), screen('projector')]).map(monitor => monitor.id),
  [mac, screen('tv'), screen('projector')].map((monitor, _, all) => windowLib.monitorLabel(monitor, all)),
], ['tv', 'tv', 'mac', null, ['tv', 'projector', 'mac'], ['Main display', 'Display 2', 'Display 3']]);
same('the button follows the truth: closed on its own, unplugged, opened before the strip came back, or fine', [
  windowLib.syncDisplay('tv', null, [mac, screen('tv')]),
  windowLib.syncDisplay('tv', 'mac', [mac]),
  windowLib.syncDisplay(null, 'tv', [mac, screen('tv')]),
  windowLib.syncDisplay('tv', 'tv', [mac, screen('tv')]),
  windowLib.syncDisplay(null, null, [mac]),
], [
  { chosen: null, close: false },
  { chosen: null, close: true },
  { chosen: 'tv', close: false },
  { chosen: 'tv', close: false },
  { chosen: null, close: false },
]);
same('the display delay is saved with lead and fade: held to its range, and saving either keeps the other', [
  wordsLib.parseDisplayDelay(null),
  wordsLib.parseDisplayDelay('{"displayDelayMs":200}'),
  wordsLib.parseDisplayDelay('{"displayDelayMs":9000}'),
  wordsLib.parseDisplayDelay('{"displayDelayMs":-5}'),
  wordsLib.parseDisplayDelay('{"displayDelayMs":"x"}'),
  wordsLib.parseDisplayDelay('not json'),
  JSON.parse(wordsLib.mergeLyricsPrefs('{"displayDelayMs":200}', { leadBeats: 3, fadeBeats: 0 })),
  JSON.parse(wordsLib.mergeLyricsPrefs('{"leadBeats":3,"fadeBeats":0}', { displayDelayMs: 100 })),
  JSON.parse(wordsLib.mergeLyricsPrefs('not json', { displayDelayMs: 100 })),
  wordsLib.parseLyricsPrefs('{"leadBeats":3,"fadeBeats":0,"displayDelayMs":100}'),
], [
  0,
  200,
  500,
  0,
  0,
  0,
  { displayDelayMs: 200, leadBeats: 3, fadeBeats: 0 },
  { leadBeats: 3, fadeBeats: 0, displayDelayMs: 100 },
  { displayDelayMs: 100 },
  { leadBeats: 3, fadeBeats: 0 },
]);

// The TV on AirPlay, from iPhone and iPad: its button, and what the page says to do.
const tvMonitor = { id: windowLib.AIRPLAY_TV, name: 'TV', width: 1920, height: 1080, x: 0, y: 0, isPrimary: false };
same('the Display button says where the words are: nothing to show on, a TV turned off, on the TV, and a Mac screen as before', [
  windowLib.displayLabel(null, []),
  windowLib.displayLabel(null, [tvMonitor]),
  windowLib.displayLabel(windowLib.AIRPLAY_TV, [tvMonitor]),
  windowLib.displayLabel('projector', [mac, screen('projector')]),
  windowLib.displayLabel(null, [mac, screen('projector')]),
], ['Display', 'Display', 'On TV', 'On Display 2', 'Display']);
same('the button follows a TV: it connects on its own, stops mirroring, and a list a moment behind the window closes nothing', [
  windowLib.syncDisplay(null, windowLib.AIRPLAY_TV, [tvMonitor]),
  windowLib.syncDisplay(windowLib.AIRPLAY_TV, null, []),
  windowLib.syncDisplay(windowLib.AIRPLAY_TV, null, [tvMonitor]),
  windowLib.syncDisplay(null, windowLib.AIRPLAY_TV, []),
], [
  { chosen: windowLib.AIRPLAY_TV, close: false },
  { chosen: null, close: false },
  { chosen: null, close: false },
  { chosen: windowLib.AIRPLAY_TV, close: false },
]);
same('what the picker says: how to reach the TV, what Turn off does, nothing to add, and the Mac as before', [
  windowLib.displayHint(null, [], true)?.includes('Control Center'),
  windowLib.displayHint(windowLib.AIRPLAY_TV, [tvMonitor], true)?.includes('back on the TV'),
  windowLib.displayHint(null, [tvMonitor], true),
  windowLib.displayHint(null, [mac], false)?.includes('⌘W'),
  windowLib.displayHint('mac', [mac], false),
  windowLib.displayHint(null, [mac, screen('projector')], false),
], [true, true, null, true, null, null]);

// Blank and Logo across songs. Each step is [song id, cue, press], and gives [mode, what is on the screen].
const heldAcross = (steps: Array<[string | undefined, ReturnType<typeof cueLib.lyricsCue>, ((state: WordsState) => WordsState)?]>) => {
  let state = wordsLib.WORDS_START;
  return steps.map(([song, cue, press]) => {
    state = wordsLib.tickWords(press ? press(state) : state, cue, { ctxNow: 110, ms: 110000 }, song).state;
    return [state.mode, faceText(state)];
  });
};
const wordsCue = cueLib.lyricsCue(inVerse(10), cuePs, 110);
const padCue = cueLib.lyricsCue({ ...inVerse(10), song: null }, null, 50);
const noWordsCue = cueLib.lyricsCue(inVerse(10), psOf(cueBase), 110);
const comingCue = { ...wordsCue, now: null, since: null };
same('a new song with words lets go of a Logo from between songs, and the logo stays up until its first slide is due', heldAcross([
  [undefined, padCue, logo],
  ['b', comingCue],
  ['b', wordsCue],
]), [['logo', 'logo'], ['words', 'logo'], ['words', 'Verse a']]);
same('Blank pressed once the song is under way still holds', heldAcross([
  ['b', wordsCue],
  ['b', wordsCue, blank],
  ['b', wordsCue],
]), [['words', 'Verse a'], ['blank', '-'], ['blank', '-']]);
same('a song with no words keeps the hold, and the next song with words lets go of it', heldAcross([
  [undefined, padCue, logo],
  ['c', noWordsCue],
  ['d', wordsCue],
]), [['logo', 'logo'], ['logo', 'logo'], ['words', 'Verse a']]);
same('going back to the song that just ended counts as new, so Blank from the pad between lets go', heldAcross([
  ['a', wordsCue],
  [undefined, padCue, blank],
  ['a', wordsCue],
]), [['words', 'Verse a'], ['blank', '-'], ['words', 'Verse a']]);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nALL PASS');
