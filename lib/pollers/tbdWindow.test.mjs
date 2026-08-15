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

const { isTbdPlaceholder, classifyWindowRows, etHourMinute } = await import('./liveWindow.js');

// Midnight ET is 04:00Z under EDT and 05:00Z under EST - both must read 00:00.
const MIDNIGHT_EDT = '2026-09-26T04:00:00.000Z';   // 26 Sep, EDT
const MIDNIGHT_EST = '2026-11-21T05:00:00.000Z';   // 21 Nov, EST
const REAL_1930 = '2026-09-26T23:30:00.000Z';      // 19:30 ET
const REAL_1200 = '2026-09-26T16:00:00.000Z';      // 12:00 ET

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
  const out = classifyWindowRows(rows);
  assert.equal(out.live, false, '42 placeholders must not open a window');
  assert.equal(out.considered, 42);
  assert.equal(out.tbdExcluded, 42);
});

test('(b) placeholders + one real 19:30 kickoff: the window comes from the real one', () => {
  const rows = [...Array.from({ length: 40 }, () => g(MIDNIGHT_EDT)), g(REAL_1930)];
  const out = classifyWindowRows(rows);
  assert.equal(out.live, true, 'the real kickoff opens the window');
  assert.equal(out.considered, 41);
  assert.equal(out.tbdExcluded, 40, 'and the placeholders are still excluded, not merely outvoted');
});

test('(c) a placeholder that gains a real time enters the window on the next computation', () => {
  const before = classifyWindowRows([g(MIDNIGHT_EDT)]);
  assert.equal(before.live, false);
  assert.equal(before.tbdExcluded, 1);

  // CFBD assigns the slot; same row, real kickoff now.
  const after = classifyWindowRows([g(REAL_1200)]);
  assert.equal(after.live, true, 'nothing sticky about the exclusion - it is recomputed each tick');
  assert.equal(after.tbdExcluded, 0);
});

test('(d) STATUS OUTRANKS THE HEURISTIC: a live game is never excluded', () => {
  // A game the feed says is being played, still carrying a midnight kickoff.
  // A rule about missing data must never hide a game that is actually on.
  const out = classifyWindowRows([g(MIDNIGHT_EDT, 'live')]);
  assert.equal(out.live, true);
  assert.equal(out.tbdExcluded, 0);
  assert.equal(isTbdPlaceholder({ kickoffAt: MIDNIGHT_EDT, status: 'live' }), false);
  // And the winter spelling of the same case.
  assert.equal(isTbdPlaceholder({ kickoffAt: MIDNIGHT_EST, status: 'live' }), false);
});

test('only midnight exactly - 00:01 and 23:59 ET are real kickoffs', () => {
  assert.equal(isTbdPlaceholder({ kickoffAt: '2026-09-26T04:01:00.000Z', status: 'scheduled' }), false, '00:01 ET');
  assert.equal(isTbdPlaceholder({ kickoffAt: '2026-09-26T03:59:00.000Z', status: 'scheduled' }), false, '23:59 ET');
  assert.equal(isTbdPlaceholder({ kickoffAt: MIDNIGHT_EDT, status: 'scheduled' }), true);
});

test('a real NFL slate is untouched by the rule', () => {
  // 15 Aug: 13:00, 16:00, 19:00, 20:00 ET. Nothing here is midnight.
  const rows = ['17:00', '20:00', '23:00'].map((t) => g(`2026-08-15T${t}:00.000Z`))
    .concat([g('2026-08-16T00:00:00.000Z')]); // 20:00 ET - a UTC midnight, NOT an ET one
  const out = classifyWindowRows(rows);
  assert.equal(out.tbdExcluded, 0, 'UTC midnight is not ET midnight - the rule must not confuse them');
  assert.equal(out.live, true);
});

test('an unparseable kickoff is not a placeholder, and does not throw', () => {
  assert.equal(isTbdPlaceholder({ kickoffAt: null, status: 'scheduled' }), false);
  assert.equal(isTbdPlaceholder({ kickoffAt: 'not-a-date', status: 'scheduled' }), false);
  assert.equal(etHourMinute('not-a-date'), null);
});

test('empty input is not a live window', () => {
  const out = classifyWindowRows([]);
  assert.deepEqual(out, { live: false, considered: 0, tbdExcluded: 0 });
  assert.deepEqual(classifyWindowRows(undefined), { live: false, considered: 0, tbdExcluded: 0 });
});

test('classifyWindowRows accepts both row shapes (kickoff_at and kickoffAt)', () => {
  assert.equal(classifyWindowRows([{ kickoff_at: MIDNIGHT_EDT, status: 'scheduled' }]).tbdExcluded, 1);
  assert.equal(classifyWindowRows([{ kickoffAt: MIDNIGHT_EDT, status: 'scheduled' }]).tbdExcluded, 1);
});
