#!/usr/bin/env node
// scripts/hex-census.mjs - print the colour-literal census, or (--write) record it as
// the ratchet baseline in lib/brand/hexBaseline.json. Rebrand R0 records it; each R2
// step that retires literals re-runs this with --write so the ceiling follows it down.
//   node scripts/hex-census.mjs            totals + the top 20 files
//   node scripts/hex-census.mjs --write    also rewrite the baseline
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hexCensus } from '../lib/brand/hexCensus.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = hexCensus(REPO);
console.log(`colour literals outside the tokens: ${c.total} in ${Object.keys(c.byFile).length} files`);
for (const [f, n] of Object.entries(c.byFile).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${f}`);
if (process.argv.includes('--write')) {
  writeFileSync(path.join(REPO, 'lib/brand/hexBaseline.json'), JSON.stringify(c, null, 1) + '\n');
  console.log('baseline written: lib/brand/hexBaseline.json');
}
