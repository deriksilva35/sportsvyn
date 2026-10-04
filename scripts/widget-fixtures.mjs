// scripts/widget-fixtures.mjs - write docs/widgets/fixtures/*.json from the
// real widget serializer (lib/widget/shape.js) over the stub inputs in
// lib/widget/fixtureInputs.js. No database, no env. Re-run after any change to
// the feed's shape; lib/widget/feed.test.mjs fails until you do.
//
//   node scripts/widget-fixtures.mjs          write
//   node scripts/widget-fixtures.mjs --check  exit 1 if any file would change

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureFeeds, fixturePicker } from '../lib/widget/fixtureInputs.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'widgets', 'fixtures');

export function fixtureFiles() {
  const out = {};
  for (const [name, payload] of Object.entries(fixtureFeeds())) out[`${name}.json`] = payload;
  out['teams.json'] = fixturePicker();
  return Object.fromEntries(Object.entries(out).map(([f, p]) => [f, `${JSON.stringify(p, null, 2)}\n`]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  mkdirSync(DIR, { recursive: true });
  let stale = 0;
  for (const [f, text] of Object.entries(fixtureFiles())) {
    const p = path.join(DIR, f);
    let cur = null; try { cur = readFileSync(p, 'utf8'); } catch { /* new */ }
    if (cur === text) continue;
    stale += 1;
    if (check) console.log(`stale: ${f}`);
    else { writeFileSync(p, text); console.log(`wrote ${f} (${Buffer.byteLength(text)} bytes pretty)`); }
  }
  if (check && stale) process.exit(1);
  if (!stale) console.log('fixtures up to date');
}
