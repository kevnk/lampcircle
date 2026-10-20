import { scheduleEntry } from './performPlan';

function same(actual: unknown, expected: unknown, label: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}\nactual ${left}\nexpected ${right}`);
}

export function assertPerformPlan() {
  const current = {
    landing: 20,
    singerStart: 20,
    audioStart: 20,
    musicalEnd: 28,
    fadeOutStart: 28,
  };
  const next = {
    landing: 28,
    singerStart: 27.5,
    audioStart: 27,
    musicalEnd: 36,
    fadeOutStart: 36,
  };
  same(scheduleEntry(current, next, 22, 0.5), { at: 27, seekTo: 27 }, 'queue lands this pass');
  same(scheduleEntry(current, next, 26, 0.5), { at: 27, seekTo: 27 }, 'queue on the deadline');
  same(scheduleEntry(current, next, 27, 0.5), { at: 35, seekTo: 27 }, 'late queue waits a loop');
}
