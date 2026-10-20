import { Song, PlaybackState } from '../types';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useState } from 'react';
import { formatTime, formatBarBeat } from '../lib/utils';

interface StageModeProps {
  song: Song;
  playbackState: PlaybackState;
  onJumpToRegion: (regionId: string) => void;
}

export function StageMode({ song, playbackState, onJumpToRegion }: StageModeProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const currentRegion = song.regions.find(r => r.id === playbackState.currentRegion);
  const queuedRegion = playbackState.queuedRegion
    ? song.regions.find(r => r.id === playbackState.queuedRegion)
    : null;

  const getCurrentBeat = () => {
    const beat = song.beats.find(
      b => Math.abs(b.time - playbackState.currentTime) < 0.1
    );
    return beat || null;
  };

  const currentBeat = getCurrentBeat();

  const barsRemainingInLoop = () => {
    if (!playbackState.loop.enabled) return null;
    
    const remainingTime = playbackState.loop.end - playbackState.currentTime;
    const beatsInBar = 4;
    const bpm = song.bpm || 120;
    const beatDuration = 60 / bpm;
    const remainingBeats = Math.ceil(remainingTime / beatDuration);
    const remainingBars = Math.ceil(remainingBeats / beatsInBar);
    
    return remainingBars;
  };

  return (
    <div className={`stage-mode ${isFullscreen ? 'fixed inset-0 z-50' : ''} bg-gray-900 p-8`}>
      <div className="flex justify-end mb-4">
        <button
          onClick={toggleFullscreen}
          className="p-2 bg-gray-800 text-white rounded hover:bg-gray-700"
        >
          {isFullscreen ? (
            <Minimize2 className="w-5 h-5" />
          ) : (
            <Maximize2 className="w-5 h-5" />
          )}
        </button>
      </div>

      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-6xl font-bold text-white mb-4">{song.name}</h1>
          {song.bpm && (
            <p className="text-2xl text-gray-400">{song.bpm} BPM</p>
          )}
        </div>

        <div className="mb-12 text-center">
          <div className="inline-block bg-blue-900 bg-opacity-40 px-8 py-4 rounded-xl">
            <p className="text-gray-400 text-lg mb-2">Current Section</p>
            <p className="text-5xl font-bold text-white">
              {currentRegion ? currentRegion.name : '—'}
            </p>
            {currentBeat && (
              <p className="text-2xl text-gray-400 mt-2">
                Bar {formatBarBeat(currentBeat.bar, currentBeat.beat)}
              </p>
            )}
          </div>
        </div>

        {playbackState.loop.enabled && barsRemainingInLoop() !== null && (
          <div className="mb-12 text-center">
            <div className="inline-block bg-green-900 bg-opacity-40 px-8 py-4 rounded-xl">
              <p className="text-gray-400 text-lg mb-2">Loop</p>
              <p className="text-4xl font-bold text-green-300">
                {barsRemainingInLoop()} bars remaining
              </p>
              {playbackState.loop.count > 0 && (
                <p className="text-xl text-gray-400 mt-2">
                  Iteration {playbackState.loop.currentIteration + 1} of {playbackState.loop.count}
                </p>
              )}
            </div>
          </div>
        )}

        {queuedRegion && (
          <div className="mb-12 text-center">
            <div className="inline-block bg-purple-900 bg-opacity-40 px-8 py-4 rounded-xl">
              <p className="text-gray-400 text-lg mb-2">Queued Next</p>
              <p className="text-4xl font-bold text-purple-300">
                {queuedRegion.name}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          {song.regions.map((region, index) => (
            <button
              key={region.id}
              onClick={() => onJumpToRegion(region.id)}
              className={`region-pad p-6 rounded-xl text-center transition-all transform hover:scale-105 ${
                region.id === playbackState.currentRegion
                  ? 'ring-4 ring-white scale-105'
                  : ''
              }`}
              style={{
                backgroundColor: region.color + '40',
                borderLeft: `6px solid ${region.color}`
              }}
            >
              <div className="text-3xl font-bold text-white mb-2">
                {index + 1}
              </div>
              <div className="text-xl font-semibold text-white">
                {region.name}
              </div>
            </button>
          ))}
        </div>

        {song.lyrics && (
          <div className="bg-gray-800 bg-opacity-50 p-6 rounded-xl">
            <h3 className="text-2xl font-semibold text-white mb-4">Lyrics</h3>
            <div className="text-lg text-gray-300 whitespace-pre-wrap">
              {song.lyrics}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
