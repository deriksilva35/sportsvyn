// lib/games/personal.test.mjs - the reader's own record. PURE.
//
// THE CONTRACT THESE ENFORCE is stronger than "do not leak someone else's
// score": the reader's OWN entry on a day that has not revealed must contribute
// NOTHING here, because these are standings rather than a receipt. The
// byte-identical assertion lives in personalLeak.test.mjs against the real
// query; these pin the arithmetic and the shapes it produces.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { youCell, yourStats, TIER_ORDER } = await import('./personal.js');
const { tierFor } = await import('../daily/reveal.js');

const day = (date, { score = null, locked = true, gs = null, gw = null, perfect = 100,
  season = 2019, week = 5 } = {}) => ({
  date, season_year: season, week, perfect,
  entry: score == null && gs == null ? null : {
    score, locked_at: locked ? '2026-08-16T04:00:00Z' : null,
    guess_season: gs, guess_week: gw, bonus_pct: 0,
  },
});

// ---------------------------------------------------------------------------
// THE YOU CELL
// ---------------------------------------------------------------------------

test('a signed-out reader gets UNDEFINED, not a null cell', () => {
  // undefined is dropped by JSON.stringify, so the column cannot render at all.
  // A `you: null` on every row is a per-user shape on a payload with no user.
  const c = youCell({ signedIn: false, entry: { score: 90, locked_at: 'x' }, perfect: 100 });
  assert.equal(c, undefined);
  assert.equal('you' in JSON.parse(JSON.stringify({ ...(c === undefined ? {} : { you: c }) })), false);
});

test('a played day carries the score and the tier off the same ladder', () => {
  const c = youCell({ signedIn: true, entry: { score: 91.2, locked_at: 'x' }, perfect: 140 });
  assert.equal(c.played, true);
  assert.equal(c.score, 91.2);
  assert.equal(c.tier, tierFor(91.2, 140).label);
});

test('an unplayed day and a DNF both get played:false, never a zero', () => {
  for (const e of [null, { score: null, locked_at: 'x' }, { score: 50, locked_at: null }]) {
    const c = youCell({ signedIn: true, entry: e, perfect: 100 });
    assert.equal(c.played, false, `${JSON.stringify(e)} must not read as a result`);
    assert.equal('score' in c, false, 'a zero would be a lie and a null would get printed');
  }
});

// ---------------------------------------------------------------------------
// THE RECORD
// ---------------------------------------------------------------------------

test('signed out gets nothing at all', () => {
  assert.equal(yourStats({ signedIn: false, days: [day('2026-08-16', { score: 90 })] }), null);
});

test('no revealed days yet means no module, not an empty one', () => {
  assert.equal(yourStats({ signedIn: true, days: [] }), null);
});

test('played counts locked, scored days against every revealed day', () => {
  const s = yourStats({ signedIn: true, days: [
    day('2026-08-18', { score: 80 }),
    day('2026-08-17'),                              // never played
    day('2026-08-16', { score: 60, locked: false }), // DNF
  ] });
  assert.equal(s.playable, 3);
  assert.equal(s.played, 1, 'a DNF is not a play');
});

test('avg pct-of-perfect is the mean of the pcts, to one decimal', () => {
  const s = yourStats({ signedIn: true, days: [
    day('2026-08-18', { score: 90, perfect: 100 }),
    day('2026-08-17', { score: 60, perfect: 100 }),
  ] });
  assert.equal(s.avgPct, 75);
});

test('best score names its edition, and TIES GO TO THE OLDER ONE', () => {
  // The first time you hit a number is when you did it; a later equal score
  // did not beat it. days arrives newest first, so this only holds if the
  // comparison is strictly greater-than.
  const s = yourStats({ signedIn: true, days: [
    day('2026-08-18', { score: 88 }),
    day('2026-08-17', { score: 88 }),
    day('2026-08-16', { score: 70 }),
  ] });
  assert.equal(s.best.score, 88);
  assert.equal(s.best.date, '2026-08-17', 'the earlier day owns the record');
});

test('tier counts cover every tier, and unearned ones are zero not absent', () => {
  const s = yourStats({ signedIn: true, days: [day('2026-08-16', { score: 96, perfect: 100 })] });
  assert.deepEqual(Object.keys(s.tiers).sort(), [...TIER_ORDER].sort());
  assert.equal(s.tiers['HALL OF FAME'], 1);
  assert.equal(s.tiers.MVP, 0);
});

test('THE GUESS RECORD COUNTS ONLY DAYS A GUESS WAS MADE', () => {
  // Counting an unguessed day as a miss punishes not playing an optional bonus.
  // `guessed` carries the denominator so the record cannot be misread.
  const s = yourStats({ signedIn: true, days: [
    day('2026-08-19', { score: 80, gs: 2019, gw: 5 }),   // exact
    day('2026-08-18', { score: 80, gs: 2019, gw: 9 }),   // season only
    day('2026-08-17', { score: 80, gs: 2001, gw: 1 }),   // missed
    day('2026-08-16', { score: 80 }),                    // no guess at all
  ] });
  assert.deepEqual(s.guess, { guessed: 3, exact: 1, seasonRight: 1, missed: 1 });
  assert.equal(s.guess.exact + s.guess.seasonRight + s.guess.missed, s.guess.guessed);
  assert.equal(s.played, 4, 'the unguessed day still counts as played');
});

test('streak is consecutive from the most recent REVEALED day', () => {
  const s = yourStats({ signedIn: true, days: [
    day('2026-08-19', { score: 80 }),
    day('2026-08-18', { score: 80 }),
    day('2026-08-17'),                    // break
    day('2026-08-16', { score: 80 }),
  ] });
  assert.equal(s.streak, 2);
});

test('a DNF BREAKS the streak - the board was seen and no lineup was locked', () => {
  const s = yourStats({ signedIn: true, days: [
    day('2026-08-18', { score: 60, locked: false }),
    day('2026-08-17', { score: 80 }),
  ] });
  assert.equal(s.streak, 0);
});

test('a reader who has played nothing gets zeroes, not null', () => {
  // "0 of 3" is true and useful. A missing module reads as a broken feature.
  const s = yourStats({ signedIn: true, days: [day('2026-08-16'), day('2026-08-15')] });
  assert.equal(s.played, 0);
  assert.equal(s.playable, 2);
  assert.equal(s.avgPct, null, 'no plays means no average, not 0%');
  assert.equal(s.best, null);
  assert.equal(s.streak, 0);
});

test('a day with no perfect total does not produce a NaN average', () => {
  const s = yourStats({ signedIn: true, days: [
    day('2026-08-18', { score: 80, perfect: null }),
    day('2026-08-17', { score: 80, perfect: 100 }),
  ] });
  assert.equal(s.avgPct, 80, 'the unscoreable day is skipped, not counted as zero');
  assert.equal(Number.isNaN(s.avgPct), false);
});

test('the record carries an EXACT key set', () => {
  const s = yourStats({ signedIn: true, days: [day('2026-08-16', { score: 80 })] });
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(s))).sort(),
    ['avgPct', 'best', 'guess', 'playable', 'played', 'streak', 'tiers'].sort());
});
