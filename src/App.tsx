import { useState, useEffect, useCallback } from 'react';
import { Song, SongLoop, DEFAULT_LOOP_SETTINGS } from './types';
import { useSongs } from './hooks/useSongs';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { WaveformPlayer } from './components/WaveformPlayer';
import { TransportControls } from './components/TransportControls';
import { RegionEditor } from './components/RegionEditor';
import { LoopManager } from './components/LoopManager';
import { StageMode } from './components/StageMode';
import { SettingsPanel } from './components/SettingsPanel';
import { BeatGridView } from './components/BeatGridView';
import { saveSong } from './lib/db';
import { snapLoopPoint } from './lib/beatDetection';
import { getNextLoopColor } from './lib/utils';
import { Maximize2, Library } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { TapScreen } from './components/TapScreen';
import { PrepScreen } from './components/PrepScreen';
import { PerformScreen } from './components/PerformScreen';

type View = 'library' | 'player' | 'stage' | 'tap' | 'prep' | 'perform';
type Panel = 'regions' | 'loops' | 'beats' | 'settings';

function App() {
  const { songs, loading, reload } = useSongs();
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [view, setView] = useState<View>('library');
  const [activePanel, setActivePanel] = useState<Panel>('regions');
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [playlist, setPlaylist] = useState<string[]>([]);

  const {
    playbackState,
    togglePlayPause,
    seekTo,
    setLoop,
    clearLoop,
    queueRegion,
    jumpToRegion,
    setVolume,
    toggleMetronome,
    setLoopSnapMode,
    setLoopOverlapBeats,
    setFadeCurve,
    setCrossfadeDuration,
    armPart,
    queuePart,
    jumpPart,
  } = useAudioPlayer(currentSong);

  const openSong = (song: Song, next: View, ids: string[] = []) => {
    setCurrentSong({
      ...song,
      loops: song.loops ?? [],
      activeLoopId: song.activeLoopId ?? null,
    });
    setPlaylist(ids);
    setView(next);
  };

  const saveAndKeep = async (updated: Song) => {
    await saveSong(updated);
    setCurrentSong(updated);
    void reload();
  };

  // Restore active named loop when selecting a song
  useEffect(() => {
    if (!currentSong) return;
    const loops = currentSong.loops ?? [];
    const activeId = currentSong.activeLoopId;
    if (activeId) {
      const loop = loops.find(l => l.id === activeId);
      if (loop) {
        setLoop(loop.start, loop.end);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id]);

  const handleBackToLibrary = () => {
    setView('library');
    setCurrentSong(null);
  };

  const handleRegionsUpdate = async (updatedRegions: Song['regions']) => {
    if (!currentSong) return;
    const updatedSong = { ...currentSong, regions: updatedRegions };
    await saveSong(updatedSong);
    setCurrentSong(updatedSong);
  };

  const handleLoopsUpdate = async (
    loops: SongLoop[],
    activeLoopId: string | null
  ) => {
    if (!currentSong) return;
    const updatedSong = { ...currentSong, loops, activeLoopId };
    await saveSong(updatedSong);
    setCurrentSong(updatedSong);
  };

  const handleSongUpdate = async (updatedSong: Song) => {
    await saveSong(updatedSong);
    setCurrentSong(updatedSong);
  };

  const persistLoopSettingsFromPlayback = useCallback(async () => {
    if (!currentSong) return;
    const loopSettings = {
      ...(currentSong.loopSettings ?? DEFAULT_LOOP_SETTINGS),
      snapMode: playbackState.loopSnapMode,
      overlapBeats: playbackState.loopOverlapBeats,
      fadeCurve: playbackState.fadeCurve,
    };
    const updated = { ...currentSong, loopSettings };
    await saveSong(updated);
    setCurrentSong(updated);
  }, [
    currentSong,
    playbackState.loopSnapMode,
    playbackState.loopOverlapBeats,
    playbackState.fadeCurve,
  ]);

  const snapTime = useCallback(
    (time: number) => {
      if (!currentSong) return time;
      return snapLoopPoint(time, currentSong.beats, playbackState.loopSnapMode);
    },
    [currentSong, playbackState.loopSnapMode]
  );

  /** Draft A–B clears named activeLoopId so playback uses the draft. */
  const applyDraftLoop = useCallback(
    async (start: number, end: number) => {
      setLoop(start, end);
      if (currentSong?.activeLoopId) {
        const updated = { ...currentSong, activeLoopId: null };
        await saveSong(updated);
        setCurrentSong(updated);
      }
    },
    [currentSong, setLoop]
  );

  const handleToggleLoop = () => {
    if (playbackState.loop.enabled) {
      clearLoop();
      setLoopStart(null);
      if (currentSong?.activeLoopId) {
        const updated = { ...currentSong, activeLoopId: null };
        void saveSong(updated).then(() => setCurrentSong(updated));
      }
    } else {
      if (loopStart === null) {
        setLoopStart(snapTime(playbackState.currentTime));
      } else {
        const end = snapTime(playbackState.currentTime);
        const start = Math.min(loopStart, end);
        const endT = Math.max(loopStart, end);
        void applyDraftLoop(start, endT);
        setLoopStart(null);
      }
    }
  };

  const handleSetLoopStart = () => {
    if (currentSong) {
      setLoopStart(snapTime(playbackState.currentTime));
    }
  };

  const handleSetLoopEnd = () => {
    if (currentSong && loopStart !== null) {
      const end = snapTime(playbackState.currentTime);
      const start = Math.min(loopStart, end);
      const endT = Math.max(loopStart, end);
      void applyDraftLoop(start, endT);
      setLoopStart(null);
    }
  };

  const handleActivateNamedLoop = (loop: SongLoop) => {
    setLoop(loop.start, loop.end);
    setLoopStart(null);
  };

  const handleClearActiveLoop = () => {
    clearLoop();
  };

  const handleSaveDraftAsLoopQuick = async () => {
    if (!currentSong || !playbackState.loop.enabled) return;
    const loops = currentSong.loops ?? [];
    const loop: SongLoop = {
      id: crypto.randomUUID(),
      name: `Loop ${loops.length + 1}`,
      start: playbackState.loop.start,
      end: playbackState.loop.end,
      color: getNextLoopColor(loops),
    };
    const next = [...loops, loop];
    const updated = { ...currentSong, loops: next, activeLoopId: loop.id };
    await saveSong(updated);
    setCurrentSong(updated);
    setActivePanel('loops');
  };

  useKeyboardShortcuts(
    {
      ' ': togglePlayPause,
      l: handleToggleLoop,
      '[': handleSetLoopStart,
      ']': handleSetLoopEnd,
      m: toggleMetronome,
      f: () => {
        if (view === 'player') setView('stage');
        else if (view === 'stage') setView('player');
      },
      escape: () => {
        if (view === 'stage') setView('player');
      },
      '1': () =>
        currentSong?.regions[0] && jumpToRegion(currentSong.regions[0].id, true),
      '2': () =>
        currentSong?.regions[1] && jumpToRegion(currentSong.regions[1].id, true),
      '3': () =>
        currentSong?.regions[2] && jumpToRegion(currentSong.regions[2].id, true),
      '4': () =>
        currentSong?.regions[3] && jumpToRegion(currentSong.regions[3].id, true),
      '5': () =>
        currentSong?.regions[4] && jumpToRegion(currentSong.regions[4].id, true),
      '6': () =>
        currentSong?.regions[5] && jumpToRegion(currentSong.regions[5].id, true),
      '7': () =>
        currentSong?.regions[6] && jumpToRegion(currentSong.regions[6].id, true),
      '8': () =>
        currentSong?.regions[7] && jumpToRegion(currentSong.regions[7].id, true),
      '9': () =>
        currentSong?.regions[8] && jumpToRegion(currentSong.regions[8].id, true),
    },
    view === 'player' || view === 'stage'
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (view === 'tap' && currentSong) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6">
        <TapScreen
          song={currentSong}
          currentTime={playbackState.currentTime}
          isPlaying={playbackState.isPlaying}
          onToggle={togglePlayPause}
          onSong={song => void saveAndKeep(song)}
          onBack={handleBackToLibrary}
          onPrep={() => setView('prep')}
        />
      </div>
    );
  }

  if (view === 'prep' && currentSong) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6">
        <PrepScreen
          song={currentSong}
          currentTime={playbackState.currentTime}
          isPlaying={playbackState.isPlaying}
          onToggle={togglePlayPause}
          onSeek={seekTo}
          onSong={song => void saveAndKeep(song)}
          onBack={handleBackToLibrary}
          onRetap={() => setView('tap')}
          onPerform={() => setView('perform')}
        />
      </div>
    );
  }

  if (view === 'perform' && currentSong) {
    return (
      <PerformScreen
        song={currentSong}
        playlist={playlist}
        songs={songs}
        playback={playbackState}
        onToggle={togglePlayPause}
        onQueue={queuePart}
        onJump={jumpPart}
        onArm={armPart}
        onBack={handleBackToLibrary}
        onSong={id => {
          const next = songs.find(song => song.id === id);
          if (next) openSong(next, 'perform', playlist);
        }}
        onMetronome={toggleMetronome}
      />
    );
  }

  if (view === 'stage' && currentSong) {
    return (
      <StageMode
        song={currentSong}
        playbackState={playbackState}
        onJumpToRegion={id => jumpToRegion(id, true)}
      />
    );
  }

  const activeNamedLoop = currentSong?.loops?.find(
    l => l.id === currentSong.activeLoopId
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">Lampcircle</h1>
          </div>

          <div className="flex items-center gap-3">
            {view === 'player' && currentSong ? (
              <>
                <button
                  onClick={() => setView('stage')}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm font-medium"
                >
                  <Maximize2 className="w-4 h-4" />
                  Stage Mode
                </button>
                <button
                  onClick={handleBackToLibrary}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm"
                >
                  <Library className="w-4 h-4" />
                  Library
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
            {view === 'library' && (
          <Dashboard
            songs={songs}
            onReload={reload}
            onTap={song => openSong(song, 'tap')}
            onPrep={song => openSong(song, 'prep')}
            onPerform={(song, ids) => openSong(song, 'perform', ids)}
          />
        )}

        {view === 'player' && currentSong && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold">{currentSong.name}</h2>
                <p className="text-gray-400 mt-1">
                  {currentSong.bpm ? `${currentSong.bpm} BPM` : ''}
                  {(currentSong.loops?.length ?? 0) > 0 && (
                    <span className="ml-2">
                      · {currentSong.loops!.length} loop
                      {currentSong.loops!.length !== 1 ? 's' : ''}
                      {activeNamedLoop ? ` · active: ${activeNamedLoop.name}` : ''}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <WaveformPlayer
              song={currentSong}
              currentTime={playbackState.currentTime}
              isPlaying={playbackState.isPlaying}
              onSeek={seekTo}
              onRegionUpdate={handleRegionsUpdate}
              loop={
                playbackState.loop.enabled
                  ? {
                      start: playbackState.loop.start,
                      end: playbackState.loop.end,
                      enabled: true,
                    }
                  : undefined
              }
            />

            <TransportControls
              song={currentSong}
              playbackState={playbackState}
              onPlayPause={togglePlayPause}
              onSeek={seekTo}
              onVolumeChange={setVolume}
              onLoopToggle={handleToggleLoop}
              onMetronomeToggle={toggleMetronome}
              onSnapModeChange={mode => {
                setLoopSnapMode(mode);
              }}
              onOverlapChange={beats => {
                setLoopOverlapBeats(beats);
              }}
              onFadeCurveChange={curve => {
                setFadeCurve(curve);
              }}
              onPersistLoopSettings={persistLoopSettingsFromPlayback}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <div className="flex gap-2 mb-4 border-b border-gray-700 overflow-x-auto">
                    {(
                      [
                        ['regions', 'Regions'],
                        ['loops', 'Loops'],
                        ['beats', 'Beat Grid'],
                        ['settings', 'Settings'],
                      ] as [Panel, string][]
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setActivePanel(id)}
                        className={`px-4 py-2 whitespace-nowrap ${
                          activePanel === id
                            ? 'border-b-2 border-blue-500 text-white'
                            : 'text-gray-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {activePanel === 'regions' && (
                    <RegionEditor
                      song={currentSong}
                      currentTime={playbackState.currentTime}
                      snapMode={playbackState.loopSnapMode}
                      onRegionsUpdate={handleRegionsUpdate}
                      onJumpToRegion={id => jumpToRegion(id, true)}
                      onQueueRegion={queueRegion}
                      onLoopRegion={(start, end) => {
                        void applyDraftLoop(start, end);
                      }}
                    />
                  )}

                  {activePanel === 'loops' && (
                    <LoopManager
                      song={currentSong}
                      snapMode={playbackState.loopSnapMode}
                      draftLoop={
                        playbackState.loop.enabled
                          ? {
                              start: playbackState.loop.start,
                              end: playbackState.loop.end,
                              enabled: true,
                            }
                          : loopStart !== null
                            ? {
                                start: loopStart,
                                end: playbackState.currentTime,
                                enabled: false,
                              }
                            : null
                      }
                      activeLoopId={currentSong.activeLoopId}
                      onLoopsUpdate={handleLoopsUpdate}
                      onActivateLoop={handleActivateNamedLoop}
                      onClearActive={handleClearActiveLoop}
                    />
                  )}

                  {activePanel === 'beats' && (
                    <BeatGridView
                      song={currentSong}
                      currentTime={playbackState.currentTime}
                      onSeekToBeat={seekTo}
                      onSongUpdate={handleSongUpdate}
                    />
                  )}

                  {activePanel === 'settings' && (
                    <SettingsPanel
                      song={currentSong}
                      playbackState={playbackState}
                      onSongUpdate={handleSongUpdate}
                      onSnapModeChange={setLoopSnapMode}
                      onOverlapChange={setLoopOverlapBeats}
                      onFadeCurveChange={setFadeCurve}
                      onCrossfadeDurationChange={setCrossfadeDuration}
                    />
                  )}
                </div>
              </div>

              <div className="lg:col-span-1">
                <div className="bg-gray-800 rounded-lg p-4 sticky top-6 border border-gray-700">
                  <h3 className="text-white font-semibold mb-4">Quick Actions</h3>

                  <div className="space-y-3">
                    {loopStart !== null && (
                      <div className="p-3 bg-blue-900 bg-opacity-40 rounded text-sm text-blue-300 mb-3 border border-blue-700">
                        Loop start set ({loopStart.toFixed(2)}s). Press ] to set
                        end, or L to cancel. Snap:{' '}
                        {playbackState.loopSnapMode}
                      </div>
                    )}

                    <p className="text-gray-400 text-sm">
                      Press 1–9 to jump to regions, Space play/pause, L for loop, [
                      ] to set loop points (snapped), M metronome. Save drafts as
                      named loops in the Loops tab.
                    </p>

                    <div className="border-t border-gray-700 pt-3 mt-3">
                      <h4 className="text-white font-medium mb-2 text-sm">
                        Loop Controls
                      </h4>
                      <button
                        onClick={handleSetLoopStart}
                        className="w-full mb-2 px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                      >
                        Set Loop Start [
                      </button>
                      <button
                        onClick={handleSetLoopEnd}
                        className="w-full mb-2 px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
                        disabled={loopStart === null}
                      >
                        Set Loop End ]
                      </button>
                      {playbackState.loop.enabled && (
                        <>
                          <button
                            onClick={handleSaveDraftAsLoopQuick}
                            className="w-full mb-2 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm"
                          >
                            Save as loop
                          </button>
                          <button
                            onClick={() => {
                              clearLoop();
                              if (currentSong.activeLoopId) {
                                const updated = {
                                  ...currentSong,
                                  activeLoopId: null,
                                };
                                void saveSong(updated).then(() =>
                                  setCurrentSong(updated)
                                );
                              }
                            }}
                            className="w-full px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                          >
                            Clear Loop
                          </button>
                        </>
                      )}
                    </div>

                    {(currentSong.loops?.length ?? 0) > 0 && (
                      <div className="border-t border-gray-700 pt-3 mt-3">
                        <h4 className="text-white font-medium mb-2 text-sm">
                          Switch Loop
                        </h4>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {currentSong.loops!.map(loop => (
                            <button
                              key={loop.id}
                              type="button"
                              onClick={() => {
                                void handleLoopsUpdate(
                                  currentSong.loops ?? [],
                                  loop.id
                                );
                                handleActivateNamedLoop(loop);
                              }}
                              className={`w-full text-left px-3 py-1.5 rounded text-sm truncate ${
                                currentSong.activeLoopId === loop.id
                                  ? 'bg-emerald-700 text-white'
                                  : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                              }`}
                            >
                              {loop.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
