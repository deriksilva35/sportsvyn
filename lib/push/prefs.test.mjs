// lib/push/prefs.test.mjs - what a reader asked for, and whether this moment
// is it. PURE functions only: no database, no clock, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCloseGame, CLOSE_MLB_MIN_INNING, CLOSE_MLB_MAX_DIFF } from './prefs.js';

// --- BASEBALL'S CLOSE GAME -------------------------------------------------

test("close is a per-sport sentence: baseball has no Q4 and no clock", () => {
  // FOOTBALL IS UNCHANGED, to the letter - an absent sport is football, which
  // is what this function meant before baseball existed.
  const q4 = { period: 4, clock: '2:30', homeScore: 20, awayScore: 24 };
  assert.equal(isCloseGame(q4), true);
  assert.equal(isCloseGame({ ...q4, sport: 'nfl' }), true);
  assert.equal(isCloseGame({ ...q4, clock: '9:00' }), false, 'over five minutes');
  assert.equal(isCloseGame({ ...q4, awayScore: 40 }), false, 'more than one score');
  assert.equal(isCloseGame({ ...q4, period: 3 }), false, 'not the fourth');

  // BASEBALL: within one run, eighth inning or later. The football rule applied
  // here would have fired on every game in the fourth - there is no clock to be
  // under five minutes of - and never at the moment the rule exists for.
  const mlb = { sport: 'mlb', homeScore: 3, awayScore: 3 };
  assert.equal(isCloseGame({ ...mlb, period: 8 }), true, 'tied in the 8th');
  assert.equal(isCloseGame({ ...mlb, period: 9 }), true);
  assert.equal(isCloseGame({ ...mlb, period: 11 }), true, 'extra innings are later, not other');
  assert.equal(isCloseGame({ ...mlb, period: 7 }), false, 'the seventh is not the eighth');
  assert.equal(isCloseGame({ ...mlb, period: 8, awayScore: 4 }), true, 'one run apart');
  assert.equal(isCloseGame({ ...mlb, period: 8, awayScore: 5 }), false, 'two is not close');
  // A CLOCK IS IRRELEVANT AND MUST NOT BE REQUIRED. Baseball's live_state has
  // no clock at all, so a rule that read one could never fire.
  assert.equal(isCloseGame({ ...mlb, period: 8, clock: undefined }), true);
  assert.equal(isCloseGame({ ...mlb, period: 8, clock: '' }), true);
  // And a score we do not have is not a close game in either sport.
  assert.equal(isCloseGame({ sport: 'mlb', period: 9, homeScore: null, awayScore: 2 }), false);
});

test('the sheet promises the rule the code enforces', async () => {
  const { rowsForSport } = await import('./sheetRules.js');
  const ROWS = [
    { key: 'kickoff', title: 'Kickoff', trigger: 'When the game goes live' },
    { key: 'score', title: 'Score changes', trigger: 'Every score, both teams' },
    { key: 'quarter', title: 'Quarter ends', trigger: 'End of each quarter' },
    { key: 'close', title: 'Close game', trigger: 'Q4, one score apart, under five minutes' },
    { key: 'final', title: 'Final', trigger: 'The result, when the game ends' },
  ];
  assert.deepEqual(rowsForSport(ROWS, 'football'), ROWS, 'football is the default wording');
  assert.deepEqual(rowsForSport(ROWS, null), ROWS);
  const mlb = rowsForSport(ROWS, 'baseball');
  const by = Object.fromEntries(mlb.map((r) => [r.key, r]));
  // THE CLOSE ROW'S SENTENCE IS THE RULE'S SENTENCE, and the numbers in it are
  // the constants isCloseGame reads.
  assert.match(by.close.trigger, new RegExp(`within one run`, 'i'));
  assert.match(by.close.trigger, new RegExp(`${CLOSE_MLB_MIN_INNING}th inning or later`, 'i'));
  assert.doesNotMatch(by.close.trigger, /Q4|minutes/);
  assert.equal(by.quarter.title, 'Inning ends');
  assert.match(by.score.trigger, /Every run/);
  // The rows nobody rewrote keep football's words, and the five stay five.
  assert.equal(by.kickoff.trigger, 'When the game goes live');
  assert.equal(mlb.length, 5);
});
