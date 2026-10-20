import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const required = ['Dashboard', 'TapScreen', 'PrepScreen', 'PerformScreen'];
const missing = required.filter(name => !app.includes(`<${name}`));
if (missing.length > 0) {
  console.error(`missing screens: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('SURFACES_OK');
