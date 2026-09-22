// lib/october/scoring.test.mjs - the table, and the one arithmetic decision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BAT_POINTS, ARM_POINTS, RULES_LINE, singlesOf, batPoints, armPoints,
  slotPoints, batLine, armLine,
} from './scoring.js';

test("the table is the relay's, verbatim, and the card prints it from here", () => {
  assert.deepEqual(BAT_POINTS, {
    single: 3, double: 5, triple: 8, homeRun: 10, rbi: 2, run: 2, walk: 2, stolenBase: 5,
  });
  assert.equal(ARM_POINTS.strikeout, 2);
  assert.equal(ARM_POINTS.win, 4);
  assert.equal(ARM_POINTS.earnedRun, -2);
  assert.equal(ARM_POINTS.hitAllowed, -0.6);
  assert.equal(ARM_POINTS.walkAllowed, -0.6);
  // IP IS PER OUT: 2.25 an inning is 0.75 an out, which is the reason the
  // column stores outs at all.
  assert.equal(ARM_POINTS.perOut, 0.75);
  // THE PRINTED RULES ARE GENERATED FROM THE SCORED RULES, so the footer on
  // the card cannot drift away from the settle.
  assert.equal(RULES_LINE.bats, '1B 3 · 2B 5 · 3B 8 · HR 10 · RBI 2 · R 2 · BB 2 · SB 5');
  assert.equal(RULES_LINE.arms, 'IP 2.25 · K 2 · W 4 · ER -2 · H -0.6 · BB -0.6');
});

test('A HOME RUN IS A HIT, so singles are derived and never stored', () => {
  // The provider sends `hits` as the TOTAL. Scoring hits and home runs
  // separately pays a home run 13 instead of 10.
  assert.equal(singlesOf({ hits: 3, doubles: 1, triples: 0, home_runs: 1 }), 1);
  assert.equal(singlesOf({ hits: 1, home_runs: 1 }), 0);
  assert.equal(singlesOf({ hits: 0 }), 0);
  // A row with more extra-base hits than hits is broken; it must not pay a
  // bat for not batting.
  assert.equal(singlesOf({ hits: 1, doubles: 3 }), 0);

  // THE MOCK'S OWN HARPER LINE: 1-3 with a home run, a run and an RBI is
  // 14.0, and that only works if the hit is not also counted as a single.
  assert.equal(batPoints({ at_bats: 3, hits: 1, home_runs: 1, runs: 1, rbi: 1 }), 14);
});

test('a bat line, by the table', () => {
  // 2-4 with a double and two RBI: single 3 + double 5 + 2 RBI 4 = 12.
  assert.equal(batPoints({ at_bats: 4, hits: 2, doubles: 1, rbi: 2 }), 12);
  // Every category at once.
  assert.equal(batPoints({
    at_bats: 5, hits: 4, doubles: 1, triples: 1, home_runs: 1,
    rbi: 3, runs: 2, walks: 1, stolen_bases: 1,
  }), 3 + 5 + 8 + 10 + 6 + 4 + 2 + 5);
  assert.equal(batPoints({}), 0);
  assert.equal(batPoints(null), 0);
  // A walk-only day is still a day.
  assert.equal(batPoints({ at_bats: 0, hits: 0, walks: 2 }), 4);
});

test('AN ARM CAN GO NEGATIVE, and clamping it would hide a disaster', () => {
  // Two innings, seven earned, nine hits, three walks, one strikeout:
  // 6 outs (4.5) + 1 K (2) - 7 ER (-14) - 9 H (-5.4) - 3 BB (-1.8) = -14.7
  const blowup = { outs_recorded: 6, strikeouts_pitched: 1, earned_runs: 7, hits_allowed: 9, walks_allowed: 3 };
  assert.equal(Math.round(armPoints(blowup) * 10) / 10, -14.7);
  assert.ok(armPoints(blowup) < 0, 'a start that costs you the day must cost you points');

  // A complete-game shutout with a win: 27 outs (20.25) + 12 K (24) + W (4)
  // - 0 ER - 3 H (-1.8) - 1 BB (-0.6) = 45.85
  const gem = { outs_recorded: 27, strikeouts_pitched: 12, wins: 1, earned_runs: 0, hits_allowed: 3, walks_allowed: 1 };
  assert.equal(Math.round(armPoints(gem) * 100) / 100, 45.85);

  // A RELIEVER LIFTED WITH ONE DOWN has 16 outs, not "5.1 innings" run
  // through a number that does not divide.
  assert.equal(armPoints({ outs_recorded: 16 }), 12);
});

test('THE SLOT DECIDES WHICH TABLE, not the row', () => {
  // A two-way player carries both halves on one row (migration 110's shape).
  // An arm slot must pay him for pitching and NOTHING else, or he is two
  // players in one slot.
  const twoWay = {
    at_bats: 4, hits: 2, home_runs: 1, rbi: 3, runs: 1,
    outs_recorded: 18, strikeouts_pitched: 8, wins: 1, earned_runs: 1, hits_allowed: 4, walks_allowed: 1,
  };
  assert.equal(slotPoints('arm', twoWay), 28.5);   // 13.5 + 16 + 4 - 2 - 2.4 - 0.6
  assert.equal(slotPoints('bat1', twoWay), 21);    // 3 + 10 + 6 + 2
  assert.notEqual(slotPoints('arm', twoWay), slotPoints('bat1', twoWay));
  // ROUNDED TO ONE DECIMAL at the last moment: 0.75 an out and -0.6 a hit
  // both produce tails, and a board showing 31.5 must be summing 31.5.
  assert.equal(slotPoints('arm', { outs_recorded: 16, hits_allowed: 5 }), 9);
});

test('the printed line is the mock\'s grammar, and empty when nothing happened', () => {
  assert.equal(batLine({ at_bats: 4, hits: 2, doubles: 1, rbi: 2 }), '2-4 · 2B · 2 RBI');
  assert.equal(batLine({ at_bats: 3, hits: 1, home_runs: 1, runs: 1, rbi: 1 }), '1-3 · HR · 1 RBI · 1 R');
  assert.equal(batLine({ at_bats: 2, hits: 1, walks: 1, stolen_bases: 1 }), '1-2 · BB · SB');
  assert.equal(batLine({ at_bats: 4, hits: 0 }), '0-4', 'an 0-fer is a line');
  // NOT "0-0 · 0 RBI" for a player who has not come up yet.
  assert.equal(batLine({}), null);
  assert.equal(batLine(null), null);
  assert.equal(armLine({ outs_recorded: 16, strikeouts_pitched: 7, earned_runs: 1 }), '5.1 IP · 7 K · 1 ER');
  assert.equal(armLine({ outs_recorded: 21, strikeouts_pitched: 9, earned_runs: 0, wins: 1 }), '7.0 IP · 9 K · 0 ER · W');
  assert.equal(armLine({}), null);
});
