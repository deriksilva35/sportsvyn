// lib/pollers/tbdWindow.test.mjs - a midnight-ET kickoff is a null, not a time.
//
// CFBD publishes a college game whose slot is not yet assigned with a midnight
// ET kickoff. From late September 2026 most of a CFB Saturday carries one (42
// of 65 on 26 Sep, 44 of 52 on 17 Oct), and with PRE 45min / POST 5h that holds
// the live window open ~22 hours a day, every Saturday, all autumn.
//
// PURE. The rule is a predicate over {kickoffAt, status}, so it is tested here
// without a database and without waiting for a Saturday in October.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { isTbdPlaceholder, classifyWindowRows, etHourMinute, isInWindow } = await import('./liveWindow.js');
const { LIVE_WINDOW_PRE_MIN, LIVE_WINDOW_POST_HOURS } = await import('./cadence.js');

// A LATE-SEPTEMBER SUNDAY, 01:00 ET. Chosen so both kinds of row are genuinely
// candidates at the same instant: the Sunday midnight-ET placeholders kicked an
// hour ago, and a real Saturday-night game that kicked 20:30 ET is 4.5h in, still
// inside the 5h post-pad. Testing them at a clock where only one could be in the
// window would prove nothing about the rule that separates them.
const NOW_OVERNIGHT = new Date('2026-09-27T05:00:00.000Z');  // 01:00 ET Sun
const MIDNIGHT_EDT = '2026-09-27T04:00:00.000Z';   // 00:00 ET Sun, EDT
const REAL_2030 = '2026-09-27T00:30:00.000Z';      // 20:30 ET Sat, still in its post-pad
const REAL_1200 = '2026-09-27T04:30:00.000Z';      // 00:30 ET - a real slot near the placeholders

// The winter spelling, for the DST case: 00:00 ET is 05:00Z under EST.
const MIDNIGHT_EST = '2026-11-22T05:00:00.000Z';
const NOW_EST = new Date('2026-11-22T06:00:00.000Z');
const REAL_1930 = '2026-09-26T23:30:00.000Z';      // 19:30 ET, for clock-reading only

const g = (kickoffAt, status = 'scheduled') => ({ kickoff_at: kickoffAt, status });

// ---------------------------------------------------------------------------

test('the ET clock reading is DST-correct in both directions', () => {
  assert.equal(etHourMinute(MIDNIGHT_EDT), '00:00', 'EDT: midnight ET is 04:00Z');
  assert.equal(etHourMinute(MIDNIGHT_EST), '00:00', 'EST: midnight ET is 05:00Z');
  assert.equal(etHourMinute(REAL_1930), '19:30');
  // The trap this guards: reading 05:00Z as midnight year-round would classify
  // a real 1am ET kickoff as a placeholder every summer, and miss every real
  // placeholder every winter.
  assert.equal(etHourMinute('2026-09-26T05:00:00.000Z'), '01:00', 'EDT: 05:00Z is 1am, NOT a placeholder');
});

test('(a) a slate of only midnight placeholders yields NO live window', () => {
  const rows = Array.from({ length: 42 }, () => g(MIDNIGHT_EDT));
  const out = classifyWindowRows(rows, NOW_OVERNIGHT);
  assert.equal(out.live, false, '42 placeholders must not open a window');
  assert.equal(out.considered, 42, 'they ARE in the window by time - that is the whole problem');
  assert.equal(out.tbdExcluded, 42);
});

test('(b) placeholders + one real kickoff: the window comes from the real one', () => {
  const rows = [...Array.from({ length: 40 }, () => g(MIDNIGHT_EDT)), g(REAL_2030, 'live')];
  const out = classifyWindowRows(rows, NOW_OVERNIGHT);
  assert.equal(out.live, true, 'the real kickoff opens the window');
  assert.equal(out.considered, 41);
  assert.equal(out.tbdExcluded, 40, 'and the placeholders are still excluded, not merely outvoted');
});

test('(c) a placeholder that gains a real time enters the window on the next computation', () => {
  const before = classifyWindowRows([g(MIDNIGHT_EDT)], NOW_OVERNIGHT);
  assert.equal(before.live, false);
  assert.equal(before.tbdExcluded, 1);

  // CFBD assigns the slot; same game, real kickoff now, still inside the window.
  const after = classifyWindowRows([g(REAL_1200)], NOW_OVERNIGHT);
  assert.equal(after.live, true, 'nothing sticky about the exclusion - it is recomputed each tick');
  assert.equal(after.tbdExcluded, 0);
});

test('(d) STATUS OUTRANKS THE HEURISTIC: a live game is never excluded', () => {
  // A game the feed says is being played, still carrying a midnight kickoff.
  // A rule about missing data must never hide a game that is actually on.
  const out = classifyWindowRows([g(MIDNIGHT_EDT, 'live')], NOW_OVERNIGHT);
  assert.equal(out.live, true);
  assert.equal(out.tbdExcluded, 0);
  assert.equal(isTbdPlaceholder({ kickoffAt: MIDNIGHT_EDT, status: 'live' }), false);
  // And the winter spelling of the same case.
  assert.equal(classifyWindowRows([g(MIDNIGHT_EST, 'live')], NOW_EST).live, true);
  assert.equal(isTbdPlaceholder({ kickoffAt: MIDNIGHT_EST, status: 'live' }), false);
});

test('the EST placeholder is excluded too - the rule is not summer-only', () => {
  const out = classifyWindowRows([g(MIDNIGHT_EST)], NOW_EST);
  assert.equal(out.live, false);
  assert.equal(out.tbdExcluded, 1);
});

test('only midnight exactly - 00:01 and 23:59 ET are real kickoffs', () => {
  assert.equal(isTbdPlaceholder({ kickoffAt: '2026-09-26T04:01:00.000Z', status: 'scheduled' }), false, '00:01 ET');
  assert.equal(isTbdPlaceholder({ kickoffAt: '2026-09-26T03:59:00.000Z', status: 'scheduled' }), false, '23:59 ET');
  assert.equal(isTbdPlaceholder({ kickoffAt: MIDNIGHT_EDT, status: 'scheduled' }), true);
});

test('a real NFL slate is untouched by the rule', () => {
  // 15 Aug: 20:00 ET kicked at 2026-08-16T00:00:00Z - a UTC midnight, NOT an ET
  // one. The rule must not confuse the two clocks.
  const nowAug = new Date('2026-08-16T01:00:00.000Z'); // 21:00 ET
  const out = classifyWindowRows([g('2026-08-16T00:00:00.000Z', 'live')], nowAug);
  assert.equal(out.tbdExcluded, 0, 'UTC midnight is not ET midnight');
  assert.equal(out.live, true);
  assert.equal(etHourMinute('2026-08-16T00:00:00.000Z'), '20:00');
});

test('an unparseable kickoff is not a placeholder, and does not throw', () => {
  assert.equal(isTbdPlaceholder({ kickoffAt: null, status: 'scheduled' }), false);
  assert.equal(isTbdPlaceholder({ kickoffAt: 'not-a-date', status: 'scheduled' }), false);
  assert.equal(etHourMinute('not-a-date'), null);
  // ...and it is not a window candidate either, rather than a crash or a true.
  assert.equal(isInWindow({ kickoffAt: 'not-a-date', status: 'scheduled' }, NOW_OVERNIGHT), false);
});

test('empty input is not a live window', () => {
  const out = classifyWindowRows([], NOW_OVERNIGHT);
  assert.deepEqual(out, { live: false, considered: 0, tbdExcluded: 0 });
  assert.deepEqual(classifyWindowRows(undefined, NOW_OVERNIGHT), { live: false, considered: 0, tbdExcluded: 0 });
});

test('classifyWindowRows accepts both row shapes (kickoff_at and kickoffAt)', () => {
  assert.equal(classifyWindowRows([{ kickoff_at: MIDNIGHT_EDT, status: 'scheduled' }], NOW_OVERNIGHT).tbdExcluded, 1);
  assert.equal(classifyWindowRows([{ kickoffAt: MIDNIGHT_EDT, status: 'scheduled' }], NOW_OVERNIGHT).tbdExcluded, 1);
});

// ---------------------------------------------------------------------------
// THE WINDOW ITSELF - moved here from pollersDb.test.mjs.
//
// These four cases used to insert a 'polltest-' row and assert a LEAGUE-WIDE
// boolean, so any other real game in the window answered for them. The two
// negative cases failed on every evening with football on - twice this week -
// and passed on quiet nights for no better reason. Same assertions, fixtures,
// a fixed clock: they now fail only when the rule is wrong.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-17T20:00:00.000Z'); // 16:00 ET, mid-October Saturday
const at = (minsFromNow, status = 'scheduled') =>
  ({ kickoff_at: new Date(NOW.getTime() + minsFromNow * 60_000).toISOString(), status });

test('a game in progress (kickoff 90min ago, not final) -> in window', () => {
  assert.equal(classifyWindowRows([at(-90, 'live')], NOW).live, true);
});

test('a game 30min before kickoff (within the 45min pre-pad) -> in window', () => {
  assert.equal(classifyWindowRows([at(30)], NOW).live, true);
});

test('a POSTPONED game in the window is excluded -> not live', () => {
  const out = classifyWindowRows([at(-60, 'postponed')], NOW);
  assert.equal(out.live, false);
  assert.equal(out.considered, 0, 'postponed never becomes a candidate at all');
  assert.equal(out.tbdExcluded, 0, 'and it is not miscounted as a TBD');
});

test('a game 6h past kickoff (beyond the 5h post-pad) -> not live', () => {
  assert.equal(classifyWindowRows([at(-360, 'live')], NOW).live, false);
});

test('final and cancelled are excluded on the same rule as postponed', () => {
  for (const s of ['final', 'cancelled', 'postponed']) {
    assert.equal(isInWindow({ kickoffAt: at(-60).kickoff_at, status: s }, NOW), false, s);
  }
  assert.equal(isInWindow({ kickoffAt: at(-60).kickoff_at, status: 'live' }, NOW), true);
});

test('the pads are exactly the cadence constants, at both edges', () => {
  // Inside by a minute at each end, outside by a minute at each end.
  assert.equal(isInWindow({ kickoffAt: at(LIVE_WINDOW_PRE_MIN - 1).kickoff_at, status: 'scheduled' }, NOW), true);
  assert.equal(isInWindow({ kickoffAt: at(LIVE_WINDOW_PRE_MIN + 1).kickoff_at, status: 'scheduled' }, NOW), false);
  assert.equal(isInWindow({ kickoffAt: at(-(LIVE_WINDOW_POST_HOURS * 60) + 1).kickoff_at, status: 'live' }, NOW), true);
  assert.equal(isInWindow({ kickoffAt: at(-(LIVE_WINDOW_POST_HOURS * 60) - 1).kickoff_at, status: 'live' }, NOW), false);
});

test('THE CONTAMINATION THAT CAUSED THIS MOVE: another game cannot answer for the fixture', () => {
  // A postponed game plus a real live one. The old league-wide boolean returned
  // true and the postponed assertion "passed" for the wrong reason - or failed,
  // depending on the evening. Per-game, the postponed one is still excluded.
  const rows = [at(-60, 'postponed'), at(-90, 'live')];
  assert.equal(isInWindow({ kickoffAt: rows[0].kickoff_at, status: 'postponed' }, NOW), false);
  assert.equal(classifyWindowRows(rows, NOW).considered, 1, 'only the live game is a candidate');
});
