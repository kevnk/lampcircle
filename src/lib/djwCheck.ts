import { parseDjw, serializeDjw } from './djw';

function fail(assertion: string): never {
  throw new Error(assertion);
}

export function runDjwChecks(text: string): void {
  const parsed = parseDjw(text);
  if (parsed.title !== 'Way Maker') {
    fail(`title === 'Way Maker' but got ${JSON.stringify(parsed.title)}`);
  }
  if (parsed.downbeats[0] !== 3.2) {
    fail(`downbeats[0] === 3.2 but got ${String(parsed.downbeats[0])}`);
  }
  if (parsed.downbeats.length !== 6) {
    fail(`downbeats.length === 6 but got ${parsed.downbeats.length}`);
  }

  const intro = parsed.parts[0];
  const verse = parsed.parts[1];
  if (
    intro === undefined ||
    intro.name !== 'Intro' ||
    intro.pickupBeats !== 0 ||
    intro.startBar !== 1 ||
    intro.endBar !== 5
  ) {
    fail(
      `first part name Intro, pickup 0, startBar 1, endBar 5 but got ${JSON.stringify(intro)}`,
    );
  }
  if (verse === undefined || verse.name !== 'Verse 1' || verse.pickupBeats !== 1) {
    fail(`second part Verse 1, pickup 1 but got ${JSON.stringify(verse)}`);
  }

  const again = parseDjw(serializeDjw(parsed));
  if (again.title !== parsed.title) {
    fail(`round-trip title ${JSON.stringify(again.title)} !== ${JSON.stringify(parsed.title)}`);
  }
  if (JSON.stringify(again.downbeats) !== JSON.stringify(parsed.downbeats)) {
    fail(
      `round-trip downbeats ${JSON.stringify(again.downbeats)} !== ${JSON.stringify(parsed.downbeats)}`,
    );
  }
  if (again.parts.length !== parsed.parts.length) {
    fail(`round-trip part count ${again.parts.length} !== ${parsed.parts.length}`);
  }
  for (let i = 0; i < parsed.parts.length; i++) {
    const before = parsed.parts[i];
    const after = again.parts[i];
    if (
      before.name !== after.name ||
      before.startBar !== after.startBar ||
      before.endBar !== after.endBar ||
      before.pickupBeats !== after.pickupBeats ||
      before.fadeInBeats !== after.fadeInBeats ||
      before.fadeOutBeats !== after.fadeOutBeats ||
      before.loop !== after.loop
    ) {
      fail(
        `round-trip part ${before.name}: ${JSON.stringify(before)} !== ${JSON.stringify(after)}`,
      );
    }
  }
}
