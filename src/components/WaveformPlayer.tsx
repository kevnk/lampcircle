import { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import { Song, Region, Beat } from '../types';

interface WaveformPlayerProps {
  song: Song;
  currentTime: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onRegionUpdate: (regions: Region[]) => void;
  loop?: { start: number; end: number; enabled: boolean };
}

export function WaveformPlayer({ 
  song, 
  currentTime, 
  isPlaying,
  onSeek, 
  onRegionUpdate,
  loop
}: WaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<any>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4b5563',
      progressColor: '#3b82f6',
      cursorColor: '#ef4444',
      barWidth: 2,
      barGap: 1,
      height: 150,
      normalize: true,
      backend: 'WebAudio'
    });

    const regions = RegionsPlugin.create();
    ws.registerPlugin(regions);
    regionsPluginRef.current = regions;

    ws.on('click', (relativeX) => {
      const duration = ws.getDuration();
      const clickTime = relativeX * duration;
      onSeek(clickTime);
    });

    regions.on('region-clicked', (region: any, e: MouseEvent) => {
      e.stopPropagation();
      setSelectedRegion(region.id);
    });

    regions.on('region-updated', (region: any) => {
      const updatedRegions = song.regions.map(r => 
        r.id === region.id 
          ? { ...r, start: region.start, end: region.end }
          : r
      );
      onRegionUpdate(updatedRegions);
    });

    song.audioBlob.arrayBuffer().then(buffer => {
      const blob = new Blob([buffer], { type: 'audio/wav' });
      ws.loadBlob(blob);
    });

    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
    };
  }, [song.id]);

  useEffect(() => {
    if (!wavesurferRef.current || !regionsPluginRef.current) return;

    regionsPluginRef.current.clearRegions();

    song.regions.forEach(region => {
      regionsPluginRef.current.addRegion({
        id: region.id,
        start: region.start,
        end: region.end,
        color: region.color + '40',
        drag: true,
        resize: true
      });
    });
  }, [song.regions]);

  useEffect(() => {
    if (!wavesurferRef.current) return;
    
    wavesurferRef.current.setTime(currentTime);
  }, [currentTime]);

  useEffect(() => {
    if (!wavesurferRef.current) return;

    const canvas = containerRef.current?.querySelector('canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawBeats = () => {
      if (!wavesurferRef.current) return;
      
      const duration = wavesurferRef.current.getDuration();
      const width = canvas.width;
      const height = canvas.height;

      song.beats.forEach(beat => {
        const x = (beat.time / duration) * width;
        
        ctx.strokeStyle = beat.beat === 1 ? '#ef444480' : '#6b728040';
        ctx.lineWidth = beat.beat === 1 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      });

      if (loop?.enabled) {
        const loopStartX = (loop.start / duration) * width;
        const loopEndX = (loop.end / duration) * width;
        
        ctx.fillStyle = '#10b98120';
        ctx.fillRect(loopStartX, 0, loopEndX - loopStartX, height);
        
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(loopStartX, 0);
        ctx.lineTo(loopStartX, height);
        ctx.moveTo(loopEndX, 0);
        ctx.lineTo(loopEndX, height);
        ctx.stroke();
      }
    };

    const redrawInterval = setInterval(drawBeats, 100);

    return () => clearInterval(redrawInterval);
  }, [song.beats, loop]);

  return (
    <div className="waveform-container">
      <div ref={containerRef} className="waveform" />
      
      {selectedRegion && (
        <div className="region-controls mt-4 p-4 bg-gray-800 rounded">
          <h3 className="text-white font-semibold mb-2">
            Region: {song.regions.find(r => r.id === selectedRegion)?.name}
          </h3>
          <button
            onClick={() => {
              const updatedRegions = song.regions.filter(r => r.id !== selectedRegion);
              onRegionUpdate(updatedRegions);
              setSelectedRegion(null);
            }}
            className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Delete Region
          </button>
          <button
            onClick={() => setSelectedRegion(null)}
            className="ml-2 px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
