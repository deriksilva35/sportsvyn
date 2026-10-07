// lib/time/kickoffTimeLabel.test.mjs - the ONE "Time TBD" formatter (tue-10,
// Time TBD everywhere), and isKickoffTbd, the one flag reader for data layers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kickoffTimeLabel, dateTimeKickoffLabel, timeLabel, dateTimeLabel, TIME_TBD } from './display.js';
import { isKickoffTbd, isPlaceholderKickoff, TIME_TBD as REEXPORT } from '../mlb/kickoffTbd.js';

// 2026-10-11T04:00:00Z is midnight Eastern (EDT): BDL's "no time yet".
const PLACEHOLDER = '2026-10-11T04:00:00Z';
const REAL = '2026-10-11T23:08:00Z'; // 7:08 PM EDT

test('one spelling: kickoffTbd.js re-exports the display.js constant', () => {
  assert.equal(TIME_TBD, 'Time TBD');
  assert.equal(REEXPORT, TIME_TBD);
});

test('kickoffTimeLabel: tbd prints Time TBD in every zone, never a clock', () => {
  for (const tz of [null, undefined, 'America/Los_Angeles', 'Europe/London']) {
    assert.equal(kickoffTimeLabel(PLACEHOLDER, { tz, tbd: true }), 'Time TBD');
  }
  assert.equal(kickoffTimeLabel(PLACEHOLDER, { tz: null, tbd: true, weekday: true, zone: false }), 'Time TBD');
  assert.equal(kickoffTimeLabel(null, { tbd: true }), 'Time TBD');
});

test('kickoffTimeLabel: not tbd is exactly timeLabel (tz contract intact)', () => {
  for (const opts of [{ tz: null }, { tz: 'America/Los_Angeles' }, { tz: null, weekday: true }, { tz: undefined }, { tz: null, tbd: false }]) {
    assert.equal(kickoffTimeLabel(REAL, opts), timeLabel(REAL, opts));
  }
  assert.equal(kickoffTimeLabel(REAL, { tz: null }), '7:08 PM ET');
  assert.equal(kickoffTimeLabel(REAL, { tz: 'America/Los_Angeles' }), '4:08 PM PDT');
  // tbd must be exactly true: a truthy string is not the flag
  assert.equal(kickoffTimeLabel(REAL, { tz: null, tbd: 'false' }), '7:08 PM ET');
});

test('the placeholder WITHOUT the flag is the fake clock this change exists to stop', () => {
  assert.equal(kickoffTimeLabel(PLACEHOLDER, { tz: null }), '12:00 AM ET');
  assert.equal(kickoffTimeLabel(PLACEHOLDER, { tz: 'America/Los_Angeles' }), '9:00 PM PDT');
});

test('dateTimeKickoffLabel: the date, then "· Time TBD"; otherwise dateTimeLabel', () => {
  assert.equal(dateTimeKickoffLabel(PLACEHOLDER, { tz: null, tbd: true }), 'Sun Oct 11 · Time TBD');
  assert.equal(dateTimeKickoffLabel(REAL, { tz: null }), dateTimeLabel(REAL, { tz: null }));
  assert.equal(dateTimeKickoffLabel(REAL, { tz: 'America/Los_Angeles', tbd: false }), dateTimeLabel(REAL, { tz: 'America/Los_Angeles' }));
  assert.equal(dateTimeKickoffLabel(null, { tbd: true }), 'Time TBD');
  // the TBD day is the ET day: midnight ET is the evening before in Los Angeles
  assert.equal(dateTimeKickoffLabel(PLACEHOLDER, { tz: 'America/Los_Angeles', tbd: true }), 'Sun Oct 11 · Time TBD');
});

test('isKickoffTbd: the stored flag, in any selected shape', () => {
  assert.equal(isKickoffTbd({ metadata: { kickoff_tbd: true } }), true);
  assert.equal(isKickoffTbd({ kickoff_tbd: true }), true);
  assert.equal(isKickoffTbd({ kickoffTbd: true }), true);
  assert.equal(isKickoffTbd({ metadata: { kickoff_tbd: false }, kickoff_at: REAL }), false);
  assert.equal(isKickoffTbd({ metadata: {}, kickoff_at: REAL }), false);
  assert.equal(isKickoffTbd(null), false);
  assert.equal(isKickoffTbd(undefined), false);
});

test('isKickoffTbd: the clock fallback applies to MLB rows only', () => {
  assert.equal(isPlaceholderKickoff(PLACEHOLDER), true);
  assert.equal(isKickoffTbd({ kickoff_at: PLACEHOLDER, league_slug: 'mlb' }), true);
  assert.equal(isKickoffTbd({ kickoffAt: PLACEHOLDER, leagueSlug: 'mlb' }), true);
  assert.equal(isKickoffTbd({ kickoff_at: PLACEHOLDER }, { mlb: true }), true);
  assert.equal(isKickoffTbd({ kickoff_at: REAL, league_slug: 'mlb' }), false);
  // a non-MLB row at midnight ET is NOT a placeholder: only the stored flag can say so
  assert.equal(isKickoffTbd({ kickoff_at: PLACEHOLDER, league_slug: 'nfl' }), false);
  assert.equal(isKickoffTbd({ kickoff_at: PLACEHOLDER, leagueSlug: 'epl' }), false);
  assert.equal(isKickoffTbd({ kickoff_at: PLACEHOLDER }), false);
});
