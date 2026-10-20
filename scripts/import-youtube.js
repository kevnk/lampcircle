#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const LIBRARY_DIR = join(process.cwd(), 'library');

if (!existsSync(LIBRARY_DIR)) {
  mkdirSync(LIBRARY_DIR, { recursive: true });
}

const url = process.argv[2];

if (!url) {
  console.error('Usage: npm run import-youtube -- <youtube-url>');
  console.error('Example: npm run import-youtube -- https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  process.exit(1);
}

console.log('Checking for yt-dlp...');

const checkYtDlp = spawn('yt-dlp', ['--version']);

checkYtDlp.on('error', () => {
  console.error('\nyt-dlp is not installed or not in PATH.');
  console.error('Install it with:');
  console.error('  brew install yt-dlp  (macOS)');
  console.error('  pip install yt-dlp   (Python)');
  console.error('  Or visit: https://github.com/yt-dlp/yt-dlp#installation');
  process.exit(1);
});

checkYtDlp.on('close', (code) => {
  if (code !== 0) {
    console.error('yt-dlp check failed.');
    process.exit(1);
  }

  console.log('\n📥 Downloading audio from YouTube...');
  console.log('⚠️  IMPORTANT: Only download content for personal use.');
  console.log('   Ensure you have the rights to download this content.\n');

  const ytDlp = spawn('yt-dlp', [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '-o', join(LIBRARY_DIR, '%(title)s.%(ext)s'),
    '--no-playlist',
    '--embed-thumbnail',
    '--add-metadata',
    url
  ], { stdio: 'inherit' });

  ytDlp.on('close', (code) => {
    if (code === 0) {
      console.log(`\n✅ Download complete! Check the library/ folder.`);
      console.log('   You can now drag and drop the file into the app.');
    } else {
      console.error(`\n❌ Download failed with code ${code}`);
      process.exit(1);
    }
  });
});
