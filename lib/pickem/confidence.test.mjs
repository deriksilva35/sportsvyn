// lib/pickem/confidence.test.mjs - the confidence rules, pure. No database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIDENCE_START, isConfidence, stampsConfidence, defaultRanks, effectiveRanks,
  scoreConfidence, validateSheet, moveRank, pctOfMax, correctCount, pointsLine,
} from './confidence.js';
import { houseSheet } from '../house/pickPickem.js';
import { shapeResults } from '../leagues/results.js';

// four games, kickoff order g1 < g2 < g3 < g4
const board = [
  { match_id: 11, kickoff_at: '2031-12-13T17:00:00Z' },
  { match_id: 12, kickoff_at: '2031-12-13T20:30:00Z' },
  { match_id: 13, kickoff_at: '2031-12-14T00:00:00Z' },
  { match_id: 14, kickoff_at: '2031-12-14T17:00:00Z' },
];

test('the sheet pre-fills 1..N in kickoff order, latest kickoff = 1', () => {
  assert.deepEqual(defaultRanks(board), { 11: 4, 12: 3, 13: 2, 14: 1 });
  // same kickoff: the lower id takes the bigger number, so the sheet is stable
  const tie = [{ match_id: 2, kickoff_at: 'x' }, { match_id: 1, kickoff_at: 'x' }];
  assert.deepEqual(defaultRanks(tie), { 1: 2, 2: 1 });
});

test('a board is confidence only when it says so, and only from 20 Oct 2026', () => {
  assert.equal(isConfidence({ meta: { scoring: 'confidence' } }), true);
  assert.equal(isConfidence({ meta: {} }), false);
  assert.equal(isConfidence(null), false);
  // The 13 Oct NFL/CFB boards open BEFORE the start and stay regular; the 20 Oct boards are the first.
  assert.equal(stampsConfidence('nfl', '2026-10-13T13:00:00Z'), false);
  assert.equal(stampsConfidence('cfb', '2026-10-13T13:00:00Z'), false);
  assert.equal(stampsConfidence('nfl', '2026-10-20T13:00:00Z'), true);
  assert.equal(stampsConfidence('cfb', '2026-10-20T13:00:00Z'), true);
  assert.equal(stampsConfidence('nba', '2026-10-20T10:00:00Z'), true, 'the NBA opener opens at 06:00 ET on the 20th');
  assert.equal(stampsConfidence('nba', '2026-10-19T10:00:00Z'), false);
  assert.equal(stampsConfidence('mlb', '2026-11-01T10:00:00Z'), false, 'MLB is out');
  assert.equal(new Date(CONFIDENCE_START).toISOString(), '2026-10-20T04:00:00.000Z');
});

test('effectiveRanks completes a partial or damaged sheet into a permutation of 1..N', () => {
  assert.deepEqual(effectiveRanks(board, null), defaultRanks(board));
  const full = effectiveRanks(board, { 11: 1, 12: 2, 13: 3, 14: 4 });
  assert.deepEqual(full, { 11: 1, 12: 2, 13: 3, 14: 4 });
  // one game's rank missing: it gets the one number nobody holds back
  assert.deepEqual(effectiveRanks(board, { 11: 1, 12: 2, 14: 4 }), { 11: 1, 12: 2, 13: 3, 14: 4 });
  // a duplicate and an off-board id are dropped, never trusted
  const dup = effectiveRanks(board, { 11: 4, 12: 4, 99: 1 });
  assert.deepEqual(Object.values(dup).sort(), [1, 2, 3, 4]);
  assert.equal(dup[11], 4);
});

test('scoring: a right pick is its rank; max is the entry\'s own ranks over games with a winner', () => {
  const results = { 11: 'home', 12: 'away', 13: 'home', 14: 'away' };
  const r = scoreConfidence({ board, lineup: { 11: 'home', 12: 'home', 13: 'home', 14: 'away' }, ranks: { 11: 1, 12: 2, 13: 3, 14: 4 }, results });
  assert.deepEqual(r, { score: 1 + 3 + 4, max: 10, correct: 3, played: 4 });
});

test('VOID and TIE come off earned AND max', () => {
  const results = { 11: 'home', 12: null, 13: 'away', 14: 'home' };          // 12 void
  const r = scoreConfidence({ board, lineup: { 11: 'home', 12: 'home', 13: 'away', 14: 'away' }, ranks: { 11: 1, 12: 2, 13: 3, 14: 4 }, results });
  assert.equal(r.max, 1 + 3 + 4, 'rank 2 left the max');
  assert.equal(r.score, 1 + 3, 'the pick on the void game earned nothing');
  assert.equal(r.played, 3);
});

test('an UNPICKED game stays in max and scores 0; with no sheet saved the default sheet is the max', () => {
  const results = { 11: 'home', 12: 'home', 13: 'home', 14: 'home' };
  const r = scoreConfidence({ board, lineup: { 11: 'home' }, ranks: null, results });
  assert.equal(r.score, 4);
  assert.equal(r.max, 4 + 3 + 2 + 1);
});

test('a LATE pick is stripped: unpicked, earns 0, keeps its slot in max', () => {
  // the settle strips pick AND stored rank (lib/nba/dayPickem.js); the freed number comes back for max
  const results = { 11: 'home', 12: 'home', 13: 'home', 14: 'home' };
  const r = scoreConfidence({ board, lineup: { 11: 'home', 13: 'home', 14: 'home' }, ranks: { 11: 1, 13: 3, 14: 4 }, results });
  assert.equal(r.max, 10, 'the stripped game 12 takes back the number 2');
  assert.equal(r.score, 8);
});

test('validateSheet: a whole permutation, nothing else', () => {
  const ok = validateSheet({ board, incoming: { 11: 2, 12: 1, 13: 4, 14: 3 } });
  assert.equal(ok.ok, true);
  for (const bad of [
    { 11: 1, 12: 2, 13: 3 },                       // short
    { 11: 1, 12: 2, 13: 3, 14: 5 },                // out of range
    { 11: 1, 12: 1, 13: 3, 14: 4 },                // duplicate
    { 11: 1, 12: 2, 13: 3, 14: 4, 15: 5 },         // off board
    { 11: 1.5, 12: 2, 13: 3, 14: 4 },              // not an integer
    { 11: '1', 12: 2, 13: 3, 14: 4 },              // not a number
  ]) assert.equal(validateSheet({ board, incoming: bad }).reason, 'bad_ranks');
  assert.equal(validateSheet({ board, incoming: null }).reason, 'bad_ranks');
});

test('LOCK FREEZE: a locked game\'s rank cannot move, whatever the client sends', () => {
  const stored = { 11: 1, 12: 2, 13: 3, 14: 4 };
  const locked = new Set(['11']);
  const r = validateSheet({ board, stored, incoming: { 11: 2, 12: 1, 13: 3, 14: 4 }, locked });
  assert.deepEqual([r.ok, r.reason, r.matchId], [false, 'rank_locked', 11]);
  // the same swap of the UNLOCKED games is fine
  assert.equal(validateSheet({ board, stored, incoming: { 11: 1, 12: 4, 13: 3, 14: 2 }, locked }).ok, true);
});

test('a locked game with NO stored sheet is frozen at its pre-fill number', () => {
  const locked = new Set(['11']);                                  // default: 11 holds 4
  assert.equal(validateSheet({ board, stored: null, incoming: { 11: 1, 12: 4, 13: 3, 14: 2 }, locked }).reason, 'rank_locked');
  assert.equal(validateSheet({ board, stored: null, incoming: { 11: 4, 12: 1, 13: 2, 14: 3 }, locked }).ok, true);
});

test('SWAP ACROSS A LOCKED GAME moves the free numbers around it and never the locked one', () => {
  // sheet by number: 12=4, 11=3 (LOCKED), 14=2, 13=1
  const stored = { 12: 4, 11: 3, 14: 2, 13: 1 };
  const games = [
    { match_id: 12, kicked: false }, { match_id: 11, kicked: true },
    { match_id: 14, kicked: false }, { match_id: 13, kicked: false },
  ];
  // "down" on the top row steps over the locked row and swaps with the next open one
  const down = moveRank(stored, games, 12, -1);
  assert.deepEqual(down, { 12: 2, 11: 3, 14: 4, 13: 1 });
  assert.equal(down[11], 3, 'the locked game kept its number');
  // and the server accepts exactly that sheet
  assert.equal(validateSheet({ board, stored, incoming: down, locked: new Set(['11']) }).ok, true);
  // up from the row under the locked one goes back across it
  assert.deepEqual(moveRank(down, games, 12, +1), stored);
  // a locked row does not move, the ends of the sheet do not wrap
  assert.equal(moveRank(stored, games, 11, +1), stored);
  assert.equal(moveRank(stored, games, 12, +1), stored);
  assert.equal(moveRank(stored, games, 13, -1), stored);
});

test('percent of max, points line, correct count', () => {
  assert.equal(pctOfMax(76, 93), 76 / 93);
  assert.equal(pctOfMax(0, 0), null);
  assert.equal(pctOfMax(5, null), null);
  assert.equal(pointsLine(76, 93), '76 of 93');
  assert.equal(correctCount({ 1: 'home', 2: 'home', 3: 'away' }, { 1: 'home', 2: 'away', 3: null }), 1);
});

test('the house ranks by conviction, keeps locked numbers, and fills the rest in kickoff order', () => {
  const spreads = new Map([[11, -3], [12, 10.5], [13, null], [14, -1]]);
  const picks = [{ matchId: 11, side: 'home' }, { matchId: 12, side: 'away' }, { matchId: 13, side: 'home' }, { matchId: 14, side: 'home' }];
  const s = houseSheet({ board, picks, spreads });
  assert.deepEqual(Object.values(s.ranks).sort(), [1, 2, 3, 4], 'a permutation');
  assert.equal(s.ranks[12], 4, 'the biggest number is the surest pick (largest spread)');
  assert.equal(s.ranks[11], 3);
  assert.equal(s.ranks[14], 2);
  assert.equal(s.ranks[13], 1, 'an unpriced pick ranks below every priced one');
  // a locked game keeps what it holds; only open games are ranked and filed
  const late = houseSheet({ board, picks, spreads, locked: new Set(['11']), held: { 11: 4, 12: 3, 13: 2, 14: 1 } });
  assert.equal(late.ranks[11], 4);
  assert.equal(late.filed, 3);
  assert.equal(late.locked, 1);
  assert.equal(late.picks[11], undefined);
  assert.deepEqual(Object.values(late.ranks).sort(), [1, 2, 3, 4]);
});

test('REGULAR LEAGUES KEEP SCORING WINS: a confidence board contributes its correct picks, not its points', () => {
  const rows = [
    { game: 'pickem', sport: 'nfl', season_year: 2026, week: 7, pd: null, locks_at: '2026-10-25T17:00:00Z', settled: true, user_id: 1,
      score: 31, conf: true, pk_lineup: { 1: 'home', 2: 'home', 3: 'away' }, pk_results: { 1: 'home', 2: 'away', 3: 'away' }, submitted_at: null },
    // a regular board is read exactly as before
    { game: 'pickem', sport: 'nfl', season_year: 2026, week: 6, pd: null, locks_at: '2026-10-18T17:00:00Z', settled: true, user_id: 1,
      score: 9, conf: false, submitted_at: null },
    // not yet settled: no score
    { game: 'pickem', sport: 'nfl', season_year: 2026, week: 8, pd: null, locks_at: '2026-11-01T17:00:00Z', settled: false, user_id: 1,
      score: null, conf: true, pk_lineup: { 1: 'home' }, pk_results: null, submitted_at: null },
  ];
  const { results } = shapeResults({ contestRows: rows, unit: 'week' });
  assert.deepEqual(results.map((r) => r.score), [2, 9, null]);
});
