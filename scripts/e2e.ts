// Walks every screen of the app in headless Chrome with real clicks and key presses.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { close, launch, openPage, sleep, type Cdp } from './cdp.ts';
import { SONG_A, SONG_B, beatTimes, renderPad, renderSong, wav } from './fixtures.ts';
import { registerTsHooks } from './registerTsHooks.ts';

registerTsHooks();
const { parseDjw } = await import('../src/lib/djw.ts');
const { sectionViews } = await import('../src/lib/songMap.ts');

const root = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'djw-e2e-'));
const shots = join(root, 'docs/v2/screens');
const downloads = join(work, 'downloads');
mkdirSync(shots, { recursive: true });
mkdirSync(downloads);
writeFileSync(join(work, 'song-a.wav'), wav(renderSong(SONG_A)));
writeFileSync(join(work, 'song-b.wav'), wav(renderSong(SONG_B)));
const sharps: Record<string, string> = { 'A#': 'Bb', 'D#': 'Eb' };
for (const key of ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']) {
  writeFileSync(join(work, `pad-${key}.wav`), wav(renderPad((sharps[key] ?? key) as never, 10)));
}
copyFileSync(join(work, 'song-b.wav'), join(work, 'Evening Test.wav'));

// Two sessions can run this at once on their own ports.
const HELPER = Number(process.env.E2E_HELPER_PORT || 3911);
const WEB = Number(process.env.E2E_WEB_PORT || 43911);
const env = { ...process.env, HELPER_PORT: String(HELPER), PORT: String(WEB) };
const children: ChildProcess[] = [
  spawn('node', ['server/index.js'], {
    cwd: root,
    env: { ...env, LIBRARY_DIR: join(work, 'lib'), YT_DLP_PATH: join(root, 'scripts/fake-yt-dlp.mjs'), FAKE_YTDLP_FIXTURES: work },
    stdio: 'ignore',
  }),
  spawn('npx', ['vite', '--port', String(WEB), '--strictPort'], { cwd: root, env, stdio: 'ignore' }),
];

let page: Cdp;
let passed = 0;
const ev = <T = any>(js: string) => page.eval<T>(js);

function check(label: string, ok: boolean, detail: unknown = '') {
  if (!ok) throw new Error(`${label} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  passed++;
  console.log(`ok   ${label}`);
}

async function waitFor<T>(js: string, label: string, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    last = await ev(js).catch(error => error.message);
    if (last) {
      passed++;
      console.log(`ok   ${label}`);
      return last as T;
    }
    await sleep(100);
  }
  throw new Error(`timed out: ${label} (last ${JSON.stringify(last)})`);
}

const find = (text: string, selector = 'button') =>
  `(() => { const all = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(el => el.offsetParent !== null); const t = ${JSON.stringify(text)}; return all.find(el => el.textContent.trim() === t) ?? all.find(el => el.textContent.trim().startsWith(t)); })()`;

async function clickAt(elementJs: string) {
  const point = await ev<{ x: number; y: number } | null>(
    `(() => { const el = ${elementJs}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (!point) throw new Error(`nothing to click: ${elementJs.slice(0, 160)}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const) {
    await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  }
  await sleep(60);
}
const click = (text: string, selector?: string) => clickAt(find(text, selector));

async function press(key: string, shift = false) {
  const named: Record<string, [string, number]> = { ' ': ['Space', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], Backspace: ['Backspace', 8], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Home: ['Home', 36] };
  const [code, vk] = named[key] ?? (/\d/.test(key) ? [`Digit${key}`, 48 + Number(key)] : [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)]);
  const modifiers = shift ? 8 : 0;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined, modifiers });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(30);
}

async function type(selector: string, text: string) {
  await clickAt(`document.querySelector(${JSON.stringify(selector)})`);
  await ev(`document.querySelector(${JSON.stringify(selector)}).select?.()`);
  await page.send('Input.insertText', { text });
}

async function setFiles(selector: string, files: string[]) {
  const { root: doc } = await page.send('DOM.getDocument');
  const { nodeId } = await page.send('DOM.querySelector', { nodeId: doc.nodeId, selector });
  await page.send('DOM.setFileInputFiles', { nodeId, files });
}

async function shot(name: string) {
  await sleep(250);
  const capture = page.send('Page.captureScreenshot', { format: 'png' });
  const { data } = await Promise.race([capture, sleep(5000).then(() => Promise.reject(new Error('screenshot timed out')))]);
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'));
}

const text = () => ev<string>('document.body.innerText');

type Tap = { t: number; one: boolean; auto?: boolean };
/** JS for the saved taps of a song, read straight from IndexedDB. */
const savedTaps = (title: string) =>
  `(async () => { const db = await new Promise(r => { const q = indexedDB.open('worship-looper'); q.onsuccess = () => r(q.result); }); const all = await new Promise(r => { const q = db.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => r(q.result); }); return all.find(s => s.title === ${JSON.stringify(title)}).taps; })()`;

async function mapRest() {
  await waitFor(`${find('Map the rest from the song')}?.disabled === false`, 'the song is ready to map');
  await click('Map the rest from the song');
  await waitFor(`document.body.innerText.includes('Mapped from the song')`, 'map the rest');
}
const seek = (t: number) => ev(`__djw.engine.transport.seek(${t})`);

async function tapIn(beats: number[], count: number) {
  for (const [i, t] of beats.slice(0, count).entries()) {
    await seek(t);
    await press(' ', i % 4 === 0);
  }
}

async function main() {
  for (const url of [`http://localhost:${WEB}/`, `http://127.0.0.1:${HELPER}/api/health`]) {
    for (let i = 0; i < 100 && !(await fetch(url).then(r => r.ok, () => false)); i++) await sleep(150);
  }
  const chrome = await launch();
  try {
    page = await openPage(chrome);
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1042, deviceScaleFactor: 1, mobile: false });
    await chrome.browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    const errors: string[] = [];
    page.ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? 'error');
    });
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/library` });
    await waitFor(`document.body.innerText.includes('Songs · 0')`, 'library starts empty');

    // Library: YouTube song, YouTube pad, local file, search.
    await type('#youtube-link', 'https://www.youtube.com/watch?v=morning');
    await click('Download');
    await waitFor(`/\\d+% · 0:\\d\\d left/.test(document.body.innerText)`, 'download shows percent and time left');
    await waitFor(`document.body.innerText.includes('Songs · 1') && document.body.innerText.includes('Morning Test')`, 'download lands as a song');
    check('artist split from the video title', (await text()).includes('Test Band'));
    await click('Pads · 0 keys');
    await click('Get all 12 keys');
    await waitFor(`document.body.innerText.includes('Downloading 12 pads')`, 'the pad album queues 12 pads');
    await waitFor(`document.body.innerText.includes('Pads · 12 keys') && document.body.innerText.includes('Every key has a pad.')`, 'every key gets a pad from the album', 60000);
    check('pad keys read from their titles', (await ev(`document.querySelector('select[aria-label="Key of D# Pad"]').value`)) === '3');
    await click('Songs · 1');
    await setFiles('input[aria-label="Add an audio file"]', [join(work, 'Evening Test.wav')]);
    await waitFor(`document.body.innerText.includes('Songs · 2')`, 'local audio file imports');
    await type('input[type=search]', 'evening');
    check('search filters songs', !(await text()).includes('Morning Test') && (await text()).includes('Evening Test'));
    await ev(`(() => { const i = document.querySelector('input[type=search]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor(`document.body.innerText.includes('Morning Test') && document.body.innerText.includes('Tap in')`, 'next step is Tap in');
    await shot('1-library');

    // Tap and sections for Morning Test.
    await clickAt(`[...document.querySelectorAll('tr')].find(r => r.innerText.includes('Morning Test')).querySelector('td:last-child button')`);
    await waitFor(`document.body.innerText.includes('1 · Tap the beat') && __djw.engine.transport.buffer`, 'tap screen loads the audio');
    await tapIn(beatTimes(SONG_A), 24);
    await waitFor(`document.body.innerText.includes('120.0 BPM')`, 'tempo from taps is 120.0 BPM');
    await mapRest();
    const mappedA = await waitFor<Tap[]>(`(async () => { const taps = await (${savedTaps('Morning Test')}); return taps.some(tap => tap.auto) && taps; })()`, 'map the rest from the song');
    const offBy = beatTimes(SONG_A).map(t => Math.min(...mappedA.map(tap => Math.abs(tap.t - t))));
    check('mapped beats land on every click', Math.max(...offBy) < 0.003, Math.max(...offBy));
    const sortedA = mappedA.map(tap => tap.t).sort((a, b) => a - b);
    check('mapping adds no beats between the clicks', sortedA.every((t, i) => i === 0 || t - sortedA[i - 1] > 0.45));
    await press(' ');
    check('Space while a button has focus taps instead of pressing it', (await text()).includes('Mapped from the song'));
    await press('Backspace');
    const keysFor = ['1', '2', '4', '2', '4', '8'];
    for (const [i, key] of keysFor.entries()) {
      await seek(SONG_A.firstDownbeat + i * 8 + 0.3);
      await press(key);
    }
    await click('More');
    await click('Run Outro to the end');
    await waitFor(`!document.body.innerText.includes('[next mark]')`, 'outro runs to the end');
    const labels = () => ev<string[]>(`[...document.querySelectorAll('select[aria-label^="Label of"]')].map(s => s.selectedOptions[0].text)`);
    const names = await labels();
    check('section names', JSON.stringify(names) === JSON.stringify(['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Outro']), names);
    const keys = await ev<string[]>(`[...document.querySelectorAll('select[aria-label^="Key of"]')].map(s => s.selectedOptions[0].text)`);
    check('keys found by the app', JSON.stringify(keys) === JSON.stringify(['G', 'G', 'G', 'G', 'A', 'A']), keys);

    // Getting around: left and right by bar, up and down by section, Home to the start.
    const bar1 = SONG_A.firstDownbeat;
    await seek(bar1 + 9.3);
    const stops: number[] = [];
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'Home']) {
      await press(key);
      stops.push(await ev<number>('__djw.engine.transport.position()'));
    }
    const wantStops = [8, 0, -bar1, 0, 8, 6, 8, 10, -bar1].map(t => bar1 + t);
    check('arrows step by section and bar, Home goes to the start', stops.every((t, i) => Math.abs(t - wantStops[i]) < 0.01), stops);

    // Fixing one section: relabel it, then undo.
    await ev(`(() => { const s = document.querySelector('select[aria-label="Label of Verse 2"]'); s.value = 'bridge'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('select[aria-label="Label of Bridge"]')`, 'relabel Verse 2 as a Bridge');
    check('relabel renumbers the other sections', JSON.stringify(await labels()) === JSON.stringify(['Intro', 'Verse', 'Chorus 1', 'Bridge', 'Chorus 2', 'Outro']), await labels());
    await press('Backspace');
    await waitFor(`document.querySelector('select[aria-label="Label of Verse 2"]')`, 'Backspace undoes the relabel');

    // Select tool: click a section on the track to change its pickup, label and start bar.
    const onStrip = (name: string) => `document.querySelector('button[aria-label^="${name}, bars"]')`;
    const inPanel = (label: string) => `document.querySelector('[role=dialog] [aria-label="${label}"]')`;
    const stripCount = `document.querySelectorAll('button[aria-label*=", bars"]').length`;
    const playhead = await ev<number>('__djw.engine.transport.position()');
    await clickAt(onStrip('Chorus 1'));
    await waitFor(`document.querySelector('[role=dialog][aria-label="Chorus 1 settings"]')`, 'select opens a section from the track');
    check('clicking a section does not move the playhead', (await ev<number>('__djw.engine.transport.position()')) === playhead);
    for (let i = 0; i < 4; i++) await clickAt(inPanel('More fade-in end'));
    const pickupShare = `(() => { const bar = document.querySelector('[data-pickup="Chorus 1"]'); return bar && bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width; })()`;
    await waitFor(`document.querySelector('[role=dialog]').innerText.includes('2 beats') && ${pickupShare}`, 'the pickup shows on the track');
    check('the pickup on the track is 2 beats long', Math.abs((await ev<number>(pickupShare)) - 1 / 50) < 0.002, await ev(pickupShare));
    await ev(`(() => { const s = document.querySelector('[role=dialog] select[aria-label^="Label of"]'); s.value = 'bridge'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('[role=dialog][aria-label="Bridge settings"]')`, 'the panel relabels the section');
    for (let i = 0; i < 6; i++) await clickAt(inPanel('Move Bridge a bar later'));
    await waitFor(`document.querySelector('[role=dialog]').innerText.includes('bars 12–12')`, 'moving a start stops a bar short of the next section');
    check('moving never stacks two sections on one bar', (await ev<number>(stripCount)) === 6);
    await shot('2b-tap-select');
    await clickAt(`[...document.querySelectorAll('h2')].find(h => h.textContent.includes('Tap the beat'))`);
    await waitFor(`!document.querySelector('[role=dialog]')`, 'clicking outside closes the panel');
    for (let i = 0; i < 8; i++) await press('Backspace');
    await waitFor(`!document.querySelector('[data-pickup]') && document.body.innerText.includes('bars 9–12')`, 'Backspace undoes the panel changes');
    check('labels are back after undo', JSON.stringify(await labels()) === JSON.stringify(names), await labels());
    await clickAt(onStrip('Verse 2'));
    await press('Escape');
    await waitFor(`!document.querySelector('[role=dialog]')`, 'Escape closes the panel');

    // Cut tool: hover shows the nearest bar inside a section, a click splits there.
    await press('c');
    check('C picks the cut tool', (await ev<boolean>(`document.querySelector('[title^="Click a section to split"]').getAttribute('aria-pressed') === 'true'`)) === true);
    const stripAt = (t: number) =>
      ev<{ x: number; y: number }>(
        `(() => { const strip = ${onStrip('Outro')}.parentElement; strip.scrollIntoView({ block: 'center' }); const r = strip.getBoundingClientRect(); return { x: r.left + (r.width * ${t}) / __djw.engine.transport.buffer.duration, y: r.top + r.height / 2 }; })()`,
      );
    const cutBarShown = `document.querySelector('[data-cut-bar]')?.dataset.cutBar ?? null`;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await stripAt(bar1 + 40.1)), button: 'none' });
    check('no cut on the edge of a section', (await ev(cutBarShown)) === null, await ev(cutBarShown));
    const point = await stripAt(bar1 + 44.6);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' });
    await waitFor(`${cutBarShown} === '23'`, 'hovering in cut mode shows the nearest bar');
    await shot('2c-tap-cut');
    const held = await ev<number>('__djw.engine.transport.position()');
    const wave = { x: point.x - 300, y: point.y - 60 };
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...wave, button: 'left', buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...wave, button: 'left', clickCount: 1 });
    check('a drag from a section into the waveform does not seek', (await ev<number>('__djw.engine.transport.position()')) === held && (await ev<number>(stripCount)) === 6);
    for (const type of ['mousePressed', 'mouseReleased'] as const) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    await waitFor(`${stripCount} === 7`, 'a cut splits the section');
    check('the cut lands on the nearest bar', (await text()).includes('bars 21–22') && (await text()).includes('bars 23–25'));
    check('both halves keep the label', JSON.stringify((await labels()).slice(5)) === JSON.stringify(['Outro 1', 'Outro 2']), await labels());
    await press('Backspace');
    await waitFor(`${stripCount} === 6`, 'Backspace undoes the cut');
    await ev(`${onStrip('Outro')}.click()`);
    await waitFor(`${stripCount} === 7`, 'a click without a pointer cuts the middle of the section');
    await press('Backspace');
    await press('v');

    // Start over, then undo it.
    await click('Start over');
    await click('Clear taps and sections');
    await waitFor(`document.querySelectorAll('select[aria-label^="Label of"]').length === 0 && !document.body.innerText.includes('120.0 BPM')`, 'start over clears taps and sections');
    await click('Undo');
    await waitFor(`document.querySelectorAll('select[aria-label^="Label of"]').length === 6 && document.body.innerText.includes('120.0 BPM')`, 'Undo brings them back');

    // Re-tap the whole song: it plays from the top and the sections stay.
    await click('Start over');
    await click('Re-tap the beat');
    await waitFor(`__djw.engine.transport.playing && document.body.innerText.includes('Re-tapping the whole song')`, 're-tap the beat plays from the top');
    check('re-tap the beat keeps the sections', (await ev<number>(`document.querySelectorAll('select[aria-label^="Label of"]').length`)) === 6);
    await click('Stop');
    await waitFor(`!__djw.engine.transport.playing && !document.body.innerText.includes('Re-tapping')`, 'Stop ends the re-tap');

    // Re-tap one section: old taps stay until new ones replace them, taps before it are ignored, and it stops at its end.
    const tapped = `[...document.querySelectorAll('svg[viewBox="0 0 1000 14"] line')].filter(l => l.getAttribute('stroke') !== '#D4D4CE').length`;
    check('24 taps before the re-tap', (await ev<number>(tapped)) === 24, await ev(tapped));
    await clickAt(`document.querySelector('[aria-label="Re-tap Verse 1"]')`);
    await waitFor(`__djw.engine.transport.playing && document.body.innerText.includes('Re-tapping Verse 1')`, 're-tap plays the section');
    await seek(bar1 + 7.5);
    await press(' ');
    check('taps before the section are ignored', (await ev<number>(tapped)) === 24, await ev(tapped));
    await tapIn(beatTimes(SONG_A).slice(16, 32), 16);
    await waitFor(`${tapped} === 32`, 'new taps replace the old ones in the section');
    await seek(bar1 + 16.1);
    await waitFor(`!__djw.engine.transport.playing && !document.body.innerText.includes('Re-tapping')`, 're-tap stops at the end of the section', 3000);
    check('sections keep their bars after a re-tap', (await text()).includes('bars 5–8') && (await text()).includes('bars 9–12'));
    for (let i = 0; i < 16; i++) await press('Backspace');
    await waitFor(`${tapped} === 24 && document.body.innerText.includes('120.0 BPM')`, 'Backspace steps back through the re-tap');
    await ev(`__djw.engine.transport.seek(30)`);
    await click('Play');
    await sleep(400);
    check('play moves the playhead', (await ev<number>('__djw.engine.transport.position()')) > 30.1);
    check('there is sound', (await ev<number>('__djw.engine.level()')) > 0.005);
    // Live taps 40 ms late land on the click they were reaching for.
    const beatsA = beatTimes(SONG_A);
    await seek(beatsA[60] - 0.7);
    for (const b of beatsA.slice(60, 64)) {
      await sleep(Math.max(0, (b + 0.04 - (await ev<number>('__djw.engine.transport.heard()'))) * 1000));
      await press(' ');
    }
    await sleep(600);
    const live = (await ev<Tap[]>(savedTaps('Morning Test'))).filter(tap => !tap.auto && tap.t > beatsA[59] + 0.25 && tap.t < beatsA[63] + 0.25);
    check('live taps snap onto the beat', live.length === 4 && live.every((tap, i) => Math.abs(tap.t - beatsA[60 + i]) < 0.005), live.map(tap => tap.t));
    for (let i = 0; i < 4; i++) await press('Backspace');
    await click('Pause');
    await seek(49.6);
    await click('Play');
    await waitFor(`!__djw.engine.transport.playing && __djw.engine.transport.position() >= 49.9`, 'playback stops cleanly at the end of the song', 4000);
    await seek(28.3);
    await shot('2-tap-sections');

    // Refine.
    await click('Next: Refine');
    await waitFor(`document.body.innerText.includes('Loop seam')`, 'refine screen');
    await clickAt(`[...document.querySelectorAll('[role=option]')].find(b => b.textContent.startsWith('Chorus 1'))`);
    await waitFor(`document.body.innerText.includes('Chorus 1 · bars 9–12')`, 'select Chorus 1');
    for (let i = 0; i < 4; i++) await clickAt(`document.querySelector('[aria-label="More fade-in end"]')`);
    await clickAt(`document.querySelector('[aria-label="More repeats"]')`);
    await click('Next bar', 'label');
    check('pickup and repeats change', (await text()).includes('2 beats') && (await text()).includes('×2'));
    await click('Copy settings to all choruses');
    await clickAt(`[...document.querySelectorAll('[role=option]')].find(b => b.textContent.startsWith('Chorus 2'))`);
    await waitFor(`document.body.innerText.includes('Chorus 2 · bars') && document.body.innerText.includes('2 beats') && [...document.querySelectorAll('input[name=jump]')].findIndex(i => i.checked) === 1`, 'settings copied to Chorus 2');
    await clickAt(`[...document.querySelectorAll('[role=option]')].find(b => b.textContent.startsWith('Chorus 1'))`);
    await clickAt(`document.querySelector('[aria-label="More fade out"]')`);
    await clickAt(`document.querySelector('[aria-label="More fade out"]')`);
    const stepped = (name: string) => `document.querySelector('[role=group][aria-label="${name}"] output').textContent`;
    const dot = (label: string) => `document.querySelector('[role=slider][aria-label="${label}"]')`;
    await waitFor(`${stepped('fade out')} === '2 beats' && ${dot('Fade-out start')}.getAttribute('aria-valuenow') === '-2'`, 'the fade-out moves its dot on the seam');
    const fadeOutEnd = (more: boolean) => clickAt(`document.querySelector('[aria-label="${more ? 'More' : 'Less'} fade-out end"]')`);
    await fadeOutEnd(true);
    await fadeOutEnd(true);
    await waitFor(
      `${stepped('fade-out end')} === '1 beat late' && ${dot('Fade-out end')}.getAttribute('aria-valuenow') === '1' && ${dot('Fade-out start')}.getAttribute('aria-valuenow') === '-1'`,
      'the fade-out can end after the loop point',
    );
    await ev(`${dot('Fade-out end')}.focus()`);
    await press('ArrowLeft');
    await waitFor(`${stepped('fade-out end')} === '½ beats late' && ${stepped('fade out')} === '1½ beats'`, 'moving the fade-out end keeps its start');
    await press('ArrowRight');
    await fadeOutEnd(false);
    await fadeOutEnd(false);
    await waitFor(`${stepped('fade-out end')} === 'on the 1' && ${stepped('fade out')} === '2 beats'`, 'the fade-out end steps back to the loop point');
    // Drag the fade-in start 2 beats earlier. The fade-in end stays put.
    const grip = await ev<{ x: number; y: number; perBeat: number }>(
      `(() => { const el = ${dot('Fade-in start')}; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const box = el.parentElement.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, perBeat: box.width / (el.getAttribute('aria-valuemax') - el.getAttribute('aria-valuemin')) }; })()`,
    );
    const to = { x: grip.x - 2 * grip.perBeat, y: grip.y };
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: grip.x, y: grip.y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, button: 'left', buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', clickCount: 1 });
    await waitFor(`${stepped('fade in')} === '3 beats' && ${stepped('fade-in end')} === '2 beats early'`, 'dragging the fade-in start lengthens the fade');
    await ev(`${dot('Fade-in start')}.focus()`);
    for (let i = 0; i < 4; i++) await press('ArrowRight');
    await waitFor(`${stepped('fade in')} === '1 beat'`, 'arrow keys move a dot by half a beat');
    await click('Audition loop ×2');
    await waitFor(`/Stop · pass 1 of 2/.test(document.body.innerText) && __djw.engine.level() > 0.005`, 'audition plays');
    await shot('3-refine');
    const fullBeforeFade = await waitFor<number>(
      `(() => { const s = __djw.session; if (s.segments.length < 2) return 0; const [a, b] = s.segments; return __djw.engine.now() < b.prevFadeCtx - 0.05 ? 1 + a.voice.gain.gain.value : 0; })()`,
      'the next pass is queued before the fade-out starts',
      14000,
    );
    check('the pass keeps full volume until its fade-out starts', fullBeforeFade > 1.99, fullBeforeFade - 1);
    await waitFor(`/Stop · pass 2 of 2/.test(document.body.innerText)`, 'audition loops into pass 2', 14000);
    const passPlayhead = `parseFloat(document.querySelector('[data-playhead=pass]')?.style.left ?? 'NaN')`;
    const early = await ev<number>(passPlayhead);
    await sleep(400);
    check('the playhead moves across the pass', (await ev<number>(passPlayhead)) > early, early);
    await click('Stop');
    // The transition plays into the loop point and a bar past it, then stops by itself. A late fade-out end rings over the loop point.
    await fadeOutEnd(true);
    await fadeOutEnd(true);
    await click('Play transition');
    await waitFor(`/pass 1 · bar/.test(document.body.innerText) && document.querySelector('[data-playhead=seam]')`, 'the transition plays with a playhead on the seam');
    await waitFor(`/pass 2 · bar 9/.test(document.body.innerText)`, 'the transition crosses the loop point', 10000);
    const ring = await ev<number>(`(() => { const s = __djw.session.segments[0]; return s.prevEndCtx - s.landingCtx; })()`);
    check('the old pass rings a beat past the loop point', Math.abs(ring - 0.5) < 0.01, ring);
    await waitFor(`!document.querySelector('[data-playhead]') && ${find('Play transition')}`, 'the transition stops by itself', 10000);
    await fadeOutEnd(false);
    await fadeOutEnd(false);
    await click('Repeat');
    await click('Play transition');
    await waitFor(`/pass 2 · bar/.test(document.body.innerText)`, 'the repeating transition crosses the loop point', 10000);
    await waitFor(`/pass 1 · bar/.test(document.body.innerText)`, 'Repeat plays the transition again', 10000);
    await click('Stop');
    await click('Repeat');
    await click('Next: Export .djw');

    // Export.
    await waitFor(`document.body.innerText.includes('Ready: all 4 checks pass')`, 'all 4 checks pass');
    await click('Change name or folder…');
    await type('input.font-mono', 'morning-test');
    await clickAt(`document.querySelector('input[type=checkbox]')`);
    await shot('4-export');
    const saved = chrome.browser.once('Browser.downloadProgress', p => p.state === 'completed');
    await click('Save & add to set');
    await saved;
    const file = readdirSync(downloads).find(name => name.endsWith('.djw'))!;
    check('saved file name', file === 'morning-test.djw', file);
    const map = parseDjw(readFileSync(join(downloads, file), 'utf8'));
    check('djw has 6 sections with their keys', map.sections.map(s => s.key).join() === 'G,G,G,G,A,A', map.sections.map(s => s.key));
    check('djw keeps pickups and repeats', map.sections[2].pickupBeats === 2 && map.sections[4].repeats === 2 && map.sections[4].jumpAt === 'bar');
    check('djw keeps the seam fade', map.sections[2].fadeOutBeats === 2 && map.sections[4].fadeOutBeats === 1, map.sections.map(x => x.fadeOutBeats));
    check('djw includes the local path when asked', Boolean(map.audioFile?.endsWith('.mp3')) && Boolean(map.source));
    await waitFor(`location.hash.startsWith('#/sets/') && document.body.innerText.includes('Morning Test')`, 'save adds the song to a set');

    // Second song, from the local file.
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/library` });
    await waitFor(`document.body.innerText.includes('Evening Test')`, 'back in library');
    await clickAt(`[...document.querySelectorAll('tr')].find(r => r.innerText.includes('Evening Test')).querySelector('td:last-child button')`);
    await waitFor(`document.body.innerText.includes('1 · Tap the beat') && __djw.engine.transport.buffer`, 'evening tap screen');
    await tapIn(beatTimes(SONG_B), 8);
    await mapRest();
    await seek(SONG_B.firstDownbeat + 0.3);
    await press('1');
    await seek(SONG_B.firstDownbeat + 16.3);
    await press('4');
    await click('More');
    await click('Run Chorus to the end');
    await waitFor(`document.body.innerText.includes('60.0 BPM')`, 'evening tempo 60 BPM');
    await click('Next: Refine');
    await click('Next: Export .djw');
    await waitFor(`document.body.innerText.includes('Ready: all 4 checks pass')`, 'evening passes checks');
    const savedB = chrome.browser.once('Browser.downloadProgress', p => p.state === 'completed');
    await click('Save & add to set');
    await savedB;

    // Sets.
    await waitFor(`document.body.innerText.includes('2 songs · 2 pads')`, 'set has two songs and two pads');
    const setText = await text();
    check('plan text', setText.includes('I · V1 · C ×2 · V2 · C(A) ×2 · O'), setText.match(/Plan: .*/g));
    check('live pad A to D with its way in', /A → D\s*\n?\s*way in\s*\n?\s*A\s*\n?\s*D/.test(setText) || setText.includes('A → D'));
    check('half-time note', setText.includes('120 to 60 BPM. That is exactly half-time'));
    check('last pad plays to the end', setText.includes('D → end') && setText.includes('played live · fade when ready'));
    await clickAt(`document.querySelectorAll('[aria-label^="Move "]')[1]`);
    await press('ArrowUp');
    await waitFor(`document.querySelector('ol li').innerText.includes('Evening Test')`, 'keyboard reorder');
    await press('ArrowDown');
    await waitFor(`document.querySelector('ol li').innerText.includes('Morning Test')`, 'reorder back');
    await type('input[aria-label="Set name"]', 'Sunday · Test');
    await click('Save set');
    await waitFor(`document.body.innerText.includes('Saved ✓')`, 'save set');
    await shot('5-sets');

    // Import the .djw back; it re-downloads its source and keeps the map.
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/library` });
    await waitFor(`document.body.innerText.includes('Songs · 2')`, 'library before djw import');
    await setFiles('input[aria-label="Import a .djw map"]', [join(downloads, 'morning-test.djw')]);
    await waitFor(`document.body.innerText.includes('Songs · 3')`, 'djw import downloads its source');
    const imported = await ev<string[]>(`(async () => { const db = await new Promise(r => { const q = indexedDB.open('worship-looper'); q.onsuccess = () => r(q.result); }); const all = await new Promise(r => { const q = db.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => r(q.result); }); return all.map(s => s.sections.length + ':' + s.title + ':' + s.taps.length); })()`);
    check('imported map keeps its sections', imported.filter(row => row.startsWith('6:Morning Test')).length === 2, imported);
    const both = await ev<any[]>(`(async () => { const db = await new Promise(r => { const q = indexedDB.open('worship-looper'); q.onsuccess = () => r(q.result); }); const all = await new Promise(r => { const q = db.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => r(q.result); }); return all.filter(s => s.title === 'Morning Test'); })()`);
    const shape = (song: any) =>
      sectionViews(song).map(v => [v.name, v.s, v.e, v.key, v.section.pickupBeats, v.section.fadeInBeats, v.section.fadeOutBeats, v.section.repeats, v.section.jumpAt]);
    check('the re-imported map matches the original section by section', JSON.stringify(shape(both[0])) === JSON.stringify(shape(both[1])), [shape(both[0]), shape(both[1])]);

    // Practice a pad.
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/sets` });
    await waitFor(`document.body.innerText.includes('Practice')`, 'sets page');
    await click('Practice', 'button');
    await waitFor(`document.body.textContent.includes('Now sounding') && __djw.session?.snapshot().pad`, 'practice opens a pad');
    await click('Exit');
    await click('Tap again to stop');

    // Perform.
    await waitFor(`document.body.innerText.includes('Perform this set')`, 'back on sets');
    await click('Perform this set');
    const tile = (name: string) => `[...document.querySelectorAll('main button')].find(b => b.textContent.includes(${JSON.stringify(name)}))`;
    const startIntro = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start Intro' && !b.disabled)`;
    await waitFor(startIntro, 'perform is ready');
    await clickAt(tile('Chorus 1'));
    await waitFor(`__djw.session.snapshot().song?.idx === 2 && __djw.engine.level() > 0.005`, 'a song can start from any section', 8000);
    check('the next song waits for this one to land', (await text()).includes('Wait for Morning Test to come in') || !(await ev<boolean>('__djw.session.snapshot().song.arriving')));
    await waitFor(`!__djw.session.snapshot().song.arriving && ${find('Start Intro on next bar')}`, 'the next song is ready to start from this one');
    await click('Start Intro on next bar');
    await waitFor(`__djw.session.ps.song.title === 'Evening Test' && document.body.textContent.includes('Song 2 of 2')`, 'and starts straight from it', 8000);
    await click('Exit');
    await click('Tap again to stop');
    await click('Perform this set');
    await waitFor(startIntro, 'perform is ready again');
    await clickAt(startIntro);
    await waitFor(`__djw.session.snapshot().song?.bar >= 1 && __djw.engine.level() > 0.005`, 'song plays and bars count');
    const before = await ev<{ bar: number; beat: number }>('__djw.session.snapshot().song');
    await sleep(700);
    const after = await ev<{ bar: number; beat: number }>('__djw.session.snapshot().song');
    check('the beat advances on screen', after.bar * 4 + after.beat > before.bar * 4 + before.beat, [before.bar, before.beat, after.bar, after.beat]);
    // Seams 2 s before the end of the Intro: straight on to Verse 1, or a pick of Chorus 1 (2-beat pickup) under each jump setting.
    const seams = await ev<Record<string, { shared: boolean; in: number; out: number }>>(`(() => {
      const engine = __djw.engine;
      const ps = __djw.session.ps;
      const intro = ps.views[0];
      const run = (jumpFade, pick) => {
        const s = Object.assign(new engine.PerformSession(async () => null), { jumpFade });
        s.startSong(ps, { from: 0, landingCtx: engine.now() + 0.1 - (intro.end - 2 - intro.start) });
        if (pick !== null) s.pickSection(pick);
        const [a, b] = s.segments;
        const seam = { shared: b.voice === a.voice, in: b.startCtx - b.landingCtx, out: b.prevFadeCtx - b.landingCtx };
        s.dispose();
        return seam;
      };
      return { next: run('out', null), out: run('out', 2), in: run('in', 2), edited: run('edited', 2) };
    })()`);
    // Without its Outro, the song's last pass, Chorus 2, rings out past its seam through the rest of the recording.
    const ringOut = await ev<{ bar: number; midRing: number; nearEnd: number }>(`(() => {
      const engine = __djw.engine;
      const full = __djw.session.ps;
      const ps = { ...full, views: full.views.slice(0, -1) };
      const last = ps.views[ps.views.length - 1];
      const goToPadAt = pos => {
        const s = new engine.PerformSession(async () => null);
        s.startSong(ps, { from: last.index, landingCtx: engine.now() - (pos - last.start) });
        s.leaveForPad(9);
        const endIn = s.forced ? s.endAt - engine.now() : NaN;
        s.dispose();
        return endIn;
      };
      const d = ps.grid.downbeats;
      const bar = d[last.e + 1] - d[last.e];
      return { bar, midRing: goToPadAt(d[last.e] + 0.3), nearEnd: goToPadAt(full.buffer.duration - 1) };
    })()`);
    check('Go to pad in the ring-out waits for the next bar line', Math.abs(ringOut.midRing - (3 * ringOut.bar - 0.3)) < 0.02, ringOut);
    check('and ends when the recording does, not 2 bars later', Math.abs(ringOut.nearEnd - 1) < 0.02, ringOut);
    const near = (seam: { in: number; out: number }, into: number, out: number) => Math.abs(seam.in - into) < 0.02 && Math.abs(seam.out - out) < 0.02;
    check('going on to the next section plays straight through', seams.next.shared && near(seams.next, 0, 0), seams.next);
    check('matching the fade-out brings the picked section in over it', !seams.out.shared && near(seams.out, -0.5, -0.5), seams.out);
    check('matching the fade-in takes this section out over it', near(seams.in, -1.5, -1.5), seams.in);
    check('as edited, each section keeps its own fades', near(seams.edited, -1.5, -0.5), seams.edited);
    await click('Match the fade-in');
    await waitFor(`__djw.session.jumpFade === 'in'`, 'the jump setting reaches the playing song');
    await click('Match the fade-out');
    await press('3');
    await waitFor(`/Next: Chorus 1 — at end of phrase \\(in \\d bars?\\)/.test(document.body.innerText)`, 'pick queues Chorus 1 at the phrase');
    await shot('6-perform-song');
    await click('Cancel');
    await waitFor(`__djw.session.snapshot().song.next?.reason === 'plan' && __djw.session.snapshot().song.next.idx === 1`, 'cancel returns to the plan');
    await press('h');
    await waitFor(`__djw.session.snapshot().song.next?.reason === 'hold' && document.body.innerText.includes('Holding Intro')`, 'hold loops the section');
    await press('h');
    await press('3');
    const boundary = await waitFor<number>(
      `(() => { const s = __djw.session; if (s.segments.length < 2) return 0; const [a, b] = s.segments; return b.idx === 2 ? a.landingAudio + (b.landingCtx - a.landingCtx) : 0; })()`,
      'pick is committed ahead of its landing',
    );
    check('Chorus 1 lands on the phrase boundary, bar 5', Math.abs(boundary - 8.5) < 0.005, boundary);
    await waitFor(`__djw.session.snapshot().song.idx === 2`, 'Chorus 1 is playing', 12000);
    await press('5');
    const barLine = await waitFor<number>(
      `(() => { const s = __djw.session; if (s.segments.length < 2 || s.segments[1].idx !== 4) return 0; const [a, b] = s.segments; const t = a.landingAudio + (b.landingCtx - a.landingCtx); return Math.min(...s.ps.grid.downbeats.map(d => Math.abs(d - t))) + 1; })()`,
      'pick Chorus 2 at the next bar',
    );
    check('Chorus 2 lands on a bar line', barLine - 1 < 0.005, barLine - 1);
    await waitFor(`__djw.session.snapshot().song.idx === 4`, 'Chorus 2 is playing', 8000);
    // Page to the next song while this one plays and jump into its Chorus, then page back into Chorus 1 of this one.
    const barLines = `(() => { const s = __djw.session; return s.segments.flatMap(seg => s.ps.grid.downbeats.map(d => seg.landingCtx + d - seg.landingAudio)); })()`;
    const onBarLine = (lines: number[], landing: number) => Math.min(...lines.map(line => Math.abs(line - landing)));
    await clickAt(`document.querySelector('[aria-label="Next song, Evening Test"]')`);
    await waitFor(`document.body.innerText.includes('Now playing: Morning Test · Chorus 2') && document.body.textContent.includes('Song 2 of 2')`, 'paging shows the next song while this one plays');
    check('paging leaves the song playing', (await ev<string>('__djw.session.snapshot().song?.title')) === 'Morning Test' && (await ev<number>('__djw.engine.level()')) > 0.005);
    await waitFor(`${tile('Chorus')}?.disabled === false`, 'the paged song decodes');
    await shot('6b-perform-paging');
    const morningLines = await ev<number[]>(barLines);
    await press('2');
    const toEvening = await waitFor<number>(`__djw.session.ps.song.title === 'Evening Test' && __djw.session.segments[0].landingCtx`, 'a section of another song is brought in');
    check('it lands on a bar line of the song playing', onBarLine(morningLines, toEvening) < 0.005, onBarLine(morningLines, toEvening));
    check('with room for its 1-bar count-in at its own tempo', toEvening - (await ev<number>('__djw.engine.now()')) > 3.5, toEvening);
    await waitFor(`__djw.session.snapshot().song.idx === 1 && !__djw.session.snapshot().song.arriving && document.body.innerText.includes('Now: Chorus')`, 'Evening Test plays from its Chorus', 12000);
    await waitFor(`__djw.engine.now() > ${toEvening} + 0.2 && __djw.session.tails.length === 0 && __djw.engine.level() > 0.005`, 'the old song has faded and stopped');
    await press('ArrowLeft');
    await waitFor(`document.body.innerText.includes('Now playing: Evening Test · Chorus') && ${tile('Chorus 1')}?.disabled === false`, 'paging back shows the song before');
    const eveningLines = await ev<number[]>(barLines);
    await clickAt(tile('Chorus 1'));
    const toMorning = await waitFor<number>(`__djw.session.ps.song.title === 'Morning Test' && __djw.session.segments[0].landingCtx`, 'a section of a song from earlier in the set is brought back');
    check('it lands on a bar line of Evening Test', onBarLine(eveningLines, toMorning) < 0.005, onBarLine(eveningLines, toMorning));
    await waitFor(`__djw.session.snapshot().song.idx === 2 && !__djw.session.snapshot().song.arriving`, 'Morning Test plays again from Chorus 1', 12000);
    // Pause fades out over 3 bars (6 s at 120 BPM) and then stops the clock. Resume fades back in over 2.
    const gain = '__djw.engine.audio().main.gain.value';
    check('Fade is on by default', (await ev<string>(`${find('Fade')}.getAttribute('aria-checked')`)) === 'true');
    await click('Pause');
    const fadeFrom = await ev<number>('__djw.engine.now()');
    await sleep(1500);
    const fading = await ev<number>(gain);
    check('Pause fades out instead of cutting, and the set plays on under it', fading > 0.3 && fading < 0.9 && (await ev<number>('__djw.engine.now()')) - fadeFrom > 1.2 && (await text()).includes('Resume'), fading);
    await waitFor(`__djw.engine.audio().ctx.state === 'suspended'`, 'the clock stops when the fade-out ends', 8000);
    const frozen = await ev<number>('__djw.engine.now()');
    check('the fade-out lasts 3 bars and ends silent', Math.abs(frozen - fadeFrom - 6) < 0.15 && (await ev<number>(gain)) < 0.01, frozen - fadeFrom);
    await sleep(300);
    check('pause freezes the clock', Math.abs((await ev<number>('__djw.engine.now()')) - frozen) < 0.001);
    await click('Resume');
    await sleep(1000);
    const rising = await ev<number>(gain);
    check('Resume fades back in', rising > 0.03 && rising < 0.6 && !(await ev<boolean>('__djw.session.snapshot().paused')), rising);
    await click('Fade');
    await click('Pause');
    await waitFor(`__djw.engine.audio().ctx.state === 'suspended'`, 'with Fade off, Pause stops at once', 300);
    await click('Resume');
    await waitFor(`__djw.engine.audio().ctx.state === 'running' && ${gain} > 0.99`, 'and Resume comes straight back', 300);
    await click('Pad under the song');
    await waitFor(`__djw.session.snapshot().pad?.tonic === 9 && __djw.session.snapshot().song`, 'pad comes in under the song', 12000);
    await click('Turn pad off');
    await waitFor(`!__djw.session.snapshot().pad && ${find('Pad under the song')} && __djw.session.snapshot().song && !__djw.session.snapshot().song.ending`, 'the pad turns off and the song plays on');
    await click('Go to pad (A)');
    await waitFor(`(() => { const s = __djw.session; return s.snapshot().song?.ending && s.pads[0]?.tonic === 9 && s.pads[0].at < s.endAt - 1; })()`, 'Go to pad brings the pad in as the song fades out', 8000);
    await waitFor(`document.body.innerText.includes('Morning Test ended. The pad keeps playing until you move.') && __djw.session.snapshot().pad?.tonic === 9`, 'and the set moves to the pad', 8000);
    check('pad groups', (await text()).includes('Fits both') && (await text()).includes('Fits the next song, D'));
    await clickAt(`document.querySelector('[aria-label^="Pad E,"]')`);
    await waitFor(`__djw.session.snapshot().pad?.tonic === 4 && !__djw.session.snapshot().pad.next`, 'pad changes on the next bar', 8000);
    await press('ArrowLeft');
    await waitFor(`document.body.innerText.includes('Now playing: the E pad') && document.body.textContent.includes('Song 1 of 2')`, 'paging back from a pad shows the song that ended');
    await press('Escape');
    await waitFor(`document.body.innerText.includes('Morning Test ended.') && document.body.textContent.includes('Pad after song 1')`, 'Escape goes back to what is playing');
    await click('Turn pad off');
    await waitFor(`!__djw.session.snapshot().pad && document.body.innerText.includes('Pad off.')`, 'the pad turns off between songs');
    await click('Turn pad on (A)');
    await waitFor(`__djw.session.snapshot().pad?.tonic === 9`, 'and back on', 8000);
    await shot('7-perform-pad');
    await click('Simple');
    await click('Guided');
    check('guided shows the way in', (await text()).includes('A few good ways in'));
    await click('Advanced');
    await click('Chorus');
    await click('Start Chorus on next bar');
    const phase = await waitFor<number>(
      `(() => { const s = __djw.session; const seg = s.segments[0]; if (!seg || !s.clock || s.ps.song.title !== 'Evening Test') return 0; return 1 + ((seg.landingCtx - s.clock.anchor) / s.clock.barLen) % 1; })()`,
      'next song is scheduled',
    );
    const offBar = Math.min(phase - 1, 2 - phase) * 1000;
    check('next song lands on a pad bar line', offBar < 5, `${offBar.toFixed(2)} ms`);
    await waitFor(`document.body.innerText.includes('Evening Test') && __djw.session.snapshot().song?.bar >= 1 && __djw.session.snapshot().song.idx === 1`, 'next song plays from the section picked', 12000);
    check('Go to pad still works in the last section', (await ev<boolean>(`${find('Go to pad (D)')}.disabled`)) === false && (await ev<boolean>('__djw.session.snapshot().song.ending')));
    // The pad kept under the new song fades over 8 bars (32 s at 60 BPM). Turning it off cuts that to 2 bars.
    const tailLeft = `Math.max(...__djw.session.fading.map(p => p.until)) - __djw.engine.now()`;
    await waitFor(`${find('Turn pad off')} && __djw.session.snapshot().padFading && !__djw.session.snapshot().pad`, 'the pad kept under the new song can still be turned off');
    const longTail = await ev<number>(tailLeft);
    await click('Turn pad off');
    const shortTail = await ev<number>(tailLeft);
    check('turning it off cuts its 8-bar fade to 2 bars', longTail > 12 && shortTail < 8.3, [longTail, shortTail]);
    await waitFor(find('Pad fading out'), 'and says it is fading out');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
    await shot('8-perform-tablet');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1042, deviceScaleFactor: 1, mobile: false });
    await click('Exit');
    await click('Tap again to stop');
    await waitFor(`location.hash.startsWith('#/sets')`, 'exit returns to Sets');
    check('no page errors', errors.length === 0, errors);
    await migrateFromV1();
  } catch (error) {
    await shot('failure').catch(() => {});
    console.log(`FAIL ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    await close(chrome);
  }
}

/** A fresh profile holding a v1 database: audio inside the song record, parts on downbeats, one set list. */
async function migrateFromV1() {
  const chrome = await launch();
  try {
    page = await openPage(chrome);
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/api/health` });
    await sleep(400);
    const audio = Buffer.from(wav(renderSong(SONG_B))).toString('base64');
    await ev(`(async () => {
      const bytes = Uint8Array.from(atob('${audio}'), c => c.charCodeAt(0));
      const db = await new Promise((ok, fail) => {
        const open = indexedDB.open('worship-looper', 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('songs', { keyPath: 'id' }).createIndex('by-date', 'dateAdded');
          open.result.createObjectStore('setlist', { keyPath: 'id' }).createIndex('by-order', 'order');
        };
        open.onsuccess = () => ok(open.result);
        open.onerror = fail;
      });
      const downbeats = Array.from({ length: 9 }, (_, i) => 0.25 + 4 * i);
      const part = (name, startBar, endBar, pickupBeats) => ({ id: name, name, startBar, endBar, pickupBeats, fadeInBeats: 0, fadeOutBeats: 1, loop: true, color: '#000' });
      const tx = db.transaction(['songs', 'setlist'], 'readwrite');
      tx.objectStore('songs').put({ id: 'v1song', name: 'Old Song', audioBlob: new Blob([bytes], { type: 'audio/wav' }), duration: 33.25, bpm: 60, timeSignature: '4/4', dateAdded: 1, regions: [], beats: [], phase: { kind: 'ready', downbeats, taps: downbeats, lockedBpm: 60, parts: [part('Intro', 1, 5, 0), part('Chorus', 5, 9, 1)] } });
      tx.objectStore('setlist').put({ id: 'row', songId: 'v1song', notes: '', order: 0 });
      await new Promise(ok => (tx.oncomplete = ok));
      db.close();
    })()`);
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/library` });
    await waitFor(`document.body.innerText.includes('Old Song') && document.body.innerText.includes('Export .djw')`, 'a v1 song survives the upgrade, ready to export');
    await waitFor(`document.querySelector('[aria-label^="Sections: Intro, Chorus"]')`, 'its v1 parts become Intro and Chorus');
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/sets` });
    await waitFor(`document.querySelector('input[aria-label="Set name"]')?.value === 'Set list' && document.body.innerText.includes('Old Song')`, 'the v1 set list becomes a set');
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/song/v1song/refine` });
    await waitFor(`document.body.innerText.includes('Chorus · bars 5–9') || [...document.querySelectorAll('[role=option]')].some(b => b.textContent.startsWith('Chorus'))`, 'its sections open in Refine');
    await page.send('Page.navigate', { url: `http://localhost:${WEB}/#/song/v1song/tap` });
    await waitFor(`Math.abs((__djw.engine.transport.buffer?.duration ?? 0) - 33.25) < 0.01`, 'its audio moved to the audio store and still plays');
  } catch (error) {
    await shot('failure-migrate').catch(() => {});
    throw error;
  } finally {
    await close(chrome);
  }
}

try {
  await main();
} finally {
  for (const child of children) child.kill('SIGTERM');
}
console.log(process.exitCode ? `\nE2E FAILED after ${passed} checks` : `\nE2E PASS (${passed} checks)`);
