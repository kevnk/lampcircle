export function exportSessionPreset(song: any): string {
  const preset = {
    songName: song.name,
    songId: song.id,
    regions: song.regions,
    sessionPreset: song.sessionPreset,
    beats: song.beats,
    exportDate: new Date().toISOString()
  };
  
  return JSON.stringify(preset, null, 2);
}

export function importSessionPreset(jsonString: string): any {
  return JSON.parse(jsonString);
}

export function exportBeatGrid(beats: any[]): string {
  const csv = ['Time (s),Bar,Beat,Confidence'];
  
  for (const beat of beats) {
    csv.push(`${beat.time.toFixed(3)},${beat.bar},${beat.beat},${beat.confidence.toFixed(2)}`);
  }
  
  return csv.join('\n');
}

export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const REGION_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#d946ef',
  '#ec4899'
];

export function getNextRegionColor(existingRegions: any[]): string {
  const usedColors = new Set(existingRegions.map(r => r.color));
  
  for (const color of REGION_COLORS) {
    if (!usedColors.has(color)) {
      return color;
    }
  }
  
  return REGION_COLORS[existingRegions.length % REGION_COLORS.length];
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatBarBeat(bar: number, beat: number): string {
  return `${bar}.${beat}`;
}

export const LOOP_COLORS = [
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#ef4444',
  '#84cc16',
];

export function getNextLoopColor(existingLoops: { color?: string }[]): string {
  const used = new Set(existingLoops.map(l => l.color).filter(Boolean));
  for (const color of LOOP_COLORS) {
    if (!used.has(color)) return color;
  }
  return LOOP_COLORS[existingLoops.length % LOOP_COLORS.length];
}
