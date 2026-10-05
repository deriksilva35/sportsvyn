// lib/games/rank.test.mjs - THE TIE RULE (sun-16 C), and every pure board that
// now runs through it. Tied scores share the higher place (1, 1, 3); within a
// tie the earliest submission is listed first; no score is unranked and last.

import test from 'node:test';
import assert from 'node:assert/strict';
import { competitionRank, latestSubmitted } from './rank.js';
import { rankRows } from '../boards/view.js';
import { roundView, withLive } from '../boards/mlb.js';
import { seasonStandings, dayLeaderboard } from '../daily/standings.js';
import { computeStandings, chop, GUILLOTINE_TIE_AT_CUT } from '../leagues/standings.js';
import { roomPlaces } from '../draft/room.js';
import { leagueRanked } from './leaderboard.js';

const T = (min) => new Date(Date.UTC(2026, 9, 4, 12, min)).toISOString();
const ids = (rows) => rows.map((r) => r.userId);
const ranks = (rows) => rows.map((r) => r.rank);

test('1, 1, 3: a tie shares the HIGHER place and the next place skips', () => {
  const out = competitionRank([
    { userId: 1, score: 80, submittedAt: T(1) },
    { userId: 2, score: 90, submittedAt: T(2) },
    { userId: 3, score: 90, submittedAt: T(3) },
    { userId: 4, score: 70, submittedAt: T(4) },
  ]);
  assert.deepEqual(ranks(out), [1, 1, 3, 4]);
  assert.deepEqual(ids(out), [2, 3, 1, 4]);
});

test('within a tie the EARLIEST submission is listed first - not the user id', () => {
  const out = competitionRank([
    { userId: 1, score: 50, submittedAt: T(30) },
    { userId: 2, score: 50, submittedAt: T(10) },
    { userId: 3, score: 50, submittedAt: T(20) },
  ]);
  assert.deepEqual(ids(out), [2, 3, 1]);
  assert.deepEqual(ranks(out), [1, 1, 1]);
});

test('a tie with no submission instant sorts after the dated ones; the id only keeps the order total', () => {
  const out = competitionRank([
    { userId: 9, score: 50, submittedAt: null },
    { userId: 5, score: 50, submittedAt: null },
    { userId: 7, score: 50, submittedAt: T(5) },
  ]);
  assert.deepEqual(ids(out), [7, 5, 9]);
  assert.deepEqual(ranks(out), [1, 1, 1]);
});

test('no score (a DNF, a blank card) is unranked and last, whatever its clock', () => {
  const out = competitionRank([
    { userId: 1, score: null, submittedAt: T(0) },
    { userId: 2, score: 10, submittedAt: T(9) },
    { userId: 3, score: undefined },
    { userId: 4, score: 'x' },
    { userId: 5, score: 0, submittedAt: T(1) },
  ]);
  assert.deepEqual(ids(out), [2, 5, 1, 3, 4]);
  assert.deepEqual(ranks(out), [1, 2, null, null, null]);
});

test('rankedOf: a row below a floor keeps its place in the ORDER but wears no number, and takes no place', () => {
  const out = competitionRank([
    { userId: 1, score: 90, ok: true, submittedAt: T(1) },
    { userId: 2, score: 85, ok: false, submittedAt: T(1) },
    { userId: 3, score: 85, ok: true, submittedAt: T(2) },
    { userId: 4, score: 80, ok: true, submittedAt: T(1) },
  ], (r) => r.score, (r) => r.submittedAt, { rankedOf: (r) => r.ok });
  assert.deepEqual(ids(out), [1, 2, 3, 4]);
  assert.deepEqual(ranks(out), [1, null, 2, 3]);
});

test('a tuple score compares in order, and only an exact tie on every part shares a place', () => {
  const out = competitionRank([
    { userId: 1, s: [75, 3], submittedAt: T(1) },
    { userId: 2, s: [75, 30], submittedAt: T(2) },
    { userId: 3, s: [75, 30], submittedAt: T(0) },
  ], (r) => r.s);
  assert.deepEqual(ids(out), [3, 2, 1]);
  assert.deepEqual(ranks(out), [1, 1, 3]);
});

test('float dust is not a place: 0.1 + 0.2 ties 0.3', () => {
  const out = competitionRank([{ userId: 1, score: 0.1 + 0.2 }, { userId: 2, score: 0.3 }]);
  assert.deepEqual(ranks(out), [1, 1]);
});

test('submission instants: Date, ISO and epoch ms all read; latestSubmitted takes the latest', () => {
  const out = competitionRank([
    { userId: 1, score: 1, submittedAt: new Date(T(3)) },
    { userId: 2, score: 1, submittedAt: Date.parse(T(1)) },
    { userId: 3, score: 1, submittedAt: T(2) },
  ]);
  assert.deepEqual(ids(out), [2, 3, 1]);
  assert.equal(latestSubmitted([T(1), null, new Date(T(9)), 'nope']), T(9));
  assert.equal(latestSubmitted([]), null);
});

test('the input is not mutated', () => {
  const rows = [{ userId: 1, score: 1 }, { userId: 2, score: 2 }];
  competitionRank(rows);
  assert.deepEqual(rows, [{ userId: 1, score: 1 }, { userId: 2, score: 2 }]);
});

// ---------------------------------------------------------------------------
// THE BOARDS, THROUGH THEIR PURE HALVES
// ---------------------------------------------------------------------------

test('live boards (Weekly/Draft/Six/October/Run): rankRows is the rule', () => {
  const out = rankRows([
    { userId: 1, points: 40, submittedAt: T(9) },
    { userId: 2, points: 40, submittedAt: T(3) },
    { userId: 3, points: 55, submittedAt: T(5) },
  ]);
  assert.deepEqual(ids(out), [3, 2, 1]);
  assert.deepEqual(ranks(out), [1, 2, 2]);
});

test("Pick'em board, National and league alike: leagueRanked is the rule", () => {
  const out = leagueRanked([
    { userId: 1, score: 9, submittedAt: T(4) },
    { userId: 2, score: 9, submittedAt: T(2) },
    { userId: 3, score: 8, submittedAt: T(1) },
  ]);
  assert.deepEqual(ids(out), [2, 1, 3]);
  assert.deepEqual(ranks(out), [1, 1, 3]);
});

test('October/The Run live: settled total plus live points re-ranks under the rule', () => {
  const out = withLive([
    { userId: 1, handle: 'a', total: 10, submittedAt: T(5) },
    { userId: 2, handle: 'b', total: 12, submittedAt: T(1) },
  ], new Map([[1, { points: 2 }]]));
  assert.deepEqual(ids(out), [2, 1]);   // both 12: user 2 submitted first
  assert.deepEqual(ranks(out), [1, 1]);
});

test("The Run's per-round view orders a tie by THAT round's submission", () => {
  const out = roundView([
    { userId: 1, rounds: { wild_card: { kind: 'points', points: 30 } }, roundAt: { wild_card: T(8) }, submittedAt: T(0) },
    { userId: 2, rounds: { wild_card: { kind: 'points', points: 30 } }, roundAt: { wild_card: T(2) }, submittedAt: T(9) },
    { userId: 3, rounds: { wild_card: { kind: 'set' } }, roundAt: { wild_card: T(1) } },
  ], 'wild_card');
  assert.deepEqual(ids(out), [2, 1]);
  assert.deepEqual(ranks(out), [1, 1]);
});

test('Daily v1 day board: ties by lock-in, DNFs unranked at the foot', () => {
  const out = dayLeaderboard([
    { userId: 1, score: 70, lockedAt: T(9) },
    { userId: 2, score: 70, lockedAt: T(1) },
    { userId: 3, score: null, dnf: true, lockedAt: null },
    { userId: 4, score: 90, lockedAt: T(5) },
  ]);
  assert.deepEqual(ids(out), [4, 2, 1, 3]);
  assert.deepEqual(ranks(out), [1, 2, 2, null]);
});

test('Daily v1 season: points + pct + played stay the SCORE; only an exact tie on all three orders by submission, and the instant leaves the row', () => {
  const row = (userId, tier, score, lockedAt) => ({ userId, handle: `u${userId}`, tier, score, perfect: 100, lockedAt });
  const t = seasonStandings([
    row(1, 'MVP', 90, T(9)),
    row(2, 'MVP', 90, T(1)),
    row(3, 'MVP', 95, T(0)),   // same points, more pct: outranks, not tied
  ], 1);
  assert.deepEqual(ids(t), [3, 2, 1]);
  assert.deepEqual(ranks(t), [1, 2, 2]);
  for (const r of t) assert.equal('submittedAt' in r, false);
});

test("a league table lists a tied total by who got there first; places are unchanged (1-1-3)", () => {
  const members = [{ userId: 1, handle: 'aa' }, { userId: 2, handle: 'zz' }, { userId: 3, handle: 'mm' }];
  const results = [
    { userId: 1, game: 'daily', sport: 'all', period: 'd1', bucket: '2026-10-01', score: 50, submittedAt: T(9) },
    { userId: 2, game: 'daily', sport: 'all', period: 'd1', bucket: '2026-10-01', score: 50, submittedAt: T(2) },
    { userId: 3, game: 'daily', sport: 'all', period: 'd1', bucket: '2026-10-01', score: 40, submittedAt: T(1) },
  ];
  const { rows } = computeStandings({ members, results, scoring: 'total', bucketOrder: ['2026-10-01'] });
  assert.deepEqual(rows.map((r) => r.userId), [2, 1, 3]);   // was alphabetical: aa before zz
  assert.deepEqual(rows.map((r) => r.place), [1, 1, 3]);
});

test('a Draft room: the reader tied with a bot shares the HIGHER place, ties listed in seat order', () => {
  const r = roomPlaces([
    { seat: 1, score: 80, user: false },
    { seat: 2, score: 90, user: false },
    { seat: 3, score: 80, user: true },
    { seat: 4, score: 70, user: false },
  ], 4);
  assert.equal(r.rank, 2);                                  // was 3: position, not place
  assert.deepEqual(r.seats.map((s) => s.seat), [2, 1, 3, 4]);
  assert.equal('rank' in r.seats[0], false);
});

test('GUILLOTINE: a tie at the cut is FLAGGED, not changed - nobody goes by default', () => {
  assert.equal(GUILLOTINE_TIE_AT_CUT, 'survive');
  const members = [{ userId: 1 }, { userId: 2 }, { userId: 3 }];
  const byBucket = new Map([[1, { b1: 10 }], [2, { b1: 10 }], [3, { b1: 30 }]]);
  assert.deepEqual(chop({ members, finishedBuckets: ['b1'], byBucket }), []);
  // The alternative exists only behind the flag, unused: both tied go.
  const all = chop({ members, finishedBuckets: ['b1'], byBucket, tieAtCut: 'all' });
  assert.deepEqual(all.map((c) => c.userId).sort(), [1, 2]);
});
