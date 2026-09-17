// lib/draft/poolSnapshot.test.mjs - WHICH ADP SNAPSHOT A RANKED ROOM DRAFTS
// FROM, and the sentence a refusal shows.
//
// THE DEFECT THIS FIXES, DATED. FFC's ADP feed thins during the season - it is
// a preseason market. The ppr/12 pool measured 194 rows on 15 Sep 2026, 116 on
// the 16th and 78 on the 17th, while a 12-seat 8-round ranked room needs 96
// real picks. So on the 17th startCustomDraftFor refused EVERY new ranked room
// with 'pool_too_small', and the seat grid printed that token at the reader.
//
// THE NUMBERS BELOW ARE THAT MEASUREMENT, kept as a fixture rather than read
// from the database: the point of the test is the RULE, and a rule tested
// against live data stops testing anything the day the data moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseSnapshot } from './pool.js';

// The real ppr/12 shelf, newest first, as measured on 2026-09-17.
const PPR12 = [
  { snapshotDate: '2026-09-17', rows: 78 },
  { snapshotDate: '2026-09-16', rows: 116 },
  { snapshotDate: '2026-09-15', rows: 194 },
  { snapshotDate: '2026-09-14', rows: 194 },
  { snapshotDate: '2026-09-13', rows: 193 },
];
const DEMAND = 96;   // 12 seats x 8 rounds, no synthetic K/DST in DRAFT_CONFIG

// ---------------------------------------------------------------------------
// THE FALLBACK
// ---------------------------------------------------------------------------

test('THE NEWEST SNAPSHOT THAT CAN SEAT THE ROOM - 09-16, not 09-17', () => {
  const c = chooseSnapshot(PPR12, DEMAND);
  assert.equal(c.snapshotDate, '2026-09-16');
  assert.equal(c.rows, 116);
  // AND IT DOES NOT REACH PAST ONE THAT FITS. 09-15 is bigger (194 rows) and
  // older; freshness wins among snapshots that can seat the room, because the
  // freshest ADP is the most honest ADP.
  assert.notEqual(c.snapshotDate, '2026-09-15', 'a bigger, older pool is not a better one');
});

test("TODAY WINS WHENEVER TODAY CAN - the fallback is a floor, not a preference", () => {
  // Same shelf, a room small enough for today's 78 rows.
  assert.equal(chooseSnapshot(PPR12, 60).snapshotDate, '2026-09-17');
  // And the boundary is inclusive: exactly enough is enough.
  assert.equal(chooseSnapshot(PPR12, 78).snapshotDate, '2026-09-17');
  assert.equal(chooseSnapshot(PPR12, 79).snapshotDate, '2026-09-16', 'one short and it reaches back');
});

test('NO SNAPSHOT QUALIFIES -> null, and the caller refuses', () => {
  assert.equal(chooseSnapshot(PPR12, 500), null);
  assert.equal(chooseSnapshot([], DEMAND), null);
  assert.equal(chooseSnapshot(null, DEMAND), null);
  assert.equal(chooseSnapshot([{ snapshotDate: null, rows: 9999 }], DEMAND), null,
    'a row count with no date is not a snapshot');
});

test('a nonsense demand chooses nothing rather than everything', () => {
  for (const bad of [0, -1, NaN, null, undefined, 'x']) {
    assert.equal(chooseSnapshot(PPR12, bad), null, String(bad));
  }
});

test('Date objects sort the same as date strings - the driver returns Dates', () => {
  const asDates = PPR12.map((c) => ({ ...c, snapshotDate: new Date(`${c.snapshotDate}T00:00:00Z`) }));
  const c = chooseSnapshot(asDates, DEMAND);
  assert.equal(new Date(c.snapshotDate).toISOString().slice(0, 10), '2026-09-16');
  // and an unsorted shelf gives the same answer as a sorted one
  const shuffled = [asDates[2], asDates[0], asDates[4], asDates[1], asDates[3]];
  assert.equal(new Date(chooseSnapshot(shuffled, DEMAND).snapshotDate).toISOString().slice(0, 10), '2026-09-16');
});

// ---------------------------------------------------------------------------
// WHO GETS THE FALLBACK, AND WHO DOES NOT
// ---------------------------------------------------------------------------

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = (rel) => strip(readFileSync(new URL(rel, import.meta.url), 'utf8'));

test('RANKED ONLY: the ranked start passes the flag, the tracker start does not', () => {
  const d = src('../fantasy/drafts.js');
  assert.match(d, /async function resolveCustomPool\(cfg, \{ ranked = false \} = \{\}\)/);
  assert.match(d, /resolveCustomPool\(cfg, \{ ranked: opts\.ranked === true \}\)/,
    'startCustomDraftFor threads the flag it was always given');
  // The tracker/league path keeps the old call - one argument, no fallback.
  assert.match(d, /const r = await resolveCustomPool\(cfg\);/,
    'startTrackerDraftFor is untouched');
  // And the fallback is inside the ranked branch, not above it.
  const fn = d.slice(d.indexOf('async function resolveCustomPool'), d.indexOf('export async function startCustomDraftFor'));
  assert.ok(fn.indexOf('if (ranked) {') < fn.indexOf('chooseSnapshot('), 'gated on ranked');
  assert.match(fn, /getLatestPool\(/, 'and the unranked path still takes the latest snapshot');
});

test('THE REFUSAL SURVIVES: pool_too_small when nothing fits', () => {
  const fn = src('../fantasy/drafts.js');
  const body = fn.slice(fn.indexOf('async function resolveCustomPool'), fn.indexOf('export async function startCustomDraftFor'));
  assert.equal((body.match(/reason: 'pool_too_small'/g) ?? []).length, 3,
    'nothing fits, the re-check after the load, and the unranked path');
});

test('ONE QUERY FOR THE SHELF, not a pool load per snapshot', () => {
  const d = src('../fantasy/drafts.js');
  const fn = d.slice(d.indexOf('export async function snapshotSizes'), d.indexOf('export async function getLatestPool'));
  assert.match(fn, /GROUP BY snapshot_date/);
  assert.match(fn, /count\(\*\)::int AS rows/);
  assert.equal((fn.match(/await sql`/g) ?? []).length, 1, 'exactly one read');
});

test('THE CHOSEN DATE IS FROZEN ON THE DRAFT, in the column that already held it', () => {
  const d = src('../fantasy/drafts.js');
  // finalizeStart writes pool_snapshot_date from the resolved snapshot; the
  // fallback changes WHICH date, never where it is kept. No migration.
  assert.match(d, /pool_snapshot_date, pool_scoring_format, pool_teams_count, pool_source, started_at/);
  assert.match(d, /\$\{ymd\(snapshotDate\)\}/);
  // and the room is told which one it is
  assert.match(d, /snapshotDate: draft\.pool_snapshot_date \? ymd\(draft\.pool_snapshot_date\) : null/);
  assert.match(src('../../components/sim/DraftRoom.js'), /ADP snapshot \{poolMapping\.snapshotDate\}/);
});

// ---------------------------------------------------------------------------
// THE SEAT PICKER SHOWS A SENTENCE, NEVER A TOKEN
// ---------------------------------------------------------------------------

test('THE READER NEVER SEES A RAW REASON', () => {
  const seat = src('../../components/draft/SeatSelect.js');
  assert.match(seat, /setErr\(START_ERRORS\[j\.error\] \?\? START_ERRORS\.default\)/);
  assert.doesNotMatch(seat, /j\.error \?\? /, 'the old fallthrough printed the token');
  assert.doesNotMatch(seat, /setErr\(j\.error\)/);
});

test('pool_too_small says what it is and whether waiting helps', () => {
  const seat = readFileSync(new URL('../../components/draft/SeatSelect.js', import.meta.url), 'utf8');
  assert.match(seat, /pool_too_small: 'The draft pool is short this week - check back later\.'/);
  assert.doesNotMatch(strip(seat).replace(/pool_too_small:/g, ''), /pool_too_small/,
    'the token appears only as the map key');
});

test('EVERY REASON THE ROUTE EMITS HAS A LINE - a typo here would print nothing', () => {
  const route = readFileSync(new URL('../../app/api/draft/start/route.js', import.meta.url), 'utf8');
  const seat = readFileSync(new URL('../../components/draft/SeatSelect.js', import.meta.url), 'utf8');
  const map = seat.slice(seat.indexOf('const START_ERRORS = {'), seat.indexOf('};', seat.indexOf('const START_ERRORS = {')));
  // The literal strings the route hands back, e.g. { error: 'no board' }.
  const emitted = [...route.matchAll(/error:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 5, `expected the route's own reasons, found ${emitted.length}`);
  for (const e of emitted) {
    const key = /[^a-z_]/.test(e) ? `'${e}'` : e;
    assert.ok(map.includes(`${key}:`), `${e} has no sentence in START_ERRORS`);
  }
  // Plus the two that arrive from deeper: the pool refusals.
  for (const e of ['pool_too_small', 'no_pool']) {
    assert.ok(map.includes(`${e}:`), `${e} has no sentence`);
  }
  assert.ok(map.includes('default:'), 'and an unknown reason still says something');
});
