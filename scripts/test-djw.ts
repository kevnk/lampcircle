import { readFileSync } from 'node:fs';
import { registerTsHooks } from './registerTsHooks.ts';

registerTsHooks();

const { runDjwChecks } = await import('../src/lib/djwCheck.ts');
const sample = readFileSync(new URL('../way-maker.sample.djw', import.meta.url), 'utf8');

try {
  runDjwChecks(sample);
  console.log('DJW_OK');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
