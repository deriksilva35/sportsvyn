// lib/live/basketballVocabulary.test.mjs - the basketball seam (thu-17).
//
// LANDS BEFORE ANY NBA ROW EXISTS. Everything here is pure: the sport, the
// chip grammar, the strict live-clock parser, the close-game rule, and the one
// gate that keeps basketball from sending a push per basket. Football and
// baseball are pinned unchanged alongside, because a sport branch added to a
// shared function is exactly how the other sports break.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortOf, finalShortOf, hasClock, sportOf, parseNbaLive, LEAGUE_SPORT,
  FOOTBALL, BASEBALL, BASKETBALL,
} from './vocabulary.js';
import { clockToSeconds, isCloseGame } from '../push/prefs.js';
import { transitionsFor } from '../push/transitions.js';
import { SPORTS, sportChipShown } from '../scores/v4.js';

// --------------------------------------------------------------------- sport

test('sportOf: nba is basketball; ncaab is NOT registered until March', () => {
  assert.equal(BASKETBALL, 'basketball');
  assert.equal(sportOf('nba'), BASKETBALL);
  assert.equal(sportOf(' NBA '), BASKETBALL);
  // Halves, not quarters: the quarter grammar must not reach college games.
  assert.equal(Object.hasOwn(LEAGUE_SPORT, 'ncaab'), false);
  assert.equal(sportOf('ncaab'), FOOTBALL, 'unregistered = the default, unchanged');
  // The neighbours did not move.
  assert.equal(sportOf('nfl'), FOOTBALL);
  assert.equal(sportOf('cfb'), FOOTBALL);
  assert.equal(sportOf('mlb'), BASEBALL);
  assert.equal(hasClock(BASKETBALL), true);
});

// ------------------------------------------------------------ chip grammar

test('shortOf basketball: Q1-Q4, Half, OT, 2OT, 3OT', () => {
  const at = (period, clock) => shortOf({ period, clock }, BASKETBALL);
  assert.equal(at(1, '11:34'), 'Q1');
  assert.equal(at(2, '5:00'), 'Q2');
  assert.equal(at(3, '0:04'), 'Q3');
  assert.equal(at(4, '1.5'), 'Q4');
  assert.equal(at(4, '0.0'), 'Q4', 'end of regulation is not halftime');
  assert.equal(at(2, '0:00'), 'Half');
  assert.equal(at(2, '00:00'), 'Half');
  assert.equal(at(2, '0.0'), 'Half', 'the NBA feed writes a stopped clock in tenths');
  assert.equal(at(5, '4:12'), 'OT');
  assert.equal(at(6, '2:00'), '2OT');
  assert.equal(at(7, '0:30'), '3OT');
  assert.equal(at(0, '12:00'), null);
  assert.equal(shortOf(null, BASKETBALL), null);
  // Football keeps its own words for the same numbers.
  assert.equal(shortOf({ period: 2, clock: '0:00' }), 'HT');
  assert.equal(shortOf({ period: 6, clock: '2:00' }), 'OT');
});

test('finalShortOf basketball: Final, F/OT, F/2OT, F/3OT', () => {
  assert.equal(finalShortOf(4, BASKETBALL), 'Final');
  assert.equal(finalShortOf(null, BASKETBALL), 'Final');
  assert.equal(finalShortOf(5, BASKETBALL), 'F/OT');
  assert.equal(finalShortOf(6, BASKETBALL), 'F/2OT');
  assert.equal(finalShortOf(7, BASKETBALL), 'F/3OT');
  // Unchanged elsewhere.
  assert.equal(finalShortOf(6), 'F/OT');
  assert.equal(finalShortOf(10, BASEBALL), 'F/10');
});

// ---------------------------------------------------- the strict live parser

test('parseNbaLive: the known shapes parse', () => {
  assert.deepEqual(parseNbaLive(1, '11:34'), { period: 1, clock: '11:34' });
  assert.deepEqual(parseNbaLive(3, '5:12'), { period: 3, clock: '5:12' });
  assert.deepEqual(parseNbaLive(4, '1.5'), { period: 4, clock: '1.5' });
  assert.deepEqual(parseNbaLive(4, '0.0'), { period: 4, clock: '0.0' });
  assert.deepEqual(parseNbaLive(4, '59.9'), { period: 4, clock: '59.9' });
  assert.deepEqual(parseNbaLive(3, '3rd Qtr 5:12'), { period: 3, clock: '5:12' });
  assert.deepEqual(parseNbaLive(2, 'Q2 0:45'), { period: 2, clock: '0:45' });
  assert.deepEqual(parseNbaLive(5, 'OT 2:00'), { period: 5, clock: '2:00' });
  assert.deepEqual(parseNbaLive(6, '2OT 4:59'), { period: 6, clock: '4:59' });
  assert.deepEqual(parseNbaLive(2, 'Halftime'), { period: 2, clock: '0:00' });
  assert.deepEqual(parseNbaLive(2, 'half'), { period: 2, clock: '0:00' });
});

test('parseNbaLive: a miss is null, never a guess', () => {
  for (const [p, t] of [
    [3, '3rd Qtr'],          // a quarter with no clock is not a clock
    [3, 'Final'],
    [4, 'End of 4th'],       // unobserved spelling - unmapped until seen
    [3, '5:72'],             // seconds out of range
    [3, '512'],
    [3, '15'],               // an integer could be minutes or seconds
    [3, '1.55'],
    [3, ''], [3, null], [3, undefined],
    [0, '5:12'], [null, '5:12'], ['', '5:12'], [2.5, '5:12'], [-1, '5:12'],
    [3, 'Q2 5:12'],          // the prefix contradicts the period
    [5, '2OT 1:00'],
    [3, 'Halftime'],         // halftime only exists at period 2
    [3, '2026-10-20T23:00:00Z'], // the scheduled row's `status` shape
  ]) {
    assert.equal(parseNbaLive(p, t), null, `${p} / ${JSON.stringify(t)}`);
  }
});

// ------------------------------------------------------------------ tenths

test('clockToSeconds reads tenths; mm:ss unchanged', () => {
  assert.equal(clockToSeconds('1.5'), 1.5);
  assert.equal(clockToSeconds('0.0'), 0);
  assert.equal(clockToSeconds('59.9'), 59.9);
  assert.equal(clockToSeconds('60.0'), null);
  assert.equal(clockToSeconds('15'), null);
  assert.equal(clockToSeconds('1.55'), null);
  assert.equal(clockToSeconds('2:00'), 120);
  assert.equal(clockToSeconds('4:59'), 299);
  assert.equal(clockToSeconds('4:99'), null);
});

// ---------------------------------------------------------- the close game

test('isCloseGame basketball: period >= 4 incl. OT, <= 2:00, <= 5 points (ruled)', () => {
  const close = (period, clock, home, away) =>
    isCloseGame({ period, clock, homeScore: home, awayScore: away, sport: 'nba' });
  assert.equal(close(4, '2:00', 100, 95), true, 'Q4 2:00 five points');
  assert.equal(close(4, '2:01', 100, 95), false, 'one second too early');
  assert.equal(close(4, '1:00', 100, 94), false, 'six points');
  assert.equal(close(3, '0:30', 80, 80), false, 'Q3 never');
  assert.equal(close(5, '1:10', 110, 108), true, 'OT');
  assert.equal(close(6, '0:45', 120, 120), true, '2OT');
  assert.equal(close(4, '1.5', 100, 99), true, 'tenths');
  assert.equal(close(4, '0.0', 100, 96), true);
  assert.equal(close(4, '5:00', 100, 99), false, 'the football five minutes does not apply');
  assert.equal(close(4, null, 100, 99), false, 'no clock, no claim');
  // Football keeps its rule exactly.
  assert.equal(isCloseGame({ period: 4, clock: '4:59', homeScore: 20, awayScore: 13 }), true);
  assert.equal(isCloseGame({ period: 4, clock: '4:59', homeScore: 20, awayScore: 13, sport: 'nfl' }), true);
});

// ------------------------------------------------- no push per basket

const row = (status, home, away, period, clock, league = 'nba') =>
  ({ status, home_score: home, away_score: away, league_slug: league, live_state: period ? { period, clock } : null });

test('basketball emits NO per-score event; tip-off, quarter, close and final still fire', () => {
  const ev = (b, a) => transitionsFor(b, a).map((t) => t.event);
  // tip-off
  assert.deepEqual(ev(row('scheduled', null, null), row('live', 0, 0, 1, '11:40')), ['kickoff']);
  // a basket: nothing
  assert.deepEqual(ev(row('live', 10, 8, 2, '5:00'), row('live', 12, 8, 2, '4:40')), []);
  // a basket that crosses the quarter: the quarter only
  assert.deepEqual(ev(row('live', 30, 28, 1, '0:30'), row('live', 32, 28, 2, '11:50')), ['quarter']);
  // entering the close window, with a score change on the same poll: close only
  assert.deepEqual(ev(row('live', 98, 90, 4, '2:30'), row('live', 98, 93, 4, '1:55')), ['close']);
  // the final
  assert.deepEqual(ev(row('live', 100, 95, 4, '0.0'), row('final', 100, 97, 4, '0.0')), ['final']);
  // camelCase league key, as some callers hold it
  assert.deepEqual(ev({ ...row('live', 10, 8, 2, '5:00'), league_slug: undefined, leagueSlug: 'nba' },
    { ...row('live', 12, 8, 2, '4:40'), league_slug: undefined, leagueSlug: 'nba' }), []);
});

test('football and baseball still emit per-score events', () => {
  const ev = (b, a) => transitionsFor(b, a).map((t) => t.event);
  assert.deepEqual(ev(row('live', 0, 0, 1, '9:00', 'nfl'), row('live', 7, 0, 1, '8:10', 'nfl')), ['score']);
  assert.deepEqual(ev(row('live', 0, 0, 1, '9:00', null), row('live', 7, 0, 1, '8:10', null)), ['score']);
  assert.deepEqual(ev(row('live', 1, 0, 3, '0:00', 'mlb'), row('live', 2, 0, 3, '0:00', 'mlb')), ['score']);
});

// ------------------------------------------------------ the NBA sport chip

test('the NBA chip is listed, and drawn only when the window holds NBA games or it is selected', () => {
  assert.ok(SPORTS.some(([k]) => k === 'nba'));
  assert.equal(sportChipShown('nba', { leagues: ['nfl', 'mlb'], selected: 'all' }), false);
  assert.equal(sportChipShown('nba', { leagues: ['nfl', 'nba'], selected: 'all' }), true);
  assert.equal(sportChipShown('nba', { leagues: [], selected: 'nba' }), true);
  assert.equal(sportChipShown('nba', {}), false);
  for (const k of ['all', 'nfl', 'cfb', 'mlb']) assert.equal(sportChipShown(k, { leagues: [] }), true, k);
});
