// The FFC license string. This test exists because the string is a CONTRACT, not a
// label: the free commercial license is conditioned on those exact words appearing
// wherever the ADP data renders. If someone "tightens the copy", this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FFC_ATTRIBUTION } from './attribution.js';

test('the licensed string is exact', () => {
  assert.equal(FFC_ATTRIBUTION.text, 'ADP data courtesy of Fantasy Football Calculator');
  assert.equal(FFC_ATTRIBUTION.url, 'https://fantasyfootballcalculator.com/');
  assert.equal(FFC_ATTRIBUTION.host, 'fantasyfootballcalculator.com');
});

test('attribution.js pulls in NO dependencies (client-bundle safe)', async () => {
  // The whole reason this module is split out of ffc.js: 'use client' surfaces
  // (the sim setup screen) must be able to import the string without dragging the
  // Neon driver into the browser bundle. Assert the source has no import at all.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('./attribution.js', import.meta.url)), 'utf8');
  const importLines = src.split('\n').filter((l) => /^\s*(import|require)\b/.test(l));
  assert.deepEqual(importLines, []);
});

test('ffc.js re-exports the same object (one definition, not a copy)', async () => {
  // ffc.js imports lib/db.js, which needs DATABASE_URL to construct the client;
  // skip rather than fail when the env is absent (CI without .env.local).
  if (!process.env.DATABASE_URL) return;
  const ffc = await import('./ffc.js');
  assert.equal(ffc.FFC_ATTRIBUTION, FFC_ATTRIBUTION); // identity, not deep-equal
});

// ---------------------------------------------------------------------------
// Surface coverage. JSX can't be rendered here (no React test renderer in
// devDeps), so these scan sources. That is the right granularity anyway: the
// compliance failure this guards against is a surface that renders ADP data
// WITHOUT importing the constant — exactly how the league-page Fantasy Board
// shipped uncredited while the three sim surfaces were fine.
// ---------------------------------------------------------------------------

const { readFileSync: rf, readdirSync } = await import('node:fs');
const nodePath = await import('node:path');
const { fileURLToPath: f2u } = await import('node:url');
const REPO = nodePath.resolve(nodePath.dirname(f2u(import.meta.url)), '..', '..');

// Every surface that renders FFC ADP data. Adding an ADP surface means adding it
// here — the list is the audit, kept in the repo instead of in someone's memory.
const ADP_SURFACES = [
  'app/sim/page.js',                     // the lobby
  'app/sim/draft/[id]/page.js',          // draft room + results
  'app/sim/draft/[id]/card/route.js',    // the shareable results card
  'components/sim/StartForm.js',         // setup screen (sole credit on mobile)
  'components/gridiron/FantasyBoard.js', // league-page board (ADP movers)
];

test('every ADP surface single-sources the attribution constant', () => {
  for (const rel of ADP_SURFACES) {
    const s = rf(nodePath.join(REPO, rel), 'utf8');
    assert.match(s, /FFC_ATTRIBUTION/, `${rel} renders ADP data with no attribution`);
    assert.match(s, /from '@\/lib\/fantasy\/(attribution|ffc)'/, `${rel} does not import the constant`);
  }
});

test('client surfaces import attribution.js, never ffc.js (bundle safety)', () => {
  // ffc.js pulls in lib/db.js. A 'use client' file importing it would drag the
  // Neon driver into the browser bundle.
  for (const rel of ADP_SURFACES) {
    const s = rf(nodePath.join(REPO, rel), 'utf8');
    if (!/^'use client'/m.test(s)) continue;
    assert.ok(!/from '@\/lib\/fantasy\/ffc'/.test(s),
      `${rel} is a client component and must import @/lib/fantasy/attribution`);
  }
});

test('no source hardcodes the licensed phrase (it must come from the constant)', () => {
  const PHRASE = 'Fantasy Football Calculator';
  // attribution.js owns the string; ffc.js restates it in the license banner.
  const ALLOW = new Set(['lib/fantasy/attribution.js', 'lib/fantasy/ffc.js']);
  const offenders = [];
  const walk = (dir) => {
    for (const d of readdirSync(nodePath.join(REPO, dir), { withFileTypes: true })) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) { walk(rel); continue; }
      if (!/\.(js|mjs|jsx)$/.test(d.name)) continue;
      if (d.name.endsWith('.test.mjs')) continue; // tests assert on the literal
      if (ALLOW.has(rel)) continue;
      if (rf(nodePath.join(REPO, rel), 'utf8').includes(PHRASE)) offenders.push(rel);
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(root);
  assert.deepEqual(offenders, [],
    `hardcoded FFC phrase (will drift out of compliance): ${offenders.join(', ')}`);
});
