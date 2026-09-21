// lib/gridiron/possession.test.mjs - the one reader, four answers.
//
// THE SURFACES CANNOT TEST THIS BETWEEN THEM. A rendered board proves the dot
// landed on a row; it cannot prove the rule that put it there, because a
// fixture only ever asks one question. The rule is asked all of its questions
// here, and the two mount tests then prove each surface actually asks it.
//
// THE FOUR THE RELAY NAMES - home, away, null, non-football - plus the two
// shapes of null it would be easy to get wrong: a stopped clock, and a live
// football game whose offense nobody knows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { possessionSide, ballInPlay, isFootball } from './possession.js';

// A live third quarter, ball in play. Every case below varies ONE thing from
// this, so a failure names the thing that changed.
const LIVE = { period: 3, clock: '8:41' };
const base = {
  leagueSlug: 'nfl', status: 'live', homeAbbr: 'TEN', awayAbbr: 'NYJ', liveState: LIVE,
};

test('HOME has it: the possession abbreviation matches the home row', () => {
  assert.equal(possessionSide({ ...base, possession: 'TEN' }), 'home');
  // CFB is the other code with possession, and it answers the same way.
  assert.equal(possessionSide({ ...base, leagueSlug: 'cfb', possession: 'TEN' }), 'home');
  // The abbreviation is compared as printed, not as typed: a provider that
  // hands back a lowercase or padded string still points at the same row.
  assert.equal(possessionSide({ ...base, possession: ' ten ' }), 'home');
});

test('AWAY has it: the same reader, the other row', () => {
  assert.equal(possessionSide({ ...base, possession: 'NYJ' }), 'away');
  assert.equal(possessionSide({ ...base, leagueSlug: 'cfb', possession: 'NYJ' }), 'away');
});

test('NULL: nobody has it, and every way of nobody having it', () => {
  // No possession at all - the honest gap the play feed leaves between drives.
  assert.equal(possessionSide({ ...base, possession: null }), null);
  assert.equal(possessionSide({ ...base, possession: '' }), null);
  // A team that is on neither row. Better no dot than a dot on a guess.
  assert.equal(possessionSide({ ...base, possession: 'KC' }), null);
  // A CFB team with no abbreviation stored - 105 of 243 of them - reaches the
  // reader as an empty string and gets the same nothing the spot label gets.
  assert.equal(possessionSide({ ...base, leagueSlug: 'cfb', homeAbbr: '', possession: '' }), null);
  // HALFTIME. The situation line keeps the last snap because that IS where the
  // ball will be spotted; the dot cannot ride along, because right now nobody
  // is holding it.
  assert.equal(possessionSide({ ...base, possession: 'TEN', liveState: { period: 2, clock: '0:00' } }), null);
  assert.equal(possessionSide({ ...base, possession: 'TEN', liveState: { period: 2, clock: '00:00' } }), null);
  assert.equal(possessionSide({ ...base, possession: 'TEN', liveState: { short: 'HT', clock: '' } }), null);
  // BETWEEN QUARTERS - a zeroed clock in a period that is not the half.
  assert.equal(possessionSide({ ...base, possession: 'TEN', liveState: { period: 1, clock: '0:00' } }), null);
  assert.equal(possessionSide({ ...base, possession: 'TEN', liveState: { period: 3, clock: '00:00' } }), null);
  // NOT LIVE. A final's last drive still has an offense; the row must not wear
  // the mark for the rest of the season.
  assert.equal(possessionSide({ ...base, possession: 'TEN', status: 'final' }), null);
  assert.equal(possessionSide({ ...base, possession: 'TEN', status: 'scheduled' }), null);
  assert.equal(possessionSide({ ...base, possession: 'TEN', status: null }), null);
  // BOTH ROWS THE SAME STRING is not an answer either. Two dots would be worse
  // than none, and picking one of them would be a coin toss wearing a fact.
  assert.equal(possessionSide({ ...base, possession: 'TEN', awayAbbr: 'TEN' }), null);
  // No argument at all must not throw - the board calls this on every card.
  assert.equal(possessionSide(), null);
  assert.equal(possessionSide({}), null);
});

test('NON-FOOTBALL: soccer has possession as a percentage, never as a dot', () => {
  // The EPL card on the same board carries a win-probability bar and no drive
  // at all. Even handed an abbreviation that matches a row, the answer is null.
  assert.equal(possessionSide({ ...base, leagueSlug: 'epl', possession: 'TEN' }), null);
  assert.equal(possessionSide({ ...base, leagueSlug: null, possession: 'TEN' }), null);
  assert.equal(possessionSide({ ...base, leagueSlug: 'nba', possession: 'TEN' }), null);
  assert.equal(isFootball('nfl'), true);
  assert.equal(isFootball('cfb'), true);
  assert.equal(isFootball('CFB'), true, 'the league slug is compared case-insensitively');
  assert.equal(isFootball('epl'), false);
  assert.equal(isFootball(undefined), false);
});

test('a missing clock is not a stoppage - a replayed cut still shows the dot', () => {
  // A simulated ?asOf= cut deliberately withholds liveState so the page is not
  // read against the clock as it stands NOW. That must not cost it the dot:
  // gamecastState() is given the same null for the same reason.
  assert.equal(ballInPlay(null), true);
  assert.equal(possessionSide({ ...base, possession: 'TEN', liveState: null }), 'home');
  // And a clock that is running is a clock that is running.
  assert.equal(ballInPlay(LIVE), true);
  assert.equal(ballInPlay({ period: 4, clock: '0:04' }), true, 'four seconds is not zero');
});
