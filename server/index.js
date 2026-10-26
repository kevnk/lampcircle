import express from 'express';
import { execFile, execFileSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const PORT = Number(process.env.HELPER_PORT || 3001);
const LIBRARY_DIR = path.resolve(process.env.LIBRARY_DIR || path.join(__dirname, '..', 'library'));
fs.mkdirSync(LIBRARY_DIR, { recursive: true });

function runs(bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const YT_DLP = [
  process.env.YT_DLP_PATH,
  path.join(process.env.HOME || '', '.local/bin/yt-dlp'),
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  'yt-dlp',
].find(bin => bin && (bin === 'yt-dlp' || fs.existsSync(bin)) && runs(bin)) ?? null;

/** @type {Array<{id: string, url: string, kind?: string, title?: string, artist?: string, status: string, percent: number, eta: number | null, fileName?: string, filePath?: string, error?: string}>} */
const jobs = [];
let busy = false;

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ytDlp: Boolean(YT_DLP) }));

app.get('/api/downloads', (_req, res) => res.json(jobs));

app.post('/api/downloads', (req, res) => {
  const { url, kind, map, title } = req.body ?? {};
  if (typeof url !== 'string' || !/^https?:\/\/\S+$/i.test(url.trim())) {
    return res.status(400).json({ error: 'Paste a full link that starts with https://' });
  }
  if (!YT_DLP) return res.status(503).json({ error: 'yt-dlp is not installed. Install it, then restart the helper.' });
  const job = {
    id: randomUUID(),
    url: url.trim(),
    ...(kind === 'pad' || kind === 'song' ? { kind } : {}),
    ...(map && typeof map === 'object' ? { map } : {}),
    ...(typeof title === 'string' && title ? { title } : {}),
    status: 'queued',
    percent: 0,
    eta: null,
  };
  jobs.push(job);
  execFile(YT_DLP, ['--no-playlist', '--no-warnings', '--skip-download', '--print', '%(title)s', '--', job.url], { timeout: 30000 }, (error, stdout) => {
    if (!error && !job.title) job.title = String(stdout).trim().split('\n')[0];
  });
  next();
  res.status(201).json(job);
});

/** Tracks of a playlist or album, without downloading. */
app.get('/api/list', (req, res) => {
  const url = String(req.query.url ?? '');
  if (!/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'Paste a full link that starts with https://' });
  if (!YT_DLP) return res.status(503).json({ error: 'yt-dlp is not installed. Install it, then restart the helper.' });
  execFile(YT_DLP, ['--flat-playlist', '--no-warnings', '--print', '%(id)s\t%(title)s', '--', url], { timeout: 60000 }, (error, stdout) => {
    if (error) return res.status(502).json({ error: 'Could not read that playlist.' });
    const entries = String(stdout)
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [id, ...title] = line.split('\t');
        return { url: `https://www.youtube.com/watch?v=${id}`, title: title.join('\t') };
      });
    res.json(entries);
  });
});

app.delete('/api/downloads/:id', (req, res) => {
  const index = jobs.findIndex(job => job.id === req.params.id && job.status !== 'downloading' && job.status !== 'converting');
  if (index >= 0) jobs.splice(index, 1);
  res.status(204).end();
});

app.get('/api/file/:fileName', (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const filePath = path.resolve(LIBRARY_DIR, fileName);
  if (fileName !== req.params.fileName || !filePath.startsWith(LIBRARY_DIR + path.sep)) {
    return res.status(400).json({ error: 'Bad file name' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

function next() {
  const job = jobs.find(item => item.status === 'queued');
  if (busy || !job) return;
  busy = true;
  job.status = 'downloading';
  const child = spawn(YT_DLP, [
    '--no-playlist',
    '--no-warnings',
    '--no-simulate',
    '--newline',
    '--progress',
    '-x',
    '--audio-format',
    'mp3',
    '--print',
    'before_dl:META %(.{title,uploader,artist,track})j',
    '--print',
    'after_move:FILEPATH %(filepath)s',
    '--progress-template',
    'download:PROG %(progress)j',
    '-o',
    '%(title)s [%(id)s].%(ext)s',
    '-P',
    LIBRARY_DIR,
    '--',
    job.url,
  ]);
  let errors = '';
  let pending = '';
  child.stdout.on('data', chunk => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) read(job, line.trim());
  });
  child.stderr.on('data', chunk => {
    errors += chunk;
    if (/PP started|ExtractAudio/.test(String(chunk))) job.status = 'converting';
  });
  child.on('close', code => {
    if (pending) read(job, pending.trim());
    const inside = job.filePath && path.resolve(job.filePath).startsWith(LIBRARY_DIR + path.sep) && fs.existsSync(job.filePath);
    if (code === 0 && inside) {
      job.status = 'done';
      job.percent = 100;
      job.fileName = path.basename(job.filePath);
    } else {
      job.status = 'error';
      job.error = errors.trim().split('\n').filter(Boolean).pop() || `yt-dlp exited with code ${code}`;
    }
    busy = false;
    next();
    if (job.status === 'done' && job.kind !== 'pad' && YOUTUBE.test(job.url)) writeCaptions(job.url, LIBRARY_DIR);
  });
}

const YOUTUBE = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)(\/|$)\S*$/i;
/** yt-dlp names manual and auto captions alike, so each kind gets its own call and name. Auto skips `en-en` and the like: the manual track, machine-translated. */
const CAPTION_KINDS = [
  ['--write-subs', 'en.*,-live_chat', 'subs'],
  ['--write-auto-subs', 'en-orig,en', 'auto'],
];
const CAPTION_FILE = /^(.*)\.(subs|auto)\.([A-Za-z0-9-]+)\.(json3|vtt)$/;

/** Saves a YouTube video's English captions into `dir`: manual as `<title> [<id>].subs.<lang>.<ext>`, auto as `.auto.`. Never fails: captions are extra. */
async function writeCaptions(url, dir) {
  for (const [flag, langs, kind] of CAPTION_KINDS) {
    const args = ['--no-playlist', '--no-warnings', '--skip-download', flag, '--sub-langs', langs, '--sub-format', 'json3/vtt'];
    await execFileAsync(YT_DLP, [...args, '-o', `subtitle:%(title)s [%(id)s].${kind}.%(ext)s`, '-P', dir, '--', url], { timeout: 60000 }).catch(error =>
      console.warn(`No ${kind} captions for ${url}: ${String(error.stderr || error.message).trim().split('\n').pop()}`),
    );
  }
}

/** Caption files directly in `dir`, only those for `stem` (an audio file's name without its extension) when given. */
function readCaptions(dir, stem) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const match = entry.isFile() && CAPTION_FILE.exec(entry.name);
    if (!match || (stem !== undefined && match[1] !== stem)) return [];
    const text = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    return [{ kind: match[2] === 'subs' ? 'manual' : 'auto', lang: match[3], ext: match[4], text }];
  });
}

/** Captions: `?file=` reads those saved beside a downloaded song's audio, `?url=` fetches a YouTube video's now. */
app.get('/api/captions', async (req, res) => {
  try {
    if (typeof req.query.file === 'string') return res.json(readCaptions(LIBRARY_DIR, path.parse(path.basename(req.query.file)).name));
    const url = String(req.query.url ?? '').trim();
    if (!YOUTUBE.test(url)) return res.status(400).json({ error: 'Captions come from YouTube links only.' });
    if (!YT_DLP) return res.status(503).json({ error: 'yt-dlp is not installed. Install it, then restart the helper.' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lampcircle-captions-'));
    try {
      await writeCaptions(url, dir);
      res.json(readCaptions(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

function read(job, line) {
  if (line.startsWith('META ')) {
    try {
      const meta = JSON.parse(line.slice(5));
      job.title = meta.track || meta.title || job.title;
      job.artist = meta.artist || meta.uploader || '';
    } catch {
      // Keep the probe's title.
    }
  } else if (line.startsWith('PROG ')) {
    try {
      const progress = JSON.parse(line.slice(5));
      if (typeof progress._percent === 'number') job.percent = Math.round(progress._percent * 10) / 10;
      job.eta = typeof progress.eta === 'number' ? progress.eta : null;
      if (progress.status === 'finished') job.status = 'converting';
    } catch {
      // Ignore a partial line.
    }
  } else if (line.startsWith('FILEPATH ')) {
    job.filePath = line.slice(9);
  }
}

// Only this computer reaches the helper directly. The Vite dev server proxies /api for tablets on the LAN.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Helper on http://localhost:${PORT}, library ${LIBRARY_DIR}`);
  console.log(`yt-dlp: ${YT_DLP ?? 'not found'}`);
});
