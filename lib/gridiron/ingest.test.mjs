// lib/gridiron/ingest.test.mjs — node:test suite for the gridiron ingest utils.
// Run: node --test lib/gridiron/ingest.test.mjs
//
// The sportsdata DST-matrix cases exercise the REAL Postgres AT TIME ZONE path
// (easternLocalToUtc), so this loads .env.local and hits DATABASE_URL (DEV) with
// read-only SELECTs. Env is loaded BEFORE importing the module because lib/db.js
// binds neon(process.env.DATABASE_URL) at import time.

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
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { toUtc, mapStatus, skipRule, makeRunSummary } = await import('./ingest.js');

// ---------------------------------------------------------------------------
// toUtc — sportsdata DST matrix (real Postgres AT TIME ZONE)
// ---------------------------------------------------------------------------
const DST_MATRIX = [
  ['2025-09-04T20:20:00', '2025-09-05T00:20:00Z', 'Sept EDT (UTC-4)'],
  ['2025-12-14T13:00:00', '2025-12-14T18:00:00Z', 'Dec EST (UTC-5)'],
  ['2025-11-01T15:30:00', '2025-11-01T19:30:00Z', 'Nov 1 pre-transition EDT'],
  ['2025-11-02T13:00:00', '2025-11-02T18:00:00Z', 'Nov 2 post-transition EST'],
  ['2025-11-03T20:15:00', '2025-11-04T01:15:00Z', 'MNF post-transition EST'],
];
for (const [input, expected, label] of DST_MATRIX) {
  test(`toUtc sportsdata DST: ${label}`, async () => {
    assert.equal(await toUtc(input, null, 'sportsdata'), expected);
  });
}

test('toUtc sportsdata prefers DateTimeUTC fast-path when present', async () => {
  // ET string would resolve to 00:20Z; the UTC field must win verbatim.
  const out = await toUtc('2025-09-04T20:20:00', '2025-09-05T00:20:00', 'sportsdata');
  assert.equal(out, '2025-09-05T00:20:00.000Z');
});

test('toUtc sportsdata null string returns null (caller sources time elsewhere)', async () => {
  assert.equal(await toUtc(null, null, 'sportsdata'), null);
});

// ---------------------------------------------------------------------------
// toUtc — BDL / CFBD passthrough (already UTC 'Z')
// ---------------------------------------------------------------------------
test('toUtc bdl passthrough (already UTC Z)', async () => {
  assert.equal(await toUtc('2025-09-05T00:20:00.000Z', null, 'bdl'), '2025-09-05T00:20:00.000Z');
});
test('toUtc cfbd passthrough (already UTC Z)', async () => {
  assert.equal(await toUtc('2025-08-23T16:00:00.000Z', null, 'cfbd'), '2025-08-23T16:00:00.000Z');
});
test('toUtc bdl null returns null', async () => {
  assert.equal(await toUtc(null, null, 'bdl'), null);
});
test('toUtc throws on unrecognized provider', async () => {
  await assert.rejects(() => toUtc('2025-09-05T00:20:00Z', null, 'nflverse'), /unrecognized provider/);
});

// ---------------------------------------------------------------------------
// mapStatus
// ---------------------------------------------------------------------------
test('mapStatus bdl/nfl Final and Final/OT -> final', () => {
  assert.equal(mapStatus('bdl', 'nfl', 'Final'), 'final');
  assert.equal(mapStatus('bdl', 'nfl', 'Final/OT'), 'final');
});

test('mapStatus bdl/nfl kickoff-datetime status -> scheduled', () => {
  // BDL carries the kickoff time as the status of a not-yet-played game.
  assert.equal(mapStatus('bdl', 'nfl', '9/9 - 8:20 PM EDT'), 'scheduled');
  assert.equal(mapStatus('bdl', 'nfl', '9/13 - 1:00 PM EDT'), 'scheduled');
});

test('mapStatus bdl/nfl TBD (unassigned flex slot) -> scheduled', () => {
  // Weeks 16-18 flex games carry status "TBD" until the NFL assigns the slot.
  assert.equal(mapStatus('bdl', 'nfl', 'TBD'), 'scheduled');
  assert.equal(mapStatus('bdl', 'nfl', 'tbd'), 'scheduled'); // case-insensitive table lookup
});

test('mapStatus bdl/nfl unknown token stays fail-loud (-> null + unknownStatus)', () => {
  const rs = { unknownStatus: 0 };
  assert.equal(mapStatus('bdl', 'nfl', 'Halftime', rs), null); // in-game token, unconfirmed
  assert.equal(rs.unknownStatus, 1);
});
test('mapStatus bdl/mlb STATUS_* tokens', () => {
  assert.equal(mapStatus('bdl', 'mlb', 'STATUS_SCHEDULED'), 'scheduled');
  assert.equal(mapStatus('bdl', 'mlb', 'STATUS_FINAL'), 'final');
});
test('mapStatus cfbd/cfb derives from completed boolean + start time', () => {
  assert.equal(mapStatus('cfbd', 'cfb', { completed: true }), 'final');
  assert.equal(mapStatus('cfbd', 'cfb', { completed: false, startDate: '2099-01-01T00:00:00.000Z' }), 'scheduled');
  assert.equal(mapStatus('cfbd', 'cfb', { completed: false, startDate: '2020-01-01T00:00:00.000Z' }), 'live');
  assert.equal(mapStatus('cfbd', 'cfb', { completed: false, startTimeTBD: true }), 'scheduled');
});
test('mapStatus unknown token fails loud: returns null + counts', () => {
  const rs = makeRunSummary();
  assert.equal(mapStatus('bdl', 'nfl', 'Halftime', rs), null);
  assert.equal(rs.unknownStatus, 1);
  // unknown provider/sport table also counts and returns null
  assert.equal(mapStatus('bdl', 'nba', 'Final', rs), null);
  assert.equal(rs.unknownStatus, 2);
});

// ---------------------------------------------------------------------------
// skipRule
// ---------------------------------------------------------------------------
test('skipRule keeps REG/PRE/POST', () => {
  for (const p of ['REG', 'PRE', 'POST']) {
    assert.deepEqual(skipRule(p), { skip: false, phase: p });
  }
});
test('skipRule skips OFF/STAR loud + counted', () => {
  const rs = makeRunSummary();
  const off = skipRule('OFF', rs);
  assert.equal(off.skip, true);
  assert.match(off.reason, /OFF not stored/);
  skipRule('STAR', rs);
  skipRule('STAR', rs);
  assert.deepEqual(rs.skippedByPhase, { OFF: 1, STAR: 2 });
});

// ---------------------------------------------------------------------------
// run-summary factory
// ---------------------------------------------------------------------------
test('makeRunSummary shape', () => {
  assert.deepEqual(makeRunSummary(), {
    ingested: 0, skippedByPhase: {}, unknownStatus: 0, timeResolvedFromFallback: 0,
  });
});
