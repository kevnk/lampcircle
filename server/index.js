import express from 'express';
import cors from 'cors';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const LIBRARY_DIR = path.join(__dirname, '..', 'library');
function ytDlpRuns(bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveYtDlp() {
  const candidates = [];
  if (process.env.YT_DLP_PATH) candidates.push(process.env.YT_DLP_PATH);
  candidates.push(
    path.join(process.env.HOME || '', '.local/bin/yt-dlp'),
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    'yt-dlp'
  );
  for (const candidate of candidates) {
    if (candidate !== 'yt-dlp' && !fs.existsSync(candidate)) continue;
    if (ytDlpRuns(candidate)) return candidate;
  }
  return null;
}

const YT_DLP_PATH = resolveYtDlp();
const YT_DLP_ARGS = [
  '--extractor-args',
  'youtube:player_client=android,web',
  '--no-check-certificates',
];

if (!fs.existsSync(LIBRARY_DIR)) {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
}

app.get('/api/youtube/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    if (!YT_DLP_PATH) {
      return res.status(503).json({
        error: 'yt-dlp not found',
        message: 'Install yt-dlp, then restart the helper.',
      });
    }

    const searchQuery = `ytsearch5:${q}`;
    const { stdout } = await execFileAsync(
      YT_DLP_PATH,
      [
        searchQuery,
        '--flat-playlist',
        '--dump-single-json',
        '--skip-download',
        '--no-warnings',
      ],
      { maxBuffer: 1024 * 1024 * 8 }
    );

    const data = JSON.parse(stdout);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const results = entries.filter(entry => entry && entry.id).map(entry => ({
      id: entry.id,
      title: entry.title,
      channel: entry.channel || entry.uploader || '',
      duration: entry.duration || 0,
      thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url || '',
      url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
      viewCount: entry.view_count,
    }));

    res.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ 
      error: 'Search failed', 
      message: error.message 
    });
  }
});

app.post('/api/youtube/download', async (req, res) => {
  const { videoId, url } = req.body;
  
  if (!videoId && !url) {
    return res.status(400).json({ error: 'videoId or url is required' });
  }

  try {
    if (!YT_DLP_PATH) {
      return res.status(503).json({
        error: 'yt-dlp not found',
        message: 'Install yt-dlp, then restart the helper.',
      });
    }

    const videoUrl = url || `https://www.youtube.com/watch?v=${videoId}`;
    const outputTemplate = path.join(LIBRARY_DIR, '%(title)s-%(id)s.%(ext)s');

    const { stdout } = await execFileAsync(
      YT_DLP_PATH,
      [
        videoUrl,
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '-o',
        outputTemplate,
        '--no-playlist',
        '--print',
        'after_move:filepath',
        '--no-warnings',
        ...YT_DLP_ARGS,
      ],
      { maxBuffer: 1024 * 1024 * 50, timeout: 300000 }
    );

    const filePath = String(stdout).trim().split('\n').pop();
    const root = path.resolve(LIBRARY_DIR);
    const resolved = filePath ? path.resolve(filePath) : '';

    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved)) {
      throw new Error('Download completed but file not found');
    }

    const fileName = path.basename(resolved);
    const stats = fs.statSync(resolved);

    res.json({
      success: true,
      fileName,
      filePath: resolved,
      size: stats.size
    });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      error: 'Download failed', 
      message: error.message 
    });
  }
});

app.get('/api/youtube/check', (req, res) => {
  res.json({
    available: Boolean(YT_DLP_PATH),
    path: YT_DLP_PATH,
    message: YT_DLP_PATH
      ? 'yt-dlp is installed and ready'
      : 'yt-dlp not found',
  });
});

app.get('/api/file/:fileName', (req, res) => {
  const fileName = path.basename(req.params.fileName);
  const root = path.resolve(LIBRARY_DIR);
  const filePath = path.resolve(root, fileName);

  if (
    fileName !== req.params.fileName ||
    fileName === '.' ||
    fileName === '..' ||
    !filePath.startsWith(root + path.sep)
  ) {
    return res.status(400).json({ error: 'Bad file name' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`YouTube API server running on http://localhost:${PORT}`);
  console.log(`yt-dlp available: ${YT_DLP_PATH ?? 'not found'}`);
});
