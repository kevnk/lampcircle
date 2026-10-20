import { assessTempo, lockDownbeats, partWindow, readyMapFromRegions } from './songMap';
import type { SongPart } from '../types';

function expectEqual(actual: unknown, expected: unknown, assertion: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${assertion}\nactual: ${actualJson}`);
  }
}

export function runSongMapChecks(): void {
  expectEqual(
    assessTempo([0, 2, 4, 6, 8, 10, 12, 14], 4),
    { kind: 'steady', bpm: 120, barSeconds: 2 },
    "assessTempo([0,2,4,6,8,10,12,14], 4) is { kind:'steady', bpm:120, barSeconds:2 }",
  );
  expectEqual(
    assessTempo([0, 2, 4, 6, 8, 10, 12], 4),
    { kind: 'keep-tapping', bars: 7 },
    "assessTempo([0,2,4,6,8,10,12], 4) is { kind:'keep-tapping', bars:7 }",
  );
  expectEqual(
    assessTempo([0, 2, 4.2, 6.1, 8.5, 10.4, 12.9, 15], 4),
    { kind: 'drifts', bpmMin: 96, bpmMax: 126.3, barSeconds: 2.149 },
    "assessTempo([0, 2, 4.2, 6.1, 8.5, 10.4, 12.9, 15], 4) is kind drifts, bpmMin 96, bpmMax 126.3",
  );
  expectEqual(
    lockDownbeats(1, 2, 10),
    [1, 3, 5, 7, 9],
    'lockDownbeats(1, 2, 10) equals [1,3,5,7,9]',
  );

  const part: SongPart = {
    id: 'verse',
    name: 'Verse',
    startBar: 2,
    endBar: 4,
    pickupBeats: 1,
    fadeInBeats: 1,
    fadeOutBeats: 2,
    loop: true,
    color: '#000000',
  };
  expectEqual(
    partWindow(part, [10, 12, 14, 16, 18], 4),
    { landing: 12, singerStart: 11.5, audioStart: 11, musicalEnd: 16, fadeOutStart: 15 },
    'part startBar 2 endBar 4 pickup 1 fadeIn 1 fadeOut 2 is landing 12, singerStart 11.5, audioStart 11, musicalEnd 16, fadeOutStart 15',
  );
  if (partWindow(part, [10, 12, 14], 4) !== null) {
    throw new Error("partWindow returns null when endBar's downbeat is missing");
  }

  const ready = readyMapFromRegions(
    [0, 2, 4, 6, 8].map(time => ({ time, beat: 1, confidence: 1, bar: 1 })),
    [
      { name: 'Intro', start: 0 },
      { name: 'Verse', start: 4 },
    ],
    10,
    120,
  );
  if (ready.kind !== 'ready') throw new Error('readyMapFromRegions builds a ready map');
  expectEqual(
    ready.parts.map(item => ({ name: item.name, startBar: item.startBar, endBar: item.endBar, pickupBeats: item.pickupBeats })),
    [
      { name: 'Intro', startBar: 1, endBar: 3, pickupBeats: 0 },
      { name: 'Verse', startBar: 3, endBar: 5, pickupBeats: 1 },
    ],
    'readyMapFromRegions places Intro on bars 1-3 and Verse on bars 3-5 with a one-beat pickup',
  );
}
