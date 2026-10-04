// lib/pollers/playsCadence.test.mjs - plays-live polls by game state (sun-9 f).
// Pure: no database, no network, no clock but the one passed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYS_CADENCE, playsIntervalFor, dueByState, nextPlaysPoll } from './playsCadence.js';

const NOW = new Date('2026-10-03T20:00:00Z');
const ago = (sec) => new Date(NOW.getTime() - sec * 1000).toISOString();
const cfb = (id, extra = {}) => ({ id, league: 'cfb', on_board: false, plays_poll: null, ...extra });

test('the config, in one place, says what Derik signed off', () => {
  assert.deepEqual({ ...PLAYS_CADENCE }, {
    boardSec: 90, offBoardSec: 300, halftimeSec: 720, delayedSec: 300,
    endOfPeriodAsLive: true, finalExtraImports: 1, nflSec: 90,
  });
  assert.ok(Object.isFrozen(PLAYS_CADENCE));
});

test('interval by state', () => {
  assert.equal(playsIntervalFor(cfb(1, { on_board: true })), 90, 'board game: as before');
  assert.equal(playsIntervalFor(cfb(1)), 300, 'off-board: 5 min');
  assert.equal(playsIntervalFor(cfb(1, { plays_poll: { status: 'In Progress' } })), 300);
  assert.equal(playsIntervalFor(cfb(1, { on_board: true, plays_poll: { status: 'Halftime' } })), 720, 'halftime pauses even a board game');
  assert.equal(playsIntervalFor(cfb(1, { on_board: true, plays_poll: { status: 'End of Period' } })), 90, 'end of period is live');
  assert.equal(playsIntervalFor(cfb(1, { plays_poll: { status: 'End of Period' } })), 300);
  assert.equal(playsIntervalFor(cfb(1, { on_board: true, plays_poll: { status: 'Delayed' } })), 300);
  assert.equal(playsIntervalFor(cfb(1, { plays_poll: { status: 'Something New' } })), 300, 'an unknown word polls as live, never stops');
  assert.equal(playsIntervalFor({ id: 9, league: 'nfl', on_board: false }), 90, 'NFL is BDL, not CFBD quota: unchanged');
});

test('Final: one last import, then stop', () => {
  const first = nextPlaysPoll(null, 'Final', NOW);
  assert.equal(first.finals, 1);
  assert.equal(playsIntervalFor(cfb(1, { on_board: true, plays_poll: first })), 90, 'one more, at the game\'s own rate');
  const second = nextPlaysPoll(first, 'Final', NOW);
  assert.equal(second.finals, 2);
  assert.equal(playsIntervalFor(cfb(1, { on_board: true, plays_poll: second })), null, 'then never again');
  assert.equal(nextPlaysPoll(second, 'In Progress', NOW).finals, 0, 'a feed that un-finals starts over');
});

test('due: never polled is due; otherwise the later of plays.updated_at and plays_poll.at', () => {
  const games = [
    cfb(1, { on_board: true }),                                                     // never polled
    cfb(2, { on_board: true }),                                                     // board, 100 s ago
    cfb(3),                                                                         // off-board, 100 s ago
    cfb(4, { plays_poll: { status: 'In Progress', at: ago(400) } }),                // off-board, 400 s
    cfb(5, { on_board: true, plays_poll: { status: 'Halftime', at: ago(600) } }),   // halftime, 10 min
    cfb(6, { on_board: true, plays_poll: { status: 'Halftime', at: ago(730) } }),   // halftime, 12+ min
    cfb(7, { plays_poll: { status: 'Final', at: ago(9999), finals: 2 } }),          // done
    cfb(8, { plays_poll: { status: 'In Progress', at: ago(30) } }),                 // empty feed, polled 30 s ago
    { id: 9, league: 'nfl', on_board: false, plays_poll: null },                    // NFL, 100 s ago
  ];
  const last = new Map([[2, ago(100)], [3, ago(100)], [4, ago(500)], [8, ago(9999)], [9, ago(100)]]);
  const due = dueByState(games, last, NOW);
  assert.deepEqual(due.map((g) => g.id), [1, 2, 4, 6, 9]);
  assert.deepEqual(due.map((g) => g.interval_sec), [90, 90, 300, 720, 90], 'each due game carries its interval for the ledger');
});

test('the route uses it, and records what CFBD said after each CFB import', () => {
  const ROUTE = readFileSync(new URL('../../app/api/cron/plays-live/route.js', import.meta.url), 'utf8');
  assert.match(ROUTE, /const due = dueByState\(inScope, last, now\);/);
  assert.match(ROUTE, /if \(g\.league === 'cfb'\) \{\s*try \{ await recordPlaysPoll\(g, r\.providerStatus\); \}/);
  assert.match(ROUTE, /if \(g\.league === 'cfb'\) await recordPlaysPoll\(g, null\)\.catch\(\(\) => \{\}\);/,
    'a failed read is stamped too, or an empty feed is asked every minute');
  const SCOPE = readFileSync(new URL('./playsScope.js', import.meta.url), 'utf8');
  assert.match(SCOPE, /m\.metadata->'plays_poll' AS plays_poll/);
  assert.match(SCOPE, /AS on_board/);
  // The 14/15 Aug law: a top-level key holding an object, merged onto an object.
  assert.match(SCOPE, /CASE WHEN jsonb_typeof\(metadata\) = 'object' THEN metadata ELSE '\{\}'::jsonb END\s*\|\| jsonb_build_object\('plays_poll', /);
});
