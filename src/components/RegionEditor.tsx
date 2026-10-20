import { useState } from 'react';
import { Song, Region, LoopSnapMode } from '../types';
import { Plus, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { snapLoopPoint } from '../lib/beatDetection';
import { detectRegionsFromBlob } from '../lib/regionDetection';
import { getNextRegionColor, formatTime } from '../lib/utils';

interface RegionEditorProps {
  song: Song;
  currentTime: number;
  snapMode: LoopSnapMode;
  onRegionsUpdate: (regions: Region[]) => void;
  onJumpToRegion: (regionId: string) => void;
  onQueueRegion: (regionId: string) => void;
  onLoopRegion?: (start: number, end: number) => void;
}

export function RegionEditor({
  song,
  currentTime,
  snapMode,
  onRegionsUpdate,
  onJumpToRegion,
  onQueueRegion,
  onLoopRegion,
}: RegionEditorProps) {
  const [newRegionName, setNewRegionName] = useState('');
  const [regionStart, setRegionStart] = useState<number>(0);
  const [redetecting, setRedetecting] = useState(false);

  const handleAddRegion = () => {
    if (!newRegionName.trim()) return;

    const snappedStart = snapLoopPoint(regionStart, song.beats, snapMode);
    const snappedEnd = snapLoopPoint(
      Math.min(regionStart + 10, song.duration),
      song.beats,
      snapMode
    );

    const newRegion: Region = {
      id: crypto.randomUUID(),
      name: newRegionName.trim(),
      start: snappedStart,
      end: snappedEnd,
      color: getNextRegionColor(song.regions),
    };

    onRegionsUpdate([...song.regions, newRegion]);
    setNewRegionName('');
    setRegionStart(0);
  };

  const handleDeleteRegion = (regionId: string) => {
    if (!confirm('Delete this region?')) return;
    onRegionsUpdate(song.regions.filter(r => r.id !== regionId));
  };

  const handleSetRegionStart = (regionId: string) => {
    const snappedTime = snapLoopPoint(currentTime, song.beats, snapMode);
    const updatedRegions = song.regions.map(r =>
      r.id === regionId ? { ...r, start: snappedTime } : r
    );
    onRegionsUpdate(updatedRegions);
  };

  const handleSetRegionEnd = (regionId: string) => {
    const snappedTime = snapLoopPoint(currentTime, song.beats, snapMode);
    const updatedRegions = song.regions.map(r =>
      r.id === regionId ? { ...r, end: snappedTime } : r
    );
    onRegionsUpdate(updatedRegions);
  };

  const handleRedetectRegions = async () => {
    if (song.regions.length > 0) {
      const ok = confirm(
        'Re-detect regions from energy/structure? This replaces your current regions. Continue?'
      );
      if (!ok) return;
    }

    setRedetecting(true);
    try {
      const regions = await detectRegionsFromBlob(song.audioBlob, song.beats);
      onRegionsUpdate(regions);
    } catch (err) {
      console.error('Region re-detect failed:', err);
      alert('Failed to re-detect regions. Try again.');
    } finally {
      setRedetecting(false);
    }
  };

  const sortedRegions = [...song.regions].sort((a, b) => a.start - b.start);

  return (
    <div className="region-editor">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-white font-semibold">Add New Region</h3>
        <button
          type="button"
          onClick={handleRedetectRegions}
          disabled={redetecting || song.beats.length === 0}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          title="Replace regions with energy/structure suggestions snapped to measures"
        >
          {redetecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Re-detect regions
        </button>
      </div>

      <div className="mb-6">
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={newRegionName}
            onChange={e => setNewRegionName(e.target.value)}
            placeholder="Region name (e.g., Verse 1, Chorus)"
            className="flex-1 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            onKeyPress={e => {
              if (e.key === 'Enter') handleAddRegion();
            }}
          />
          <button
            onClick={() => setRegionStart(currentTime)}
            className="px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm"
          >
            Use Current Time
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            value={regionStart.toFixed(2)}
            onChange={e => setRegionStart(parseFloat(e.target.value) || 0)}
            step="0.1"
            className="w-24 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handleAddRegion}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Region
          </button>
        </div>
      </div>

      <div className="regions-list space-y-2">
        <h3 className="text-white font-semibold mb-3">
          Regions ({song.regions.length})
        </h3>

        {sortedRegions.map((region, index) => (
          <div
            key={region.id}
            className="region-item p-3 bg-gray-800 rounded-lg"
            style={{ borderLeft: `4px solid ${region.color}` }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">{index + 1}</span>
                <span className="text-white font-medium">{region.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDeleteRegion(region.id)}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="text-sm text-gray-400 mb-2">
              {formatTime(region.start)} → {formatTime(region.end)}
              <span className="ml-2">
                ({formatTime(region.end - region.start)} duration)
              </span>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => onJumpToRegion(region.id)}
                className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
              >
                Jump (Q)
              </button>
              <button
                onClick={() => onQueueRegion(region.id)}
                className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
              >
                Queue
              </button>
              {onLoopRegion && (
                <button
                  onClick={() => {
                    const start = snapLoopPoint(region.start, song.beats, snapMode);
                    const end = snapLoopPoint(region.end, song.beats, snapMode);
                    onLoopRegion(Math.min(start, end), Math.max(start, end));
                  }}
                  className="px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700"
                >
                  Loop Region
                </button>
              )}
              <button
                onClick={() => handleSetRegionStart(region.id)}
                className="px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700"
              >
                Set Start Here
              </button>
              <button
                onClick={() => handleSetRegionEnd(region.id)}
                className="px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700"
              >
                Set End Here
              </button>
            </div>
          </div>
        ))}

        {song.regions.length === 0 && (
          <p className="text-gray-500 text-center py-8">
            No regions yet. Import auto-suggests them, or use Re-detect / Add
            above.
          </p>
        )}
      </div>
    </div>
  );
}
