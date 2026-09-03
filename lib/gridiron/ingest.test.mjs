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

// THE FULL CENSUS, not a sample. Every distinct game.status string BDL returned
// across an exhaustive sweep of /nfl/v1/games for every season 2002-2025 (6,502
// games, one API pass per season, paginated to exhaustion) - the same discipline
// this file's own header asks for ("Keyed per provider: the spike found the
// status vocabulary differs by product... Unknown token -> log.error"). Five
// distinct tokens exist in the whole span; this pins every one of them so the
// table can never silently fall one token behind the source again.
test('mapStatus bdl/nfl: EVERY token the full 2002-2025 census found maps, none by pattern', () => {
  const CENSUS = {
    Final: { pos: 'final', n: 6098 },
    'Final/OT': { pos: 'final', n: 399 },
    'Final/2OT': { pos: 'final', n: 2 },
    Postponed: { pos: 'postponed', n: 2 },
    Canceled: { pos: 'cancelled', n: 1 },   // BDL's own one-L spelling
  };
  let total = 0;
  for (const [token, { pos, n }] of Object.entries(CENSUS)) {
    assert.equal(mapStatus('bdl', 'nfl', token), pos, `census token "${token}" (${n} occurrences)`);
    total += n;
  }
  assert.equal(total, 6502, 'the census total must still be the full 24-season game count');
});

test('mapStatus bdl/nfl: Final/2OT is the two REAL games, not a pattern match on the word Final', () => {
  // 2003 NFC divisional, Panthers 29-Rams 23 (Jan 10 2004) and 2012 AFC
  // divisional, Ravens 38-Broncos 35 "Mile High Miracle" (Jan 12 2013) - the
  // game that first surfaced this gap as a dropped 2012 postseason game.
  assert.equal(mapStatus('bdl', 'nfl', 'Final/2OT'), 'final');
  // The guard this exists for: a THIRD overtime token the census never saw must
  // still fail loud rather than match because it starts with "Final".
  const rs = makeRunSummary();
  assert.equal(mapStatus('bdl', 'nfl', 'Final/3OT', rs), null,
    'an unseen token must never coerce through a "Final" prefix match');
  assert.equal(rs.unknownStatus, 1);
});

test('mapStatus bdl/nfl: Postponed and Canceled are terminal, not "eventually final"', () => {
  // Postponed (2014 Jets@Bills snowstorm, 2017 Bucs@Dolphins Hurricane Irma) both
  // describe the ORIGINAL slot, which never resolves to a score in BDL's record -
  // the game that was actually played carries its own game_id. Canceled (2022
  // Bills@Bengals after Damar Hamlin's collapse) was never played or resumed at
  // all. Neither maps to 'final', and the spelling difference is preserved
  // deliberately: BDL says "Canceled", our CHECK constraint says 'cancelled'.
  assert.equal(mapStatus('bdl', 'nfl', 'Postponed'), 'postponed');
  assert.equal(mapStatus('bdl', 'nfl', 'Canceled'), 'cancelled');
  assert.equal(mapStatus('bdl', 'nfl', 'canceled'), 'cancelled', 'case-insensitive table lookup');
});

test('mapStatus bdl/nfl: an invented token still fails loud - the census does not become a whitelist that guesses', () => {
  const rs = makeRunSummary();
  assert.equal(mapStatus('bdl', 'nfl', 'Final/4OT', rs), null);
  assert.equal(mapStatus('bdl', 'nfl', 'Suspended', rs), null);
  assert.equal(rs.unknownStatus, 2);
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
  // RE-RATIFIED for the unmapped-token ledger: the map rides beside the
  // count; everything else keeps its old meaning.
  assert.deepEqual(makeRunSummary(), {
    ingested: 0, skippedByPhase: {}, unknownStatus: 0, unmapped: {}, timeResolvedFromFallback: 0,
  });
});

// ---------------------------------------------------------------------------
// THE UNMAPPED TOKEN IS NAMED (Sat 22 Aug: unknownStatus=63 and no way to
// say which provider word it was - runtime logs gone by morning)
// ---------------------------------------------------------------------------

const { noteUnmapped, UNMAPPED_TOKEN_CAP, apiSportsPhaseAndWeek, quarterIndex } = await import('./ingest.js');

test('mapStatus lands the unmapped TOKEN in the summary, count shape unchanged', () => {
  const s = makeRunSummary();
  assert.equal(mapStatus('apisports', 'nfl', { short: 'Delayed', long: 'Delayed' }, s), null);
  assert.equal(mapStatus('apisports', 'nfl', { short: 'Delayed', long: 'Delayed' }, s), null);
  assert.equal(s.unknownStatus, 2, 'the count keeps its old meaning');
  assert.deepEqual(s.unmapped, { delayed: 2 }, 'the normalized token, ledger-ready');
});

test('the map caps at distinct tokens and overflows into a count', () => {
  const s = makeRunSummary();
  for (let i = 0; i < UNMAPPED_TOKEN_CAP + 3; i += 1) noteUnmapped(s, `junk-${i}`);
  assert.equal(Object.keys(s.unmapped).length, UNMAPPED_TOKEN_CAP);
  assert.equal(s.unmappedOverflow, 3);
  assert.equal(s.unknownStatus, UNMAPPED_TOKEN_CAP + 3, 'overflowed tokens still count');
  // a repeat of a KNOWN token still increments past the cap
  noteUnmapped(s, 'junk-0');
  assert.equal(s.unmapped['junk-0'], 2);
});

test('the counter is overloaded and the prefixes tell the vocabularies apart', () => {
  const s = makeRunSummary();
  apiSportsPhaseAndWeek('Mystery Stage', 'Week 1', s);
  quarterIndex('frobnicate', s);
  assert.deepEqual(Object.keys(s.unmapped).sort(), ['(quarter) frobnicate', '(stage) mystery stage']);
});

test('LEAK-SAFE: every noteUnmapped call site passes a vocabulary word, never data', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('./ingest.js', import.meta.url), 'utf8');
  const calls = [...t.matchAll(/noteUnmapped\(runSummary, ([^)]+)\)/g)]
    .map((m) => m[1]).filter((c) => c !== 'token'); // drop the definition itself
  assert.ok(calls.length >= 7, `all fail-loud sites route through it (${calls.length})`);
  for (const c of calls) {
    assert.ok(/^['"`]\(|^norm$|^`\(/.test(c.trim()),
      `${c} must be the normalized token or a labeled literal - never a payload field`);
  }
  assert.ok(!/noteUnmapped\([^)]*score/i.test(t), 'no score near the ledger');
});

test('tokens are clipped so a pathological feed cannot bloat a row', () => {
  const s = makeRunSummary();
  noteUnmapped(s, 'x'.repeat(500));
  assert.equal(Object.keys(s.unmapped)[0].length, 40);
});
