import { registerTsHooks } from './registerTsHooks.ts';

registerTsHooks();

const { runSongMapChecks } = await import('../src/lib/songMapCheck.ts');
const { assertPerformPlan } = await import('../src/lib/performCheck.ts');

try {
  runSongMapChecks();
  assertPerformPlan();
  console.log('SONGMAP_OK');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
