// lib/live/baseballVocabulary.test.mjs - shortOf learns a sport, and football
// does not notice.
//
// THE RISK THIS FILE EXISTS FOR IS NOT BASEBALL. shortOf() is the derivation
// the scoreboard chip, the drive strip, the line score, the Pick'em row and the
// Live Activity all go through; a sport argument added to it can break every
// live football surface at once. So the football half is pinned FIRST and
// pinned as "identical with the argument omitted, passed explicitly, or passed
// as a sport nobody has heard of" - three ways of saying the default is a
// no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortOf, finalShortOf, hasClock, ordinal, sportOf,
  FOOTBALL, BASEBALL, SOCCER,
} from './vocabulary.js';

// ------------------------------------------------------- football unchanged

test('FOOTBALL IS BYTE-IDENTICAL with the sport omitted, explicit, or unknown', () => {
  const cases = [
    [{ period: 1, clock: '7:22' }, 'Q1'],
    [{ period: 3, clock: '0:04' }, 'Q3'],
    [{ period: 4, clock: '00:00' }, 'Q4'],
    [{ period: 2, clock: '0:00' }, 'HT'],
    [{ period: 2, clock: '00:00' }, 'HT'],
    [{ period: 5, clock: '9:11' }, 'OT'],
    [{ short: 'ht', clock: '' }, 'HT'],
    [{ period: 0, clock: '1:00' }, null],
    [null, null],
  ];
  for (const [state, want] of cases) {
    assert.equal(shortOf(state), want, `omitted: ${JSON.stringify(state)}`);
    assert.equal(shortOf(state, FOOTBALL), want, `explicit: ${JSON.stringify(state)}`);
    // A sport this module has never heard of must not silently become
    // baseball - it falls to the football path, which is what these callers
    // already do today.
    assert.equal(shortOf(state, 'quidditch'), want, `unknown: ${JSON.stringify(state)}`);
  }
  assert.equal(hasClock(), true);
  assert.equal(hasClock(FOOTBALL), true);
  assert.equal(finalShortOf(4), 'Final');
  assert.equal(finalShortOf(5), 'F/OT');
});

// ----------------------------------------------------------------- baseball

test('BASEBALL: the half and the inning, all four states', () => {
  const at = (period, half) => shortOf({ period, half, clock: 0 }, BASEBALL);
  assert.equal(at(7, 'Top'), 'Top 7th');
  assert.equal(at(7, 'Bottom'), 'Bot 7th');
  assert.equal(at(7, 'Mid'), 'Mid 7th');
  assert.equal(at(7, 'End'), 'End 7th');
  // BDL sends these capitalised; a feed that changes its mind about case must
  // not silently drop the half.
  assert.equal(at(7, 'top'), 'Top 7th');
  assert.equal(at(7, 'BOTTOM'), 'Bot 7th');
  assert.equal(at(1, 'Top'), 'Top 1st');
  assert.equal(at(2, 'Bottom'), 'Bot 2nd');
  assert.equal(at(3, 'Top'), 'Top 3rd');
  assert.equal(at(4, 'Top'), 'Top 4th');
});

test('BASEBALL: no half is still an inning, and a bad one is not invented', () => {
  // The half is the one field the provider can leave out. "7th" is true where
  // "Top 7th" would be a guess about which side is batting.
  assert.equal(shortOf({ period: 7, clock: 0 }, BASEBALL), '7th');
  assert.equal(shortOf({ period: 7, half: null }, BASEBALL), '7th');
  assert.equal(shortOf({ period: 7, half: 'Sideways' }, BASEBALL), '7th');
  // No inning at all is no label - never "Top" on its own.
  assert.equal(shortOf({ half: 'Top' }, BASEBALL), null);
  assert.equal(shortOf({ period: 0, half: 'Top' }, BASEBALL), null);
  assert.equal(shortOf(null, BASEBALL), null);
  // A stored `short` is taken verbatim and NOT upper-cased - "Top 7th" must
  // not come back "TOP 7TH", which is what the football branch would do.
  assert.equal(shortOf({ short: 'Top 7th' }, BASEBALL), 'Top 7th');
});

test('BASEBALL: extra innings read as innings, not as overtime', () => {
  assert.equal(shortOf({ period: 10, half: 'Top' }, BASEBALL), 'Top 10th');
  assert.equal(shortOf({ period: 11, half: 'Bottom' }, BASEBALL), 'Bot 11th');
  assert.equal(shortOf({ period: 13, half: 'Top' }, BASEBALL), 'Top 13th');
  assert.equal(shortOf({ period: 21, half: 'Top' }, BASEBALL), 'Top 21st');
  // The football branch would have said OT for every one of these.
  assert.equal(shortOf({ period: 10, clock: '1:00' }, FOOTBALL), 'OT');
});

test('THE ORDINAL, including the three the naive rule gets wrong', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(ordinal), ['1st', '2nd', '3rd', '4th', '5th', '9th']);
  // 11, 12, 13 are "th" despite ending 1, 2, 3 - and an extra-inning game
  // reaches all three.
  assert.deepEqual([11, 12, 13].map(ordinal), ['11th', '12th', '13th']);
  assert.deepEqual([21, 22, 23, 101, 111].map(ordinal), ['21st', '22nd', '23rd', '101st', '111th']);
  assert.equal(ordinal(0), null);
  assert.equal(ordinal(null), null);
  assert.equal(ordinal('x'), null);
});

test('THE FINAL CHIP names the inning only when it went past nine', () => {
  assert.equal(finalShortOf(9, BASEBALL), 'Final');
  assert.equal(finalShortOf(8, BASEBALL), 'Final', 'a rain-shortened eight is still just Final');
  assert.equal(finalShortOf(10, BASEBALL), 'F/10');
  assert.equal(finalShortOf(13, BASEBALL), 'F/13');
  assert.equal(finalShortOf(null, BASEBALL), 'Final');
  // Football keeps F/OT whatever the period - "F/5" would mean nothing there.
  assert.equal(finalShortOf(5, FOOTBALL), 'F/OT');
  assert.equal(finalShortOf(6, FOOTBALL), 'F/OT');
});

test('THE CLOCK IS NEVER RENDERED FOR BASEBALL', () => {
  // BDL sends clock 0 and display_clock "0:00" on every MLB row - scheduled,
  // live and final alike - so a surface that prints the clock puts a stopped
  // clock on a live game. Measured on the real feed 22 Sep 2026.
  assert.equal(hasClock(BASEBALL), false);
  assert.equal(hasClock(FOOTBALL), true);
  assert.equal(hasClock(SOCCER), true);
  // And the label itself never carries one, even when the state has a clock
  // key - the football branch would have folded '0:00' into an HT.
  assert.equal(shortOf({ period: 2, half: 'Top', clock: '0:00' }, BASEBALL), 'Top 2nd');
  assert.notEqual(shortOf({ period: 2, half: 'Top', clock: '0:00' }, BASEBALL), 'HT');
});

test('sportOf maps the leagues we hold, and an unknown one is football', () => {
  assert.equal(sportOf('nfl'), FOOTBALL);
  assert.equal(sportOf('cfb'), FOOTBALL);
  assert.equal(sportOf('mlb'), BASEBALL);
  assert.equal(sportOf('MLB'), BASEBALL, 'the slug is compared case-insensitively');
  assert.equal(sportOf('epl'), SOCCER);
  assert.equal(sportOf('fifa-wc-2026'), SOCCER);
  // UNKNOWN IS FOOTBALL ON PURPOSE - it is what these functions already did,
  // so a league added to the database before it is added here behaves exactly
  // as it does today rather than losing its label.
  assert.equal(sportOf('nhl'), FOOTBALL);
  assert.equal(sportOf(null), FOOTBALL);
  assert.equal(sportOf(''), FOOTBALL);
});
