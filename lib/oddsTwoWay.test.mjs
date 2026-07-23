// lib/oddsTwoWay.test.mjs — 2-way (gridiron) consensus + de-vig math.
// Pure functions, no DB. Run: node --test lib/oddsTwoWay.test.mjs
//
// Deliberately isolated from the 3-way soccer math (devig/consensusOdds), which
// these must not touch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// odds.js imports lib/db.js, which requires DATABASE_URL at import. The math under
// test never queries; this only satisfies the import-time guard. Same pattern as
// ingest.test.mjs.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '.env.local'));

const { median, consensusOdds2Way, devig2Way, consensusPoint } = await import('./odds.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test('median: odd, even, empty, non-finite filtered', () => {
  assert.equal(median([1.9, 2.0, 2.1]), 2.0);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 2]), 2);           // NaN dropped
  assert.equal(median(undefined), null);
});

test('consensusOdds2Way: medians each side independently', () => {
  const books = [
    { a: 1.9, b: 2.0 },
    { a: 1.95, b: 1.95 },
    { a: 2.0, b: 1.9 },
  ];
  assert.deepEqual(consensusOdds2Way(books), { a: 1.95, b: 1.95 });
  assert.equal(consensusOdds2Way([]), null);
  assert.equal(consensusOdds2Way(null), null);
});

test('devig2Way: even 2.0/2.0 -> 50/50, 0 overround', () => {
  const d = devig2Way({ a: 2.0, b: 2.0 });
  near(d.a_pct, 50);
  near(d.b_pct, 50);
  near(d.overround_pct, 0);
});

test('devig2Way: -110/-110 (1.909 each) -> 50/50, ~4.76 overround', () => {
  const d = devig2Way({ a: 1.909, b: 1.909 });
  near(d.a_pct, 50, 1e-9);
  near(d.b_pct, 50, 1e-9);
  // 1/1.909 = 0.52383; sum = 1.04766; overround = 4.766%
  near(d.overround_pct, (2 / 1.909 - 1) * 100, 1e-9);
});

test('devig2Way: known favorite/dog fixture 1.5 / 2.6', () => {
  const d = devig2Way({ a: 1.5, b: 2.6 });
  const iA = 1 / 1.5, iB = 1 / 2.6, sum = iA + iB;
  near(d.a_pct, (iA / sum) * 100);
  near(d.b_pct, (iB / sum) * 100);
  near(d.overround_pct, (sum - 1) * 100);
  near(d.a_pct + d.b_pct, 100); // de-vigged pcts always sum to 100
});

test('devig2Way: invalid odds -> null', () => {
  assert.equal(devig2Way({ a: 0, b: 2.0 }), null);
  assert.equal(devig2Way({ a: 1.9, b: null }), null);
});

test('consensusPoint: median line for spreads/totals', () => {
  assert.equal(consensusPoint([-3.5, -3.0, -3.5]), -3.5);
  assert.equal(consensusPoint([47.5, 47.5, 48.0, 47.0]), 47.5);
  assert.equal(consensusPoint([]), null);
});
