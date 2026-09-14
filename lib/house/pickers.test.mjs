// lib/house/pickers.test.mjs - each persona on each game it plays, and the
// empty cases, which are the ones that decide whether "no method" is honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickDaily, chalkDaily, gutDaily, homerDaily, homerOwnCount } from './pickDaily.js';
import { pickPickem, favouriteOf, chalkPickem, fadePickem, gutPickem, homerPickem } from './pickPickem.js';
import { pickWeekly, chalkWeekly, gutWeekly, homerWeekly, homerOwnSlots } from './pickWeekly.js';
import { seatStrategyFor, chalkSeat, fadeSeat, gutSeat, homerSeat } from './pickDraft.js';
import { SLOTS as DAILY_SLOTS } from '../daily/boardShape.js';
import { SLOTS as WEEKLY_SLOTS } from '../weekly/rules.js';
import { FADE_MAX } from './personas.js';

const rng = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

// ---------------------------------------------------------------------------
// THE DAILY - twelve team cards, eight slots, one player per team
// ---------------------------------------------------------------------------
const card = (team, players) => ({ key: team, abbr: team, card: players, record: null });
const pl = (name, position, points) => ({ name, position, points, meta: '' });
const DAILY = {
  id: 1,
  board: [
    card('KC', [pl('A QB', 'QB', 300), pl('A RB', 'RB', 200), pl('A WR', 'WR', 150), pl('A K', 'PK', 120)]),
    card('GB', [pl('B QB', 'QB', 280), pl('B RB', 'RB', 210), pl('B WR', 'WR', 160), pl('B K', 'PK', 110)]),
    card('SF', [pl('C QB', 'QB', 260), pl('C RB', 'RB', 190), pl('C WR', 'WR', 170), pl('C K', 'PK', 100)]),
    card('NE', [pl('D QB', 'QB', 240), pl('D RB', 'RB', 180), pl('D WR', 'WR', 140), pl('D K', 'PK', 90)]),
    card('NYJ', [pl('E QB', 'QB', 220), pl('E RB', 'RB', 175), pl('E WR', 'WR', 165), pl('E K', 'PK', 80)]),
    card('MIA', [pl('F QB', 'QB', 210), pl('F RB', 'RB', 170), pl('F WR', 'WR', 155), pl('F K', 'PK', 70)]),
    card('BUF', [pl('G QB', 'QB', 205), pl('G RB', 'RB', 165), pl('G WR', 'WR', 145), pl('G K', 'PK', 60)]),
    card('DAL', [pl('H QB', 'QB', 200), pl('H RB', 'RB', 160), pl('H WR', 'WR', 135), pl('H K', 'PK', 50)]),
  ],
};

test('DAILY / CHALK takes the biggest eligible number at every slot', () => {
  const picks = chalkDaily(DAILY);
  assert.equal(picks.length, DAILY_SLOTS.length);
  assert.equal(picks[0].playerName, 'A QB', 'the top QB');
  // ONE PLAYER PER TEAM, which is the board's own rule.
  const teams = picks.map((p) => p.teamKey);
  assert.equal(new Set(teams).size, teams.length, 'a team is used at most once');
  assert.equal(picks.every((p) => p.teamKey != null), true, 'every slot filled');
});

test('DAILY / CHALK is GREEDY, not the optimum - it is a persona, not the answer key', () => {
  // The exact solver exists (lib/daily/assignmentSolver.js). Using it would
  // file a perfect roster every day, which is not a strategy.
  const picks = chalkDaily(DAILY);
  // The greedy spends the best team on the first slot it fits, which is what
  // costs it later - the K slot is left with whatever team remains.
  assert.equal(picks[0].teamKey, 'KC');
  assert.equal(picks[picks.length - 1].playerName.endsWith('K'), true, 'the K slot is still filled');
});

test('DAILY / GUT stays inside the top tier and is REPEATABLE for one seed', () => {
  const a = gutDaily(DAILY, rng([0.1, 0.9, 0.5, 0.2, 0.7, 0.3, 0.6, 0.4]));
  const b = gutDaily(DAILY, rng([0.1, 0.9, 0.5, 0.2, 0.7, 0.3, 0.6, 0.4]));
  assert.deepEqual(a, b, 'same seed, same entry - a cron re-run must not refile');
  assert.equal(new Set(a.map((p) => p.teamKey)).size, a.length);
});

test('DAILY / HOMER takes its own where the board has them, the chalk elsewhere', () => {
  const picks = homerDaily(DAILY, ['KC', 'GB', 'DAL', 'BUF']);
  assert.equal(homerOwnCount(picks, DAILY, ['KC', 'GB', 'DAL', 'BUF']), 4,
    'all four of its teams are on this board and all four are used');
  assert.equal(new Set(picks.map((p) => p.teamKey)).size, picks.length);
});

test('DAILY / HOMER WITH NO TEAMS ON THE BOARD IS THE CHALK, entry for entry', () => {
  // The empty case, and it is not a failure - the method line already said
  // "the chalk everywhere else", and everywhere else is everywhere.
  const picks = homerDaily(DAILY, ['SEA', 'DEN', 'LV', 'LAC']);
  assert.deepEqual(picks, chalkDaily(DAILY));
});

test('DAILY / THE FADE DOES NOT PLAY, and returns nothing to file', () => {
  assert.equal(pickDaily('fade', DAILY, Math.random), null);
  assert.equal(pickDaily('book', DAILY, Math.random), null);
});

test('DAILY / an empty board fills nothing rather than throwing', () => {
  const picks = chalkDaily({ id: 2, board: [] });
  assert.equal(picks.length, DAILY_SLOTS.length);
  assert.equal(picks.every((p) => p.teamKey === null), true, 'every slot is an honest empty');
});

// ---------------------------------------------------------------------------
// PICK'EM - a signed, home-based spread
// ---------------------------------------------------------------------------
const g = (id, home, away) => ({ match_id: id, home_team_id: home, away_team_id: away });
const GAMES = [g(1, 10, 20), g(2, 30, 40), g(3, 50, 60), g(4, 70, 80)];
//  1: home -3   (home favoured, inside)     2: home +10 (away favoured, outside)
//  3: home -6   (home favoured, inside)     4: no line
const SPREADS = new Map([[1, -3], [2, 10], [3, -6]]);

test('the sign convention is home-based: negative means the home side is favoured', () => {
  assert.equal(favouriteOf(-3), 'home');
  assert.equal(favouriteOf(3), 'away');
  assert.equal(favouriteOf(0), null, 'a true pick-em names no favourite');
  assert.equal(favouriteOf(null), null);
  assert.equal(favouriteOf(undefined), null);
});

test("PICK'EM / CHALK takes the favourite on every priced game and skips the rest", () => {
  const picks = chalkPickem(GAMES, SPREADS);
  assert.deepEqual(picks, [
    { matchId: 1, side: 'home' }, { matchId: 2, side: 'away' }, { matchId: 3, side: 'home' },
  ]);
  assert.equal(picks.some((p) => p.matchId === 4), false, 'the unpriced game has no favourite');
});

test("PICK'EM / FADE takes the dog INSIDE the number, and skips outside it", () => {
  const picks = fadePickem(GAMES, SPREADS);
  assert.deepEqual(picks, [
    { matchId: 1, side: 'away' }, { matchId: 3, side: 'away' },
  ]);
  assert.equal(picks.some((p) => p.matchId === 2), false, `+10 is outside ${FADE_MAX}`);
});

test("PICK'EM / FADE WITH NO PRICED GAMES PICKS NOTHING (ruling R5)", () => {
  // The empty case. An unpicked game scores zero and the board shows fewer
  // picks, which is truthful - The Fade has no opinion without a number.
  assert.deepEqual(fadePickem(GAMES, new Map()), []);
  assert.deepEqual(fadePickem([], SPREADS), []);
  assert.deepEqual(pickPickem('fade', GAMES, { spreads: new Map() }), []);
});

test("PICK'EM / GUT leans to the favourite as the number grows, and never stops taking dogs", () => {
  const always = gutPickem(GAMES, SPREADS, () => 0.99);   // above every pFav
  assert.equal(always.every((p, i) => p.side !== chalkPickem(GAMES, SPREADS)[i].side), true,
    'a high draw always takes the dog');
  const never = gutPickem(GAMES, SPREADS, () => 0.01);
  assert.deepEqual(never, chalkPickem(GAMES, SPREADS), 'a low draw always takes the chalk');
});

test("PICK'EM / HOMER picks its own teams, priced or not", () => {
  const picks = homerPickem(GAMES, [10, 80]);
  assert.deepEqual(picks, [
    { matchId: 1, side: 'home' },
    { matchId: 4, side: 'away' },   // unpriced, and taken anyway
  ]);
});

test("PICK'EM / HOMER with BOTH teams its own takes the home side, by stated rule", () => {
  assert.deepEqual(homerPickem([g(9, 10, 20)], [10, 20]), [{ matchId: 9, side: 'home' }]);
});

test("PICK'EM / HOMER WITH NO TEAMS ON THE BOARD PICKS NOTHING", () => {
  assert.deepEqual(homerPickem(GAMES, [999]), []);
  assert.deepEqual(homerPickem(GAMES, []), []);
});

// ---------------------------------------------------------------------------
// THE WEEKLY - career PPG off the resume string
// ---------------------------------------------------------------------------
const wp = (id, pos, name, team, ppg) => ({ id, pos, name, team, resume: `${ppg} PPG · 100 g` });
const WBOARD = [
  wp(1, 'QB', 'Q One', 'KC', 24.1), wp(2, 'QB', 'Q Two', 'SEA', 22.0),
  wp(3, 'RB', 'R One', 'SEA', 19.5), wp(4, 'RB', 'R Two', 'GB', 18.0),
  wp(5, 'WR', 'W One', 'SEA', 17.2), wp(6, 'WR', 'W Two', 'DAL', 16.0),
  wp(7, 'TE', 'T One', 'SEA', 12.4), wp(8, 'TE', 'T Two', 'BUF', 11.0),
  wp(9, 'RB', 'R Three', 'SEA', 15.0), wp(10, 'WR', 'W Three', 'SEA', 14.0),
];

test('WEEKLY / CHALK takes the highest career PPG at every slot, no player twice', () => {
  const lu = chalkWeekly(WBOARD);
  assert.equal(lu.QB, 1);
  assert.equal(lu.RB, 3);
  assert.equal(lu.WR, 5);
  assert.equal(lu.TE, 7);
  const ids = Object.values(lu);
  assert.equal(new Set(ids).size, ids.length, 'a player fills at most one slot');
  assert.equal(Object.keys(lu).length, WEEKLY_SLOTS.length);
});

test('WEEKLY / GUT is repeatable for one seed and fills every slot', () => {
  const a = gutWeekly(WBOARD, rng([0.3, 0.8, 0.1, 0.6, 0.4, 0.9]));
  const b = gutWeekly(WBOARD, rng([0.3, 0.8, 0.1, 0.6, 0.4, 0.9]));
  assert.deepEqual(a, b);
  assert.equal(new Set(Object.values(a)).size, Object.values(a).length);
});

test('WEEKLY / HOMER prefers its own teams and falls back to the chalk', () => {
  const lu = homerWeekly(WBOARD, ['KC', 'GB', 'DAL', 'BUF']);
  assert.equal(lu.QB, 1, 'the KC quarterback is both its own AND the chalk here');
  assert.equal(lu.RB, 4, 'the GB back over the higher-PPG Seattle one');
  assert.equal(lu.WR, 6, 'the DAL receiver');
  assert.equal(lu.TE, 8, 'the BUF tight end');
  assert.ok(homerOwnSlots(lu, WBOARD, ['KC', 'GB', 'DAL', 'BUF']) >= 4);
});

test('WEEKLY / HOMER WITH NO TEAMS ON THE BOARD IS THE CHALK', () => {
  assert.deepEqual(homerWeekly(WBOARD, ['XXX']), chalkWeekly(WBOARD));
});

test('WEEKLY / THE FADE DOES NOT PLAY', () => {
  assert.equal(pickWeekly('fade', WBOARD, Math.random), null);
});

test('WEEKLY / a slot with no eligible player is left empty, not faked', () => {
  const thin = [wp(1, 'QB', 'Only QB', 'KC', 20)];
  const lu = chalkWeekly(thin);
  assert.equal(lu.QB, 1);
  assert.equal('RB' in lu, false, 'no back exists, so no back is claimed');
  assert.deepEqual(pickWeekly('chalk', [], Math.random), {});
});

// ---------------------------------------------------------------------------
// THE DRAFT - one seat, the house's own
// ---------------------------------------------------------------------------
const cand = (name, adp, team) => ({ name, adp, team });
const CANDS = [
  cand('P1', 9, 'KC'), cand('P2', 11, 'SEA'), cand('P3', 14, 'GB'),
  cand('P4', 30, 'SEA'), cand('P5', 40, 'DAL'), cand('P6', 55, 'SEA'),
  cand('P7', 60, 'SEA'), cand('P8', 61, 'SEA'), cand('P9', 62, 'SEA'),
  cand('P10', 63, 'SEA'), cand('P11', 64, 'SEA'), cand('P12', 65, 'BUF'),
  cand('P13', 99, 'BUF'),
];

test('DRAFT / CHALK is best available, every pick', () => {
  assert.equal(chalkSeat(CANDS).name, 'P1');
  assert.equal(chalkSeat([]), null);
});

test('DRAFT / FADE takes the biggest SLIDE inside the top twelve', () => {
  // At overall 10 the biggest adp-minus-overall inside the top twelve is P12.
  assert.equal(fadeSeat(CANDS, 10).name, 'P12');
  // P13 is a bigger number but sits outside the tier - a slide forty picks
  // deep is not a slide, it is a worse player.
  assert.notEqual(fadeSeat(CANDS, 10).name, 'P13');
  assert.equal(fadeSeat([], 10), null);
});

test('DRAFT / GUT stays in the top tier and is repeatable', () => {
  const a = gutSeat(CANDS, rng([0.42]));
  const b = gutSeat(CANDS, rng([0.42]));
  assert.equal(a.name, b.name);
  assert.ok(CANDS.slice(0, 8).includes(a));
  assert.equal(gutSeat([], Math.random), null);
});

test('DRAFT / HOMER takes its own team first, best available otherwise', () => {
  assert.equal(homerSeat(CANDS, ['GB']).name, 'P3');
  assert.equal(homerSeat(CANDS, ['XXX']).name, 'P1', 'none of its teams available');
  assert.equal(homerSeat([], ['GB']), null);
});

test('DRAFT / every persona has a seat strategy, and The Book has none', () => {
  for (const k of ['chalk', 'fade', 'gut', 'homer']) {
    assert.equal(typeof seatStrategyFor(k), 'function', k);
    assert.equal(seatStrategyFor(k)(CANDS, { overallPick: 10, rng: () => 0.5 }) != null, true);
  }
  assert.equal(seatStrategyFor('book'), null);
  assert.equal(seatStrategyFor('nobody'), null);
});

test('A SEAT STRATEGY THAT IS HANDED NOTHING RETURNS NULL rather than throwing', () => {
  for (const k of ['chalk', 'fade', 'gut', 'homer']) {
    assert.equal(seatStrategyFor(k)([], { overallPick: 1, rng: () => 0.5 }), null, k);
  }
});
