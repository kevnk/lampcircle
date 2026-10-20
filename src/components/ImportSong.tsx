import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { generateDemoTrack } from '../lib/audioGeneration';
import { detectBeats, estimateBPM } from '../lib/beatDetection';
import { expandDownbeats, readyMapFromRegions } from '../lib/songMap';
import { parseDjw, phaseFromDjw, type DjwMap } from '../lib/djw';
import { suggestRegions } from '../lib/regionDetection';
import { saveSong } from '../lib/db';
import { Song } from '../types';
import { YouTubeSearch } from './YouTubeSearch';

interface ImportSongProps {
  onSongImported: () => void;
}

type ImportMode = 'youtube' | 'file' | 'demo';

export function ImportSong({ onSongImported }: ImportSongProps) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [activeMode, setActiveMode] = useState<ImportMode>('file');
  const [dragActive, setDragActive] = useState(false);
  const [heldMap, setHeldMap] = useState<DjwMap | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyzeAndSave = async (
    name: string,
    audioBlob: Blob,
    audioBuffer: AudioBuffer,
    arrayBuffer?: ArrayBuffer
  ) => {
    setProgress('Detecting beats...');
    const beats = await detectBeats(audioBuffer);
    const bpm = estimateBPM(beats);

    setProgress('Suggesting regions...');
    const regions = await suggestRegions(audioBuffer, beats);

    setProgress('Saving song...');
    const song: Song = {
      id: crypto.randomUUID(),
      name,
      audioBlob:
        audioBlob ||
        new Blob([arrayBuffer!], { type: 'audio/wav' }),
      duration: audioBuffer.duration,
      bpm,
      timeSignature: '4/4',
      dateAdded: Date.now(),
      regions,
      beats,
      loops: [],
      activeLoopId: null,
      phase: { kind: 'needs-tap' },
    };

    await saveSong(song);
  };

  const handleFileImport = async (file: File) => {
    setImporting(true);
    setProgress('Reading file...');

    try {
      const audioContext = new AudioContext();
      const arrayBuffer = await file.arrayBuffer();

      setProgress('Decoding audio...');
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      await analyzeAndSave(
        file.name.replace(/\.[^/.]+$/, ''),
        new Blob([arrayBuffer], { type: file.type }),
        audioBuffer
      );
      await audioContext.close();

      setProgress('Done!');
      setTimeout(() => {
        onSongImported();
        setImporting(false);
        setProgress('');
      }, 500);
    } catch (error) {
      console.error('Import failed:', error);
      setProgress('Import failed. Please try again.');
      setTimeout(() => {
        setImporting(false);
        setProgress('');
      }, 2000);
    }
  };

  const handleYouTubeDownloadComplete = async (
    _filePath: string,
    fileName: string
  ) => {
    setImporting(true);
    setProgress('Processing downloaded file...');

    try {
      const response = await fetch(
        `http://localhost:3001/api/file/${encodeURIComponent(fileName)}`
      );
      if (!response.ok) throw new Error('Failed to fetch downloaded file');

      const blob = await response.blob();

      const audioContext = new AudioContext();
      const arrayBuffer = await blob.arrayBuffer();

      setProgress('Decoding audio...');
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      await analyzeAndSave(
        fileName.replace(/\.[^/.]+$/, '').replace(/-[a-zA-Z0-9_-]{11}$/, ''),
        blob,
        audioBuffer
      );
      await audioContext.close();

      setProgress('Done!');
      setTimeout(() => {
        onSongImported();
        setImporting(false);
        setProgress('');
      }, 500);
    } catch (error) {
      console.error('Processing failed:', error);
      setProgress('Failed to process downloaded file.');
      setTimeout(() => {
        setImporting(false);
        setProgress('');
      }, 2000);
    }
  };

  const handleGenerateDemo = async () => {
    setImporting(true);
    setProgress('Generating demo track...');

    try {
      const audioBlob = await generateDemoTrack();

      setProgress('Analyzing demo...');
      const audioContext = new AudioContext();
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      const beats = await detectBeats(audioBuffer);
      const bpm = estimateBPM(beats);

      setProgress('Suggesting regions...');
      // Prefer heuristic regions; fall back to hand-tuned demo sections if empty
      let regions = await suggestRegions(audioBuffer, beats);
      if (regions.length === 0) {
        const beatDur = 60 / 120;
        regions = [
          {
            id: crypto.randomUUID(),
            name: 'Intro',
            start: 0,
            end: 16 * beatDur,
            color: '#3b82f6',
          },
          {
            id: crypto.randomUUID(),
            name: 'Verse',
            start: 16 * beatDur,
            end: 32 * beatDur,
            color: '#10b981',
          },
          {
            id: crypto.randomUUID(),
            name: 'Chorus',
            start: 32 * beatDur,
            end: 48 * beatDur,
            color: '#ef4444',
          },
          {
            id: crypto.randomUUID(),
            name: 'Bridge',
            start: 48 * beatDur,
            end: 56 * beatDur,
            color: '#f59e0b',
          },
        ];
      }

      setProgress('Saving demo...');
      const phase = readyMapFromRegions(beats, regions, audioBuffer.duration, bpm || 120);
      const grid = phase.kind === 'ready' ? expandDownbeats(phase.downbeats, 4) : beats;
      const mappedRegions =
        phase.kind === 'ready'
          ? phase.parts.map(part => {
              const start = phase.downbeats[part.startBar - 1] ?? 0;
              const end =
                part.endBar >= phase.downbeats.length
                  ? audioBuffer.duration
                  : phase.downbeats[part.endBar - 1] ?? audioBuffer.duration;
              return { id: part.id, name: part.name, start, end, color: part.color };
            })
          : regions;
      const song: Song = {
        id: crypto.randomUUID(),
        name: 'Demo Track - 120 BPM',
        audioBlob,
        duration: audioBuffer.duration,
        bpm: phase.kind === 'ready' && phase.lockedBpm ? phase.lockedBpm : bpm,
        timeSignature: '4/4',
        dateAdded: Date.now(),
        regions: mappedRegions,
        beats: grid,
        loops: [],
        activeLoopId: null,
        phase,
      };

      await saveSong(song);
      await audioContext.close();

      setProgress('Demo ready!');
      setTimeout(() => {
        onSongImported();
        setImporting(false);
        setProgress('');
      }, 500);
    } catch (error) {
      console.error('Demo generation failed:', error);
      setProgress('Failed to generate demo.');
      setTimeout(() => {
        setImporting(false);
        setProgress('');
      }, 2000);
    }
  };

  const importWithMap = async (file: File, map: DjwMap) => {
    setImporting(true);
    setProgress('Reading audio for the map...');
    try {
      const audioContext = new AudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const phase = phaseFromDjw(map);
      const perBar = Number.parseInt(map.meter, 10) || 4;
      const song: Song = {
        id: crypto.randomUUID(),
        name: map.title,
        audioBlob: new Blob([arrayBuffer], { type: file.type || 'audio/wav' }),
        duration: audioBuffer.duration,
        bpm: phase.kind === 'ready' && phase.lockedBpm ? phase.lockedBpm : 0,
        timeSignature: map.meter,
        dateAdded: Date.now(),
        regions: phase.kind === 'ready'
          ? phase.parts.map(part => ({
              id: part.id,
              name: part.name,
              start: phase.downbeats[part.startBar - 1] ?? 0,
              end: part.endBar >= phase.downbeats.length
                ? audioBuffer.duration
                : phase.downbeats[part.endBar - 1] ?? audioBuffer.duration,
              color: part.color,
            }))
          : [],
        beats: phase.kind === 'ready' ? expandDownbeats(phase.downbeats, perBar) : [],
        loops: [],
        activeLoopId: null,
        phase,
      };
      await saveSong(song);
      await audioContext.close();
      setHeldMap(null);
      setProgress('Map attached.');
      setTimeout(() => {
        onSongImported();
        setImporting(false);
        setProgress('');
      }, 400);
    } catch (error) {
      console.error('Map attach failed:', error);
      setProgress('Could not attach that audio to the map.');
      setTimeout(() => {
        setImporting(false);
        setProgress('');
      }, 2000);
    }
  };

  const receiveFile = async (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.djw') || name.endsWith('.yaml') || name.endsWith('.yml')) {
      try {
        setHeldMap(parseDjw(await file.text()));
        setActiveMode('file');
      } catch (error) {
        setProgress(error instanceof Error ? error.message : 'Could not read that map.');
        setTimeout(() => setProgress(''), 2500);
      }
      return;
    }
    if (heldMap) {
      await importWithMap(file, heldMap);
      return;
    }
    await handleFileImport(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) void receiveFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  return (
    <div className="import-song-section">
      <div className="mb-6 flex gap-2 border-b border-gray-700">
        <button
          onClick={() => setActiveMode('youtube')}
          className={`px-2 py-3 font-medium transition-colors ${
            activeMode === 'youtube'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          YouTube Search
        </button>
        <button
          onClick={() => setActiveMode('file')}
          className={`px-2 py-3 font-medium transition-colors ${
            activeMode === 'file'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          Local File
        </button>
        <button
          onClick={() => setActiveMode('demo')}
          className={`px-2 py-3 font-medium transition-colors ${
            activeMode === 'demo'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          Demo Track
        </button>
      </div>

      {importing ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          <p className="text-white text-lg font-medium">{progress}</p>
        </div>
      ) : (
        <>
          {activeMode === 'youtube' && (
            <YouTubeSearch onDownloadComplete={handleYouTubeDownloadComplete} />
          )}

          {activeMode === 'file' && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`drop-zone p-12 border-2 border-dashed rounded-lg transition-colors text-center ${
                dragActive
                  ? 'border-blue-500 bg-blue-900 bg-opacity-20'
                  : 'border-gray-600 bg-gray-800'
              }`}
            >
              <h3 className={`text-white text-xl font-semibold ${heldMap ? 'mb-2' : 'mb-6'}`}>
                {heldMap ? `Audio for ${heldMap.title}` : 'Drop audio or a .djw map'}
              </h3>
              {heldMap && (
                <p className="text-gray-400 mb-6">The map is loaded. Drop the recording that goes with it.</p>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
              >
                Choose Audio File
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.djw,.yaml,.yml"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) void receiveFile(file);
                  e.target.value = '';
                }}
                className="hidden"
              />
              <p className="text-gray-500 text-sm mt-4">
                Audio, or a .djw map followed by its audio
              </p>
            </div>
          )}

          {activeMode === 'demo' && (
            <div className="demo-section p-12 bg-gray-800 rounded-lg text-center">
              <p className="text-gray-400 mb-6 max-w-md mx-auto">
                A 60-second synthetic track at 120 BPM for trying the flow.
              </p>
              <button
                onClick={handleGenerateDemo}
                className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
              >
                Generate Demo Track
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
