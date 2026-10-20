#!/usr/bin/env node
// Stands in for yt-dlp in e2e: same flags, fixture audio, real-looking progress lines.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2026.08.19-fake');
  process.exit(0);
}
const url = args[args.indexOf('--') + 1] ?? '';
const fixtures = process.env.FAKE_YTDLP_FIXTURES;
const KEYS = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
if (args.includes('--flat-playlist')) {
  for (const key of KEYS) console.log(`pad${key.replace('#', 's')}\t${key} Pad`);
  process.exit(0);
}
const padKey = /v=pad(\w+)/.exec(url)?.[1]?.replace('s', '#');
const pick = padKey
  ? { file: `pad-${padKey}.wav`, title: `${padKey} Pad`, uploader: 'Worship Pads - Topic' }
  : url.includes('evening')
    ? { file: 'song-b.wav', title: 'Evening Test', uploader: 'Test Band' }
    : { file: 'song-a.wav', title: 'Test Band - Morning Test (Official Video)', uploader: 'Test Band VEVO' };
if (args.includes('--skip-download')) {
  console.log(pick.title);
  process.exit(0);
}
const dir = args[args.indexOf('-P') + 1];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
console.log(`META ${JSON.stringify({ title: pick.title, uploader: pick.uploader, artist: null, track: null })}`);
for (const percent of [8, 31, 64, 92, 100]) {
  await sleep(250);
  const status = percent === 100 ? 'finished' : 'downloading';
  console.log(`PROG ${JSON.stringify({ status, _percent: percent, eta: Math.round((100 - percent) / 3) })}`);
}
console.error('PP started ExtractAudio');
await sleep(250);
const id = url.replace(/\W+/g, '').slice(-11);
const target = join(dir, `${pick.title} [${id}].mp3`);
copyFileSync(join(fixtures, pick.file), target);
console.error('PP finished ExtractAudio');
console.log(`FILEPATH ${target}`);
