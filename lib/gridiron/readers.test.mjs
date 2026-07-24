// lib/gridiron/readers.test.mjs — pickScoresDate branch logic (the /scores default
// day resolver). readers.js imports lib/db, so load .env.local before importing;
// pickScoresDate itself is pure and never queries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { pickScoresDate } = await import('./readers.js');

const TODAY = '2026-07-24';

test('today has games -> land on today (exact wins)', () => {
  assert.equal(pickScoresDate({ exact: '2026-07-24', fwd: '2026-08-29', back: '2026-01-01' }, TODAY), '2026-07-24');
});

test('today empty, games ahead -> nearest forward day', () => {
  assert.equal(pickScoresDate({ exact: null, fwd: '2026-08-29', back: '2026-01-01' }, TODAY), '2026-08-29');
});

test('today empty, none ahead -> most recent past day', () => {
  assert.equal(pickScoresDate({ exact: null, fwd: null, back: '2026-01-05' }, TODAY), '2026-01-05');
});

test('no schedule at all -> today', () => {
  assert.equal(pickScoresDate({ exact: null, fwd: null, back: null }, TODAY), TODAY);
  assert.equal(pickScoresDate({}, TODAY), TODAY);
});
