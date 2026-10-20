# Lampcircle

**Working product name (2026-09-29):** Lampcircle — live song maps for home-church / living-room spontaneous worship. Former folder/working name: `worship-song-looper` / Worship Song Looper.


A production-quality local-first web app for leading spontaneous worship. Import songs, detect beats, create regions, and seamlessly loop any section into another for live worship leading.

![Lampcircle](https://img.shields.io/badge/Built%20with-React%20%2B%20TypeScript-blue)

## Features

### 🎵 Core Looper Features
- **Beat Detection**: Automatic beat and bar detection with confidence scoring
- **Region Management**: Mark song sections (Intro, Verse, Chorus, Bridge, etc.)
- **Seamless Looping**: A-B loop with crossfade for gapless transitions
- **Live Queue System**: Queue next section while looping current section
- **Quantized Jumps**: Jump between sections at bar boundaries
- **Waveform Visualization**: See beats, regions, and loop points visually

### 🎹 Worship-Specific Features
- **Stage Mode**: Full-screen tablet-friendly UI with large section pads
- **Beat Grid View**: Detailed beat-by-beat navigation with confidence levels
- **Lyrics Panel**: Paste and view lyrics alongside playback
- **Session Presets**: Save region maps and settings per song
- **Metronome**: Click track overlay with volume control
- **Count-in**: Optional count-in before playback starts

### ⌨️ Keyboard Shortcuts
- `Space` - Play/Pause
- `1-9` - Jump to regions 1-9 (quantized to next bar)
- `L` - Toggle loop mode
- `[` - Set loop start point
- `]` - Set loop end point
- `M` - Toggle metronome
- `F` - Toggle stage mode
- `Q` - Queue current region
- `Esc` - Exit stage mode

### 💾 Data Management
- **Local-First**: All data stored in IndexedDB
- **Export/Import**: Export session presets as JSON
- **Beat Grid Export**: Export beat data as CSV
- **Audio Library**: Personal audio file management

## Installation

```bash
npm install
```

## Running the App

```bash
npm run dev
```

This starts both the Vite dev server (port 43123) and the YouTube API server (port 3001).

The app will be available at `http://localhost:43123`

## Importing Songs

### Option 1: YouTube Search & Download (Recommended)
1. Click "Import Song" in the library
2. Go to the "YouTube Search" tab
3. Search for a worship song (e.g., "Way Maker worship")
4. Click "Download & Analyze" on any result
5. Wait for download and automatic beat detection
6. Song is added to your library with detected beats

**Note**: If YouTube search is unavailable due to rate limiting, switch to the "Direct URL" tab and paste a YouTube link directly.

### Option 2: Drag and Drop Audio Files
Simply drag and drop any audio file (mp3, wav, m4a, flac, ogg) into the "Local File" tab.

### Option 3: Generate Demo Track
Click "Generate Demo Track" to create a synthetic worship-style track with pre-defined regions. Perfect for testing and learning the app.

### Option 4: YouTube CLI (Legacy)
If you prefer command-line downloads:

```bash
npm run import-youtube -- "https://www.youtube.com/watch?v=..."
```

**⚠️ IMPORTANT**: Only download content for personal worship practice. Ensure you have the rights to use any copyrighted material.

#### Installing yt-dlp

The app automatically uses yt-dlp if available. It's installed during setup.

```bash
# If needed, install manually:
pip3 install yt-dlp

# macOS alternative:
brew install yt-dlp

# Or visit: https://github.com/yt-dlp/yt-dlp#installation
```

**Note**: YouTube may sometimes require authentication. If search doesn't work, use the "Direct URL" tab to paste video links directly.

## Workflow Example

1. **Import** - Import or generate a demo track
2. **Analyze** - App automatically detects beats and estimates BPM
3. **Create Regions** - Mark sections like "Intro", "Verse", "Chorus", "Bridge"
4. **Practice** - Use keyboard shortcuts to jump between sections
5. **Loop** - Set loop points with `[` and `]`, press `L` to loop
6. **Queue** - While looping, queue the next section for seamless transition
7. **Stage Mode** - Press `F` for full-screen view perfect for tablets

## Beat Detection

The app uses energy-based onset detection with beat tracking:
- Analyzes audio energy across frames
- Detects peaks and estimates tempo
- Snaps regions and loop points to detected beats
- Shows confidence scores for each beat
- Manual adjustment available if needed

## Technology Stack

- **React 18** + **TypeScript** - UI framework
- **Vite** - Build tool and dev server
- **Express** - YouTube API backend server
- **Tone.js** - Audio synthesis for demo tracks
- **WaveSurfer.js** - Waveform visualization
- **Web Audio API** - Audio playback and processing
- **IndexedDB** (via idb) - Local storage
- **Lucide React** - Icons
- **yt-dlp** - YouTube download integration

## Project Structure

```
src/
├── components/         # React components
│   ├── YouTubeSearch.tsx      # YouTube search and download
│   ├── WaveformPlayer.tsx     # Beat-marked waveform
│   ├── TransportControls.tsx  # Play/pause/volume
│   ├── RegionEditor.tsx       # Section management
│   ├── StageMode.tsx          # Full-screen view
│   ├── BeatGridView.tsx       # Beat list
│   ├── SettingsPanel.tsx      # Settings and export
│   └── ...
├── hooks/             # Custom React hooks
│   ├── useAudioPlayer.ts      # Playback logic
│   ├── useKeyboardShortcuts.ts
│   └── useSongs.ts
├── lib/               # Core utilities
│   ├── beatDetection.ts       # Energy onset detection
│   ├── audioGeneration.ts     # Demo track synthesis
│   ├── db.ts                  # IndexedDB interface
│   └── utils.ts               # Helper functions
├── types/             # TypeScript types
└── index.css          # Global styles

server/
└── index.js           # Express YouTube API server
```

## Key Concepts

### Regions
Regions are named sections of your song (Verse, Chorus, etc.). They:
- Snap to detected beats for precise boundaries
- Can be created, edited, and deleted
- Are color-coded for visual identification
- Can be jumped to via keyboard (1-9 keys)

### Loop System
The loop system supports:
- **A-B Loop**: Set start and end points
- **Infinite Loop**: Loop forever until stopped
- **Counted Loop**: Loop N times then continue
- **Queue System**: Queue next region to play after loop ends
- **Quantization**: Jumps happen at bar boundaries for musical timing

### Beat Grid
The beat grid shows every detected beat with:
- **Time**: Exact timestamp
- **Bar.Beat**: Musical position (e.g., 1.1, 1.2, 2.1)
- **Confidence**: How certain the algorithm is (high/medium/low)
- Click any beat to seek to that position

## Personal Use Disclaimer

This app is designed for **personal worship practice** only. When importing audio:
- Only use content you have the rights to use
- YouTube imports are for personal/family practice only
- Do not redistribute copyrighted material
- Respect artists' and publishers' rights

## Browser Support

Works best in modern browsers with Web Audio API support:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Building for Production

```bash
npm run build
```

The built app will be in the `dist/` folder.

## Tips for Worship Leaders

1. **Pre-mark Regions**: Before worship, mark all regions in your songs
2. **Practice Transitions**: Use the queue system to rehearse section transitions
3. **Use Stage Mode**: Put your tablet in stage mode for easy section selection
4. **Save Presets**: Export session presets to reuse region maps across services
5. **Adjust Crossfade**: Fine-tune crossfade duration for your style (0-200ms+)
6. **Metronome Training**: Use the click track to practice staying on tempo

## License

MIT

## Support

For issues or questions, please open an issue on the repository.

---

Built with ❤️ for worship leaders everywhere.
