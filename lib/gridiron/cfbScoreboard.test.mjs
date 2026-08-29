// lib/gridiron/cfbScoreboard.test.mjs — the live-score guards.
//
// THE FIXTURES ARE REAL. Every payload below is a verbatim /scoreboard row
// captured on 29 Aug 2026 during UNC @ TCU, the game that produced this
// module. Nothing here is a hand-written approximation of what CFBD sends.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCOREBOARD_STATUS, toLiveState, scoreUpdateFor,
} from './cfbScoreboard.js';

// A verbatim in_progress row, 29 Aug 2026 16:24Z.
const LIVE_ROW = {
  id: 401856766,
  startDate: '2026-08-29T16:00:00.000Z',
  status: 'in_progress',
  period: 1,
  clock: '05:49',
  situation: '4th & 12 at UNC 23',
  possession: 'away',
  homeTeam: { id: 2628, name: 'TCU Horned Frogs', points: 3, lineScores: [3] },
  awayTeam: { id: 153, name: 'North Carolina Tar Heels', points: 3, lineScores: [3] },
};

// A verbatim scheduled row from the same response.
const SCHEDULED_ROW = {
  id: 401864494,
  status: 'scheduled',
  period: null,
  clock: null,
  possession: null,
  homeTeam: { id: 30, name: 'USC Trojans', points: null, lineScores: null },
  awayTeam: { id: 23, name: 'San José State Spartans', points: null, lineScores: null },
};

// ---------------------------------------------------------------------------
// THE VOCABULARY
// ---------------------------------------------------------------------------
test("the provider says in_progress and we say live - the map is the bridge", () => {
  // This is the whole reason the module exists as more than a fetch: a
  // consumer keying on 'live' against a raw payload sees nothing, silently.
  assert.equal(LIVE_ROW.status, 'in_progress');
  assert.equal(SCOREBOARD_STATUS.in_progress, 'live');
  assert.equal(SCOREBOARD_STATUS.scheduled, 'scheduled');
  assert.equal(SCOREBOARD_STATUS.completed, 'final');
});

test('an unrecognised status is COUNTED and skipped, never coerced', () => {
  const unknownStatuses = [];
  const out = scoreUpdateFor({ ...LIVE_ROW, status: 'suspended' }, 'live', { unknownStatuses });
  assert.equal(out, null, 'a status we do not understand writes nothing');
  assert.deepEqual(unknownStatuses, ['suspended']);
});

// ---------------------------------------------------------------------------
// SETTLED IS FINAL — the guard that matters most
// ---------------------------------------------------------------------------
test('a FINAL row in our table is never touched, whatever the scoreboard says', () => {
  // The scoreboard still calling it in_progress must not be able to reopen a
  // settled result, and a completed scoreboard row must not re-write one.
  assert.equal(scoreUpdateFor(LIVE_ROW, 'final'), null);
  assert.equal(scoreUpdateFor({ ...LIVE_ROW, status: 'completed' }, 'final'), null);
});

test('a live→final transition stops the writer dead', () => {
  // Same game, same payload, one field different in OUR table. Before: writes.
  // After: nothing. This is the synthetic the fix relay asked for.
  const before = scoreUpdateFor(LIVE_ROW, 'live');
  assert.deepEqual(before, {
    homeScore: 3, awayScore: 3, liveState: { short: 'Q1', clock: '05:49' },
  });
  const after = scoreUpdateFor(LIVE_ROW, 'final');
  assert.equal(after, null, 'once final, the completed-games path owns the score');
});

test('ABSENT STAYS ABSENT: a scheduled row writes no score', () => {
  assert.equal(scoreUpdateFor(SCHEDULED_ROW, 'scheduled'), null);
  // And even if our table wrongly said live, null points cannot become 0.
  assert.equal(scoreUpdateFor(SCHEDULED_ROW, 'live'), null,
    'null points must never be coerced to a 0-0 scoreline');
});

test('0-0 is a real score and is written; null is not', () => {
  const zero = scoreUpdateFor({
    ...LIVE_ROW, homeTeam: { points: 0 }, awayTeam: { points: 0 },
  }, 'live');
  assert.deepEqual(zero.homeScore, 0);
  assert.deepEqual(zero.awayScore, 0);
});

// ---------------------------------------------------------------------------
// THE live_state SHAPE — matched to its consumers, not invented
// ---------------------------------------------------------------------------
test('live_state is the { short, clock } shape liveChip and periodOf read', async () => {
  const { liveChip, periodOf } = await import('./lineScore.js');
  const ls = toLiveState('live', 1, '05:49');
  assert.deepEqual(ls, { short: 'Q1', clock: '05:49' });
  // The consumers are the contract. If these two stop agreeing, the chip
  // silently disappears - which is the D2 defect this fix exists to close.
  assert.equal(liveChip(ls), 'Q1 · 05:49');
  assert.equal(periodOf(ls), 1);
});

test('periods map Q1..Q4 then OT, and every one survives its consumers', async () => {
  const { periodOf } = await import('./lineScore.js');
  for (const [p, short] of [[1, 'Q1'], [2, 'Q2'], [3, 'Q3'], [4, 'Q4'], [5, 'OT'], [6, 'OT']]) {
    const ls = toLiveState('live', p, '12:00');
    assert.equal(ls.short, short, `period ${p}`);
    if (p <= 4) assert.equal(periodOf(ls), p);
  }
});

test('a stale clock never outlives its game - not live means null', () => {
  assert.equal(toLiveState('scheduled', 1, '05:49'), null);
  assert.equal(toLiveState('final', 4, '00:00'), null);
  assert.equal(toLiveState('live', null, '05:49'), null, 'no period, no state');
});

test('a missing clock still yields a usable chip', async () => {
  const { liveChip } = await import('./lineScore.js');
  const ls = toLiveState('live', 2, null);
  assert.deepEqual(ls, { short: 'Q2', clock: null });
  assert.equal(liveChip(ls), 'Q2', 'the period alone is honest; it is not a blank');
});

// ---------------------------------------------------------------------------
// THE WRITE ITSELF — read off the source, because a wholesale replace here
// would silently delete the drive envelopes the DriveStrip renders from.
// ---------------------------------------------------------------------------
test('the metadata write is a top-level MERGE, never a replace', () => {
  const src = readFileSync(new URL('./cfbScoreboard.js', import.meta.url), 'utf8');
  const write = src.slice(src.indexOf('UPDATE matches'));
  assert.match(write, /COALESCE\(metadata, '\{\}'::jsonb\)\s*\|\|\s*jsonb_build_object\('live_state'/,
    'live_state must merge at the top level so drives and line_scores survive');
  assert.doesNotMatch(write.slice(0, write.indexOf('WHERE')), /SET metadata = \$\{/,
    'a wholesale metadata assignment would wipe the drive envelopes');
});

test('the UPDATE re-asserts status = live in its own WHERE', () => {
  const src = readFileSync(new URL('./cfbScoreboard.js', import.meta.url), 'utf8');
  const write = src.slice(src.indexOf('UPDATE matches'), src.indexOf('summary.scoresWritten'));
  assert.match(write, /WHERE id = \$\{m\.id\} AND status = 'live'/,
    'the row must still be live at write time, not merely when we read it');
});

test('the scope query selects only our own live rows', () => {
  const src = readFileSync(new URL('./cfbScoreboard.js', import.meta.url), 'utf8');
  assert.match(src, /WHERE m\.league_id = \$\{leagueId\} AND m\.status = 'live'/,
    'blast radius is the games we already hold live, not whatever the payload lists');
});

test('no live game means no provider call at all', async () => {
  const src = readFileSync(new URL('./cfbScoreboard.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function syncCfbLiveScores'));
  assert.ok(fn.indexOf('if (!live.length) return summary;') < fn.indexOf('fetchScoreboard()'),
    'the early return must come before the fetch, or a quiet Tuesday still pays');
});
