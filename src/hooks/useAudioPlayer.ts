import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Song,
  PlaybackState,
  LoopSnapMode,
  LoopOverlapBeats,
  FadeCurve,
  DEFAULT_LOOP_SETTINGS,
} from '../types';
import {
  findNextBarBoundary,
  getBeatDurationSeconds,
} from '../lib/beatDetection';
import { beatsPerBar, partWindow } from '../lib/songMap';
import { scheduleEntry } from '../lib/performPlan';
import * as Tone from 'tone';

interface ActiveSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

function scheduleFade(
  gain: GainNode,
  from: number,
  to: number,
  startTime: number,
  duration: number,
  curve: FadeCurve
) {
  gain.gain.cancelScheduledValues(startTime);
  gain.gain.setValueAtTime(from, startTime);
  if (duration <= 0) {
    gain.gain.setValueAtTime(to, startTime);
    return;
  }
  if (curve === 'linear') {
    gain.gain.linearRampToValueAtTime(to, startTime + duration);
    return;
  }
  // Equal-power: cos/sin quarter-circle
  const steps = 64;
  const values = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    if (from > to) {
      values[i] = Math.cos((t * Math.PI) / 2) * from;
    } else {
      values[i] = Math.sin((t * Math.PI) / 2) * to;
    }
  }
  // Avoid zero-length curve edge cases
  gain.gain.setValueCurveAtTime(values, startTime, Math.max(duration, 0.001));
}

export function useAudioPlayer(song: Song | null) {
  const initialLoop = song?.loopSettings ?? DEFAULT_LOOP_SETTINGS;

  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    isPlaying: false,
    currentTime: 0,
    loop: {
      enabled: false,
      start: 0,
      end: 0,
      count: -1,
      currentIteration: 0,
    },
    queuedRegion: null,
    currentRegion: null,
    tempoAdjust: 0,
    pitchShift: 0,
    volume: 1,
    crossfadeDuration: 50,
    metronomeEnabled: false,
    metronomeVolume: 0.3,
    loopSnapMode: initialLoop.snapMode,
    loopOverlapBeats: initialLoop.overlapBeats,
    fadeCurve: initialLoop.fadeCurve,
    activePartId: null,
    queuedPartId: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const clickGainRef = useRef<GainNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const activeSourcesRef = useRef<ActiveSource[]>([]);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(false);
  const loopRef = useRef(playbackState.loop);
  const queuedRegionRef = useRef<string | null>(null);
  const overlapBeatsRef = useRef<LoopOverlapBeats>(initialLoop.overlapBeats);
  const fadeCurveRef = useRef<FadeCurve>(initialLoop.fadeCurve);
  const crossfadingRef = useRef(false);
  const songRef = useRef(song);
  const partEntryRef = useRef<{ at: number; partId: string } | null>(null);
  const enterPartRef = useRef<(partId: string) => void>(() => {});
  const activePartRef = useRef<string | null>(null);
  const metronomeRef = useRef(false);
  const lastClickTimeRef = useRef(-1);

  useEffect(() => {
    songRef.current = song;
  }, [song]);

  useEffect(() => {
    loopRef.current = playbackState.loop;
  }, [playbackState.loop]);

  useEffect(() => {
    queuedRegionRef.current = playbackState.queuedRegion;
  }, [playbackState.queuedRegion]);

  useEffect(() => {
    overlapBeatsRef.current = playbackState.loopOverlapBeats;
  }, [playbackState.loopOverlapBeats]);

  useEffect(() => {
    fadeCurveRef.current = playbackState.fadeCurve;
  }, [playbackState.fadeCurve]);

  useEffect(() => {
    activePartRef.current = playbackState.activePartId;
  }, [playbackState.activePartId]);

  useEffect(() => {
    metronomeRef.current = playbackState.metronomeEnabled;
  }, [playbackState.metronomeEnabled]);

  // Apply song loop settings when song changes
  useEffect(() => {
    if (!song) return;
    const ls = song.loopSettings ?? DEFAULT_LOOP_SETTINGS;
    setPlaybackState(prev => ({
      ...prev,
      loopSnapMode: ls.snapMode,
      loopOverlapBeats: ls.overlapBeats,
      fadeCurve: ls.fadeCurve,
      crossfadeDuration: song.sessionPreset?.crossfadeDuration ?? prev.crossfadeDuration,
    }));
    overlapBeatsRef.current = ls.overlapBeats;
    fadeCurveRef.current = ls.fadeCurve;
  }, [song?.id]);

  const stopAllSources = useCallback((when?: number) => {
    for (const { source, gain } of activeSourcesRef.current) {
      try {
        if (when !== undefined) {
          source.stop(when);
        } else {
          source.stop();
        }
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        /* */
      }
    }
    activeSourcesRef.current = [];
  }, []);

  const createSource = useCallback(
    (offset: number, gainValue: number = 1): ActiveSource | null => {
      const ctx = audioContextRef.current;
      const buffer = audioBufferRef.current;
      const master = masterGainRef.current;
      if (!ctx || !buffer || !master) return null;

      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      gain.connect(master);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(0, Math.max(0, offset));

      const entry = { source, gain };
      activeSourcesRef.current.push(entry);
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== entry);
        try {
          gain.disconnect();
        } catch {
          /* */
        }
      };
      return entry;
    },
    []
  );

  const performLoopCrossfade = useCallback(() => {
    const ctx = audioContextRef.current;
    const buffer = audioBufferRef.current;
    const songNow = songRef.current;
    const loop = loopRef.current;
    if (!ctx || !buffer || !songNow || !loop.enabled) return;

    const beatDur = getBeatDurationSeconds(songNow.beats, songNow.bpm);
    const overlapBeats = overlapBeatsRef.current;
    const O = overlapBeats * beatDur;
    const curve = fadeCurveRef.current;
    const now = ctx.currentTime;

    // Handle queued region exit
    if (queuedRegionRef.current) {
      const queuedReg = songNow.regions.find(r => r.id === queuedRegionRef.current);
      if (queuedReg) {
        stopAllSources();
        pauseTimeRef.current = queuedReg.start;
        startTimeRef.current = now;
        createSource(queuedReg.start, 1);
        setPlaybackState(p => ({
          ...p,
          queuedRegion: null,
          currentRegion: queuedReg.id,
          currentTime: queuedReg.start,
          loop: { ...p.loop, enabled: false },
        }));
        loopRef.current = { ...loop, enabled: false };
        crossfadingRef.current = false;
        return;
      }
    }

    const nextIteration = loop.currentIteration + 1;
    if (loop.count !== -1 && nextIteration >= loop.count) {
      stopAllSources();
      isPlayingRef.current = false;
      pauseTimeRef.current = loop.end;
      setPlaybackState(p => ({
        ...p,
        isPlaying: false,
        currentTime: loop.end,
        loop: { ...p.loop, enabled: false, currentIteration: 0 },
      }));
      crossfadingRef.current = false;
      return;
    }

    if (O <= 0.001) {
      // Hard cut
      stopAllSources();
      pauseTimeRef.current = loop.start;
      startTimeRef.current = now;
      createSource(loop.start, 1);
      const updated = { ...loop, currentIteration: nextIteration };
      loopRef.current = updated;
      setPlaybackState(p => ({
        ...p,
        currentTime: loop.start,
        loop: updated,
      }));
      crossfadingRef.current = false;
      return;
    }

    // Fade out existing sources over O while they play past loop.end
    for (const { gain } of activeSourcesRef.current) {
      const current = gain.gain.value;
      scheduleFade(gain, current, 0, now, O, curve);
    }
    const oldSources = [...activeSourcesRef.current];
    for (const { source } of oldSources) {
      try {
        source.stop(now + O + 0.05);
      } catch {
        /* */
      }
    }

    // Incoming starts before loop.start by O beats
    const inOffset = Math.max(0, loop.start - O);
    const entry = createSource(inOffset, 0);
    if (entry) {
      scheduleFade(entry.gain, 0, 1, now, O, curve);
    }

    // Logical timeline: at start of crossfade we are at inOffset; after O we land at loop.start
    pauseTimeRef.current = inOffset;
    startTimeRef.current = now;

    const updated = { ...loop, currentIteration: nextIteration };
    loopRef.current = updated;
    setPlaybackState(p => ({
      ...p,
      currentTime: inOffset,
      loop: updated,
    }));

    // Allow next crossfade after this one completes
    window.setTimeout(() => {
      crossfadingRef.current = false;
    }, O * 1000 + 30);
  }, [createSource, stopAllSources]);

  const updateCurrentTime = useCallback(() => {
    if (!audioContextRef.current || !isPlayingRef.current) return;

    const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
    const currentTime = pauseTimeRef.current + elapsed;

    setPlaybackState(prev => ({ ...prev, currentTime }));

    const songNow = songRef.current;
    if (songNow) {
      const currentRegion = songNow.regions.find(
        r => currentTime >= r.start && currentTime <= r.end
      );
      if (currentRegion) {
        setPlaybackState(prev =>
          prev.currentRegion === currentRegion.id
            ? prev
            : { ...prev, currentRegion: currentRegion.id }
        );
      }

      if (metronomeRef.current && clickGainRef.current && audioContextRef.current) {
        const grid = songNow.beats;
        const crossed = grid.find(
          beat => beat.time > lastClickTimeRef.current && beat.time <= currentTime
        );
        if (crossed) {
          const ctx = audioContextRef.current;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = crossed.beat === 1 ? 1760 : 1174;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
          osc.connect(gain);
          gain.connect(clickGainRef.current);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.05);
          lastClickTimeRef.current = crossed.time;
        }
      }

      const entry = partEntryRef.current;
      if (entry && currentTime >= entry.at - 0.02) {
        partEntryRef.current = null;
        enterPartRef.current(entry.partId);
        return;
      }

      const loop = loopRef.current;
      if (loop.enabled && !crossfadingRef.current) {
        const beatDur = getBeatDurationSeconds(songNow.beats, songNow.bpm);
        const O = overlapBeatsRef.current * beatDur;
        // Trigger when we reach loop end (outgoing will continue past end during fade)
        if (currentTime >= loop.end) {
          crossfadingRef.current = true;
          performLoopCrossfade();
        } else if (O > 0 && currentTime >= loop.end - 0.02) {
          // slight early trigger to schedule audio precisely
          crossfadingRef.current = true;
          performLoopCrossfade();
        }
      }

      if (songNow.duration > 0 && currentTime >= songNow.duration && !loop.enabled) {
        isPlayingRef.current = false;
        pauseTimeRef.current = songNow.duration;
        stopAllSources();
        setPlaybackState(prev => ({
          ...prev,
          isPlaying: false,
          currentTime: songNow.duration,
        }));
        return;
      }
    }

  }, [performLoopCrossfade, stopAllSources]);

  useEffect(() => {
    if (!playbackState.isPlaying) return;
    const id = window.setInterval(() => updateCurrentTime(), 40);
    return () => window.clearInterval(id);
  }, [playbackState.isPlaying, updateCurrentTime]);

  useEffect(() => {
    if (!song) return;

    const loadAudio = async () => {
      try {
        await Tone.start();

        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }

        const arrayBuffer = await song.audioBlob.arrayBuffer();
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
        audioBufferRef.current = audioBuffer;

        if (masterGainRef.current) {
          masterGainRef.current.disconnect();
        }
        masterGainRef.current = audioContextRef.current.createGain();
        masterGainRef.current.gain.value = playbackState.volume;
        masterGainRef.current.connect(audioContextRef.current.destination);

        if (clickGainRef.current) {
          clickGainRef.current.disconnect();
        }
        clickGainRef.current = audioContextRef.current.createGain();
        clickGainRef.current.gain.value = playbackState.metronomeVolume;
        clickGainRef.current.connect(audioContextRef.current.destination);

        // Reset playhead when switching songs
        stopAllSources();
        isPlayingRef.current = false;
        pauseTimeRef.current = 0;
        partEntryRef.current = null;
        activePartRef.current = null;
        lastClickTimeRef.current = -1;
        const firstPart = song.phase?.kind === 'ready' ? song.phase.parts[0] : undefined;
        if (firstPart) {
          enterPartRef.current(firstPart.id);
        } else {
          setPlaybackState(prev => ({
            ...prev,
            isPlaying: false,
            currentTime: 0,
            activePartId: null,
            queuedPartId: null,
            loop: { ...prev.loop, enabled: false, currentIteration: 0 },
          }));
        }
      } catch (error) {
        console.error('Failed to load audio:', error);
      }
    };

    loadAudio();

    return () => {
      stopAllSources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  const play = useCallback(() => {
    if (!audioContextRef.current || !audioBufferRef.current || !masterGainRef.current) return;

    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    stopAllSources();
    crossfadingRef.current = false;

    const entry = createSource(pauseTimeRef.current, 1);
    if (!entry) return;

    startTimeRef.current = audioContextRef.current.currentTime;
    isPlayingRef.current = true;
    setPlaybackState(prev => ({ ...prev, isPlaying: true }));
  }, [createSource, stopAllSources]);

  const pause = useCallback(() => {
    if (audioContextRef.current && isPlayingRef.current) {
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      pauseTimeRef.current = pauseTimeRef.current + elapsed;
    }
    stopAllSources();
    isPlayingRef.current = false;
    crossfadingRef.current = false;
    setPlaybackState(prev => ({
      ...prev,
      isPlaying: false,
      currentTime: pauseTimeRef.current,
    }));
  }, [stopAllSources]);

  const togglePlayPause = useCallback(() => {
    if (isPlayingRef.current) {
      pause();
    } else {
      play();
    }
  }, [play, pause]);

  const seekTo = useCallback(
    (time: number) => {
      const wasPlaying = isPlayingRef.current;
      if (wasPlaying) {
        stopAllSources();
        isPlayingRef.current = false;
      }
      crossfadingRef.current = false;
      pauseTimeRef.current = Math.max(0, time);
      setPlaybackState(prev => ({
        ...prev,
        currentTime: pauseTimeRef.current,
        isPlaying: false,
      }));
      if (wasPlaying) {
        // Restart from new position
        setTimeout(() => play(), 20);
      }
    },
    [play, stopAllSources]
  );

  const setLoop = useCallback((start: number, end: number, count: number = -1) => {
    const next = {
      enabled: true,
      start,
      end,
      count,
      currentIteration: 0,
    };
    loopRef.current = next;
    setPlaybackState(prev => ({ ...prev, loop: next }));
  }, []);

  const clearLoop = useCallback(() => {
    setPlaybackState(prev => {
      const next = { ...prev.loop, enabled: false, currentIteration: 0 };
      loopRef.current = next;
      return { ...prev, loop: next };
    });
  }, []);

  const queueRegion = useCallback((regionId: string) => {
    queuedRegionRef.current = regionId;
    setPlaybackState(prev => ({ ...prev, queuedRegion: regionId }));
  }, []);

  const jumpToRegion = useCallback(
    (regionId: string, quantize: boolean = true) => {
      const songNow = songRef.current;
      if (!songNow) return;

      const region = songNow.regions.find(r => r.id === regionId);
      if (!region) return;

      if (quantize && songNow.beats.length > 0 && isPlayingRef.current) {
        const nextBar = findNextBarBoundary(pauseTimeRef.current +
          (audioContextRef.current
            ? audioContextRef.current.currentTime - startTimeRef.current
            : 0), songNow.beats);
        const delay = Math.max(0, nextBar - (pauseTimeRef.current +
          (audioContextRef.current
            ? audioContextRef.current.currentTime - startTimeRef.current
            : 0)));
        setTimeout(() => {
          seekTo(region.start);
          setPlaybackState(prev => ({ ...prev, currentRegion: regionId }));
        }, delay * 1000);
      } else {
        seekTo(region.start);
        setPlaybackState(prev => ({ ...prev, currentRegion: regionId }));
      }
    },
    [seekTo]
  );

  const setVolume = useCallback((volume: number) => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = volume;
    }
    setPlaybackState(prev => ({ ...prev, volume }));
  }, []);

  const toggleMetronome = useCallback(() => {
    setPlaybackState(prev => ({
      ...prev,
      metronomeEnabled: !prev.metronomeEnabled,
    }));
  }, []);

  const setMetronomeVolume = useCallback((volume: number) => {
    if (clickGainRef.current) {
      clickGainRef.current.gain.value = volume;
    }
    setPlaybackState(prev => ({ ...prev, metronomeVolume: volume }));
  }, []);

  const setLoopSnapMode = useCallback((mode: LoopSnapMode) => {
    setPlaybackState(prev => ({ ...prev, loopSnapMode: mode }));
  }, []);

  const setLoopOverlapBeats = useCallback((beats: LoopOverlapBeats) => {
    overlapBeatsRef.current = beats;
    setPlaybackState(prev => ({ ...prev, loopOverlapBeats: beats }));
  }, []);

  const setFadeCurve = useCallback((curve: FadeCurve) => {
    fadeCurveRef.current = curve;
    setPlaybackState(prev => ({ ...prev, fadeCurve: curve }));
  }, []);

  const setCrossfadeDuration = useCallback((ms: number) => {
    setPlaybackState(prev => ({ ...prev, crossfadeDuration: ms }));
  }, []);

  const readyMap = useCallback((songNow: Song | null) => {
    if (!songNow || songNow.phase?.kind !== 'ready') return null;
    return songNow.phase;
  }, []);

  const enterPart = useCallback(
    (partId: string) => {
      const songNow = songRef.current;
      const phase = readyMap(songNow);
      if (!songNow || !phase) return;
      const part = phase.parts.find(item => item.id === partId);
      if (!part) return;
      const perBar = beatsPerBar(songNow.timeSignature ?? '4/4');
      const window = partWindow(part, phase.downbeats, perBar);
      if (!window) return;
      const musicalEnd =
        part.endBar >= phase.downbeats.length
          ? Math.max(window.musicalEnd, songNow.duration)
          : window.musicalEnd;
      const nextLoop = {
        enabled: true,
        start: window.landing,
        end: musicalEnd,
        count: -1,
        currentIteration: 0,
      };
      loopRef.current = nextLoop;
      partEntryRef.current = null;
      activePartRef.current = partId;
      overlapBeatsRef.current = 0;
      setPlaybackState(prev => ({
        ...prev,
        loop: nextLoop,
        loopOverlapBeats: 0,
        activePartId: partId,
        queuedPartId: null,
        currentRegion: null,
      }));
      seekTo(Math.max(0, window.audioStart));
    },
    [readyMap, seekTo]
  );

  enterPartRef.current = enterPart;

  const armPart = useCallback(
    (partId: string) => {
      enterPart(partId);
    },
    [enterPart]
  );

  const queuePart = useCallback(
    (partId: string) => {
      const songNow = songRef.current;
      const phase = readyMap(songNow);
      if (!songNow || !phase) return;
      if (partEntryRef.current?.partId === partId) {
        partEntryRef.current = null;
        setPlaybackState(prev => ({ ...prev, queuedPartId: null }));
        return;
      }
      const currentId = activePartRef.current;
      const current = phase.parts.find(item => item.id === currentId) ?? phase.parts[0];
      const next = phase.parts.find(item => item.id === partId);
      if (!current || !next) return;
      const perBar = beatsPerBar(songNow.timeSignature ?? '4/4');
      const currentWindow = partWindow(current, phase.downbeats, perBar);
      const nextWindow = partWindow(next, phase.downbeats, perBar);
      if (!currentWindow || !nextWindow) return;
      const beatDur =
        perBar > 0 ? (currentWindow.musicalEnd - currentWindow.landing) / Math.max(1, (current.endBar - current.startBar) * perBar) : 0.5;
      const playhead =
        pauseTimeRef.current +
        (isPlayingRef.current && audioContextRef.current
          ? audioContextRef.current.currentTime - startTimeRef.current
          : 0);
      const plan = scheduleEntry(currentWindow, nextWindow, playhead, beatDur);
      partEntryRef.current = { at: plan.at, partId };
      setPlaybackState(prev => ({ ...prev, queuedPartId: partId }));
    },
    [readyMap]
  );

  const jumpPart = useCallback(
    (partId: string) => {
      partEntryRef.current = null;
      enterPart(partId);
    },
    [enterPart]
  );

  return {
    playbackState,
    play,
    pause,
    togglePlayPause,
    seekTo,
    setLoop,
    clearLoop,
    queueRegion,
    jumpToRegion,
    setVolume,
    toggleMetronome,
    setMetronomeVolume,
    setLoopSnapMode,
    setLoopOverlapBeats,
    setFadeCurve,
    setCrossfadeDuration,
    armPart,
    queuePart,
    jumpPart,
  };
}
