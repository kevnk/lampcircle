import { useState } from 'react';
import { Song, SongLoop, LoopSnapMode } from '../types';
import { Plus, Trash2, Play, Edit2, Check, X } from 'lucide-react';
import { formatTime, getNextLoopColor } from '../lib/utils';
import { snapLoopPoint } from '../lib/beatDetection';

interface LoopManagerProps {
  song: Song;
  snapMode: LoopSnapMode;
  /** Current draft / active playback A–B (may be unnamed) */
  draftLoop: { start: number; end: number; enabled: boolean } | null;
  activeLoopId: string | null | undefined;
  onLoopsUpdate: (loops: SongLoop[], activeLoopId: string | null) => void;
  onActivateLoop: (loop: SongLoop) => void;
  onClearActive: () => void;
}

export function LoopManager({
  song,
  snapMode,
  draftLoop,
  activeLoopId,
  onLoopsUpdate,
  onActivateLoop,
  onClearActive,
}: LoopManagerProps) {
  const loops = song.loops ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');

  const handleSaveDraftAsLoop = () => {
    if (!draftLoop?.enabled && !(draftLoop && draftLoop.end > draftLoop.start)) {
      return;
    }
    const start = snapLoopPoint(draftLoop!.start, song.beats, snapMode);
    const end = snapLoopPoint(draftLoop!.end, song.beats, snapMode);
    if (end <= start) return;

    const name =
      newName.trim() ||
      `Loop ${loops.length + 1}`;
    const loop: SongLoop = {
      id: crypto.randomUUID(),
      name,
      start: Math.min(start, end),
      end: Math.max(start, end),
      color: getNextLoopColor(loops),
    };
    const next = [...loops, loop];
    onLoopsUpdate(next, loop.id);
    onActivateLoop(loop);
    setNewName('');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this loop?')) return;
    const next = loops.filter(l => l.id !== id);
    const nextActive = activeLoopId === id ? null : (activeLoopId ?? null);
    onLoopsUpdate(next, nextActive);
    if (activeLoopId === id) onClearActive();
  };

  const handleRename = (id: string) => {
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }
    const next = loops.map(l =>
      l.id === id ? { ...l, name: editName.trim() } : l
    );
    onLoopsUpdate(next, activeLoopId ?? null);
    setEditingId(null);
  };

  const canSaveDraft =
    !!draftLoop &&
    draftLoop.end > draftLoop.start &&
    (draftLoop.enabled || draftLoop.end - draftLoop.start > 0.05);

  return (
    <div className="loop-manager space-y-4">
      <div>
        <h3 className="text-white font-semibold mb-2">Named Loops</h3>
        <p className="text-gray-500 text-xs mb-3">
          Draft with [ ] then Save as loop. Activate a loop for playback (overlap
          + snap still apply).
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={
              canSaveDraft
                ? `Name for ${formatTime(draftLoop!.start)}–${formatTime(draftLoop!.end)}`
                : 'Set A–B first ([ ])'
            }
            disabled={!canSaveDraft}
            className="flex-1 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-sm disabled:opacity-50"
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveDraftAsLoop();
            }}
          />
          <button
            type="button"
            onClick={handleSaveDraftAsLoop}
            disabled={!canSaveDraft}
            className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Save as loop
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {loops.length === 0 && (
          <p className="text-gray-500 text-center py-6 text-sm">
            No saved loops yet. Mark A–B with [ ] and save.
          </p>
        )}

        {[...loops]
          .sort((a, b) => a.start - b.start)
          .map(loop => {
            const isActive = activeLoopId === loop.id;
            return (
              <div
                key={loop.id}
                className={`p-3 rounded-lg border ${
                  isActive
                    ? 'bg-emerald-950/40 border-emerald-600'
                    : 'bg-gray-800 border-gray-700'
                }`}
                style={{
                  borderLeftWidth: 4,
                  borderLeftColor: loop.color || '#10b981',
                }}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  {editingId === loop.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRename(loop.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 px-2 py-1 bg-gray-700 text-white rounded text-sm border border-gray-600"
                      />
                      <button
                        type="button"
                        onClick={() => handleRename(loop.id)}
                        className="p-1 text-emerald-400 hover:text-emerald-300"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1 text-gray-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-white font-medium text-sm">
                        {loop.name}
                        {isActive && (
                          <span className="ml-2 text-xs text-emerald-400">
                            Active
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Rename"
                          onClick={() => {
                            setEditingId(loop.id);
                            setEditName(loop.name);
                          }}
                          className="p-1 text-gray-400 hover:text-white"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => handleDelete(loop.id)}
                          className="p-1 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="text-xs text-gray-400 mb-2">
                  {formatTime(loop.start)} → {formatTime(loop.end)}
                  <span className="ml-2">
                    ({formatTime(loop.end - loop.start)})
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onLoopsUpdate(loops, loop.id);
                      onActivateLoop(loop);
                    }}
                    className={`px-2 py-1 text-xs rounded inline-flex items-center gap-1 ${
                      isActive
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-600 text-white hover:bg-gray-500'
                    }`}
                  >
                    <Play className="w-3 h-3" />
                    {isActive ? 'Active' : 'Activate'}
                  </button>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
