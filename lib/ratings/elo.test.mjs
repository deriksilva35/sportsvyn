// lib/ratings/elo.test.mjs - the ladder, checked against arithmetic done by
// hand rather than against itself.
//
// THE LADDER BELOW IS BUILT SO EVERY GAME IS HAND-COMPUTABLE. Each of the
// three games is played between two sides that are EXACTLY LEVEL when it
// kicks off, which collapses the whole formula to one closed form:
//
//   level sides, hfa = 0  ->  E_home = 0.5 exactly
//   level sides            ->  favouredDiff = 0, so mult = ln(|margin| + 1)
//   therefore delta        =  k * ln(margin + 1) * (1 - 0.5)  =  (k/2) * ln(margin+1)
//
// With k = 20 and every margin 7, that is 10 * ln(8) for every game, and the
// expected ratings are written below as multiples of that one number. Nothing
// here re-implements expectedHome, marginMultiplier or runElo to produce its
// own expectation - the arithmetic is the closed form, derived by hand, and
// Math.log is a primitive rather than the code under test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runElo, eloKey, marginMultiplier, expectedHome, deltaOverLast, lastResults,
  START_ELO, FCS_KEY,
} from './elo.js';

const D = 10 * Math.log(8);          // 20.794415416798357 - one game's swing, by hand
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

// A(1) beats B(2); C(3) beats D(4); then B beats D - and B and D are level
// when they meet, because each has taken exactly one -D.
const LADDER = [
  { id: 1, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 },
  { id: 2, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T20:00:00Z', homeId: 3, awayId: 4, homeScore: 21, awayScore: 14 },
  { id: 3, season: 2026, phase: 'REG', kickoffAt: '2026-09-13T17:00:00Z', homeId: 2, awayId: 4, homeScore: 21, awayScore: 14 },
];
const run = (games, opts = {}) => runElo({ games, k: 20, hfa: 0, regress: 0, ...opts });

test('A KNOWN THREE-GAME LADDER, to the number', () => {
  const t = run(LADDER);
  // Game 1: A and B level at 1500, A wins by 7 at home with no home edge.
  //   delta = (20/2) * ln(8) = 10 ln 8
  // (the map holds FINAL ratings, so B's intermediate 1500-D is checked in the
  // history test below rather than here, where it no longer stands)
  near(t.get(1).elo, START_ELO + D);
  // Game 2: identical shape, identical swing.
  near(t.get(3).elo, START_ELO + D);
  // Game 3: B (1500 - D) hosts D (1500 - D). LEVEL AGAIN, so the same closed
  // form applies a second time: B returns to exactly 1500, D falls to 1500-2D.
  near(t.get(2).elo, START_ELO);
  near(t.get(4).elo, START_ELO - 2 * D);
  // ZERO SUM. Nothing is created or destroyed by a game, so the four ratings
  // must still total four starting ratings.
  const total = [...t.values()].reduce((a, r) => a + r.elo, 0);
  near(total, 4 * START_ELO, 1e-9);
  // And the order the ladder produces is the order the results imply.
  const order = [...t.entries()].sort((a, b) => b[1].elo - a[1].elo).map(([id]) => id);
  assert.deepEqual(order, [1, 3, 2, 4]);
});

test('the history is the working: every game, both sides, before and after', () => {
  const t = run(LADDER);
  const b = t.get(2).history;
  assert.equal(b.length, 2, 'B played twice');
  assert.deepEqual(b.map((h) => [h.gameId, h.result, h.home, h.margin]), [[1, 'L', false, 7], [3, 'W', true, 7]]);
  near(b[0].eloBefore, START_ELO); near(b[0].eloAfter, START_ELO - D);
  near(b[1].eloBefore, START_ELO - D); near(b[1].eloAfter, START_ELO);
  // eloAfter of one game IS eloBefore of the next - the chain has no gap.
  near(b[0].eloAfter, b[1].eloBefore);
  // deltaOverLast reads the chain end-to-end, not a sum of rounded parts.
  near(deltaOverLast(b, 3), 0, 1e-9);
  near(deltaOverLast(t.get(4).history, 3), -2 * D);
  assert.equal(deltaOverLast([], 3), null, 'no games is null, not zero');
  assert.deepEqual(lastResults(b, 3), [
    { opp: 1, result: 'L', margin: 7 }, { opp: 4, result: 'W', margin: 7 },
  ]);
});

test('the pieces, on their own: expectation, multiplier, tie', () => {
  // Level sides with no home edge is a coin flip, exactly.
  assert.equal(expectedHome(1500, 1500, 0), 0.5);
  // A 400-point edge is the definition of 10:1 odds in Elo.
  near(expectedHome(1900, 1500, 0), 10 / 11);
  // Home advantage is added to the HOME rating and nothing else.
  assert.equal(expectedHome(1500, 1500, 55), expectedHome(1555, 1500, 0));
  // Level sides: the damping term is 2.2/2.2, so the multiplier is bare ln.
  near(marginMultiplier(7, 0), Math.log(8));
  near(marginMultiplier(1, 0), Math.log(2));
  // A FAVOURITE'S blowout is damped; an UPSET blowout is amplified. Same margin.
  assert.ok(marginMultiplier(28, 400) < marginMultiplier(28, 0));
  assert.ok(marginMultiplier(28, -400) > marginMultiplier(28, 0));
  // A TIE IS NOT A NO-OP. |margin| is taken as 1 and favouredDiff as 0, so the
  // multiplier is ln(2) - a bare ln(0+1) would be zero and a tie between
  // mismatched sides would move nothing at all.
  near(marginMultiplier(0, 0), Math.log(2));
  near(marginMultiplier(0, 400), Math.log(2), 1e-12);
  const tied = run([{ id: 9, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 17, awayScore: 17 }]);
  near(tied.get(1).elo, START_ELO, 1e-12);
  const lopsided = run([{ id: 9, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 17, awayScore: 17 }],
    { hfa: 55 });
  assert.ok(lopsided.get(1).elo < START_ELO, 'the home side was favoured and only drew, so it loses rating');
  assert.equal(lopsided.get(1).history[0].result, 'T');
});

test('REGRESSION FIRES AT THE SEASON BOUNDARY, and eloBefore proves it', () => {
  const games = [
    { id: 1, season: 2025, phase: 'REG', kickoffAt: '2025-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 },
    { id: 2, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 },
  ];
  const t = run(games, { regress: 0.5 });
  // After 2025 A is 1500 + D. Halfway back to 1500 is 1500 + D/2, and that is
  // the rating the 2026 game was PLAYED AT - which the history records.
  const a = t.get(1).history;
  near(a[0].eloAfter, START_ELO + D);
  near(a[1].eloBefore, START_ELO + D / 2);
  near(t.get(2).history[1].eloBefore, START_ELO - D / 2);
  // regress: 0 carries the season forward untouched.
  const carried = run(games, { regress: 0 });
  near(carried.get(1).history[1].eloBefore, START_ELO + D);
  // regress: 1 is a blank slate, and then the 2026 game is the level case again.
  const wiped = run(games, { regress: 1 });
  near(wiped.get(1).history[1].eloBefore, START_ELO);
  near(wiped.get(1).elo, START_ELO + D);
  // IT REGRESSES EVERY SEATED RATING, not only the sides playing that day. C
  // never plays in 2026 and must still be pulled back.
  const withIdle = run([
    ...games,
    { id: 3, season: 2025, phase: 'REG', kickoffAt: '2025-09-07T17:00:00Z', homeId: 3, awayId: 4, homeScore: 21, awayScore: 14 },
  ], { regress: 0.5 });
  near(withIdle.get(3).elo, START_ELO + D / 2, 1e-9);
});

test('FCS POOLS INTO ONE RATING, and the pool carries every pool game', () => {
  const games = [
    { id: 1, season: 2026, phase: 'REG', kickoffAt: '2026-08-29T17:00:00Z', homeId: 10, awayId: 901, homeScore: 45, awayScore: 3, homeClass: 'fbs', awayClass: 'fcs' },
    { id: 2, season: 2026, phase: 'REG', kickoffAt: '2026-08-29T20:00:00Z', homeId: 11, awayId: 902, homeScore: 38, awayScore: 7, homeClass: 'fbs', awayClass: 'fcs' },
    { id: 3, season: 2026, phase: 'REG', kickoffAt: '2026-09-05T17:00:00Z', homeId: 10, awayId: 11, homeScore: 21, awayScore: 14, homeClass: 'fbs', awayClass: 'fbs' },
  ];
  const t = run(games);
  // ONE SEAT for both FCS visitors, and no seat of their own for either.
  assert.ok(t.has(FCS_KEY));
  assert.equal(t.has(901), false); assert.equal(t.has(902), false);
  assert.deepEqual([...t.keys()].sort(), [10, 11, FCS_KEY]);
  assert.equal(t.get(FCS_KEY).games, 2, 'the pool played both games');
  assert.deepEqual(t.get(FCS_KEY).history.map((h) => h.opp), [10, 11]);
  // The pool loses both and lands well below the start; its opponents rise.
  assert.ok(t.get(FCS_KEY).elo < START_ELO - 20);
  assert.ok(t.get(10).elo > START_ELO);
  // FBS-vs-FBS and FBS-vs-FCS ARE BOTH RATED - game 3 is in both sides' history.
  assert.ok(t.get(10).history.some((h) => h.gameId === 3));
  assert.ok(t.get(11).history.some((h) => h.gameId === 3));
  // eloKey is the rule, and it does not care about case or id type.
  assert.equal(eloKey(901, 'fcs'), FCS_KEY);
  assert.equal(eloKey(901, 'FCS'), FCS_KEY);
  assert.equal(eloKey(901, 'fbs'), 901);
  assert.equal(eloKey('901', null), 901, 'a string id is the same ladder as a numeric one');
  assert.equal(eloKey(null, 'fbs'), null);
  // A POOL-VS-POOL GAME IS NOT A GAME. Two FCS sides would be one key playing
  // itself; it is dropped rather than rated against its own rating.
  const selfy = run([{ id: 4, season: 2026, phase: 'REG', kickoffAt: '2026-08-29T17:00:00Z', homeId: 901, awayId: 902, homeScore: 21, awayScore: 14, homeClass: 'fcs', awayClass: 'fcs' }]);
  assert.equal(selfy.size, 0);
});

test('PRE IS EXCLUDED BY PHASE, not by date, and moves nothing', () => {
  const pre = { id: 1, season: 2026, phase: 'PRE', kickoffAt: '2026-08-08T17:00:00Z', homeId: 1, awayId: 2, homeScore: 42, awayScore: 0 };
  const reg = { id: 2, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 };
  const withPre = run([pre, reg]);
  const without = run([reg]);
  // Byte-identical outcome: the 42-0 August result is not in the ladder at all.
  assert.equal(withPre.get(1).elo, without.get(1).elo);
  assert.equal(withPre.get(1).history.length, 1);
  assert.equal(withPre.get(1).history[0].gameId, 2);
  // A PRE-only input produces an empty table rather than seated 1500s.
  assert.equal(run([pre]).size, 0);
  // POST is NOT excluded - a playoff game rates like any other.
  const post = run([{ ...reg, id: 3, phase: 'POST', kickoffAt: '2027-01-10T17:00:00Z' }]);
  assert.equal(post.get(1).history.length, 1);
});

test('DETERMINISM: the same games in any order give the identical ladder', () => {
  const shuffled = [LADDER[2], LADDER[0], LADDER[1]];
  const alsoShuffled = [LADDER[1], LADDER[2], LADDER[0]];
  const a = run(LADDER); const b = run(shuffled); const c = run(alsoShuffled);
  const snap = (t) => [...t.entries()].sort((x, y) => Number(x[0]) - Number(y[0]))
    .map(([id, r]) => [id, r.elo, r.games, r.history.map((h) => h.gameId)]);
  assert.deepEqual(snap(b), snap(a));
  assert.deepEqual(snap(c), snap(a));
  // A SHARED KICKOFF INSTANT still has one order, because id is the tiebreak.
  const sameInstant = [
    { id: 7, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 },
    { id: 5, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 2, awayId: 3, homeScore: 21, awayScore: 14 },
  ];
  const s1 = run(sameInstant); const s2 = run([sameInstant[1], sameInstant[0]]);
  assert.deepEqual(s1.get(2).history.map((h) => h.gameId), [5, 7], 'id order, always');
  assert.deepEqual(snap(s2), snap(s1));
  // Re-running the same input twice is identical too - nothing mutates input.
  assert.deepEqual(snap(run(LADDER)), snap(a));
  assert.deepEqual(LADDER.map((g) => g.id), [1, 2, 3], 'the caller\'s array is untouched');
});

test('A ROW THAT CANNOT BE RATED IS SKIPPED, never guessed', () => {
  const t = run([
    { id: 1, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: null, awayScore: 14 },
    { id: 2, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: null, homeScore: 21, awayScore: 14 },
    { id: 3, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 1, homeScore: 21, awayScore: 14 },
  ]);
  assert.equal(t.size, 0);
  assert.equal(runElo().size, 0, 'no argument at all is an empty ladder, not a throw');
  assert.equal(runElo({ games: null }).size, 0);
});

test('THE PRESEASON PRIOR: mean of the regressed rating and the anchor', () => {
  // 2025: A beats B, so A is 1500+D and B is 1500-D.
  // 2026 boundary with regress 0.5: carried A = 1500 + D/2, carried B = 1500 - D/2.
  // A's anchor is 1600, B has none.
  //   A -> (1500 + D/2 + 1600) / 2
  //   B -> 1500 - D/2, untouched
  const games = [
    { id: 1, season: 2025, phase: 'REG', kickoffAt: '2025-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 },
    { id: 2, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 },
  ];
  const anchors = new Map([[2026, new Map([[1, 1600]])]]);
  const t = runElo({ games, k: 20, hfa: 0, regress: 0.5, anchors });
  const carriedA = START_ELO + D / 2;
  near(t.get(1).history[1].eloBefore, (carriedA + 1600) / 2);
  near(t.get(2).history[1].eloBefore, START_ELO - D / 2, 1e-9);

  // NO ANCHORS AT ALL is the behaviour this file already pinned - regression
  // and nothing else. The prior must not change a league that has no poll.
  const plain = runElo({ games, k: 20, hfa: 0, regress: 0.5 });
  near(plain.get(1).history[1].eloBefore, carriedA);
  near(runElo({ games, k: 20, hfa: 0, regress: 0.5, anchors: new Map() }).get(1).history[1].eloBefore, carriedA);
  // AN ANCHOR FOR A SEASON THAT IS NOT CROSSED changes nothing.
  near(runElo({ games, k: 20, hfa: 0, regress: 0.5, anchors: new Map([[2030, new Map([[1, 1900]])]]) })
    .get(1).history[1].eloBefore, carriedA);
});

test('A TEAM FIRST SEEN IN AN ANCHORED SEASON STARTS AT ITS ANCHOR, not halfway to it', () => {
  // C plays only in 2026 and is anchored at 1700. Averaging that with a 1500
  // it never earned would seat it at 1600 and make the preseason opinion count
  // half as much for a newcomer as for everybody else.
  const games = [
    { id: 1, season: 2025, phase: 'REG', kickoffAt: '2025-09-06T17:00:00Z', homeId: 1, awayId: 2, homeScore: 21, awayScore: 14 },
    { id: 2, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z', homeId: 3, awayId: 4, homeScore: 21, awayScore: 14 },
  ];
  const anchors = new Map([[2026, new Map([[3, 1700]])]]);
  const t = runElo({ games, k: 20, hfa: 0, regress: 0.5, anchors });
  near(t.get(3).history[0].eloBefore, 1700);
  assert.notEqual(t.get(3).history[0].eloBefore, 1600);
  // A newcomer with NO anchor still starts at the start rating.
  near(t.get(4).history[0].eloBefore, START_ELO);
  // AND THE ANCHOR IS NOT A SECOND REGRESSION: a team anchored exactly where
  // its regressed rating already sits does not move at the boundary.
  const same = runElo({
    games: [games[0], { ...games[1], homeId: 1, awayId: 2 }], k: 20, hfa: 0, regress: 0.5,
    anchors: new Map([[2026, new Map([[1, START_ELO + D / 2]])]]),
  });
  near(same.get(1).history[1].eloBefore, START_ELO + D / 2);
});
