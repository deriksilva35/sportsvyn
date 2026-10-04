// lib/time/display.test.mjs - the one formatter (sun-16 item B).
//
// THE DEFECT: three clocks for one first pitch. The lobby printed Eastern under
// a header naming the reader's zone ("first lock Sat 7:30 AM" in Los Angeles
// and in London alike), /october printed "1:00 PM PT", the MLB game page
// "4:00 PM EDT". Every displayed time now goes through lib/time/display.js in
// the reader's zone, labelled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeLabel, dateLabel, dateTimeLabel, dayKeyIn, weekdayLong, zoneAbbr, zoneOpt, FALLBACK_LABEL } from './display.js';
import { playTimeLabel, playDateLabel } from '../games/playTime.js';
import { standaloneTimeLabel } from './standaloneLabel.js';

// 2026-10-04T23:40:00Z: 7:40 PM EDT Sunday, 4:40 PM PDT Sunday, 12:40 AM BST MONDAY.
const ISO = '2026-10-04T23:40:00Z';

test('ONE INSTANT, EACH READER\'S OWN CLOCK, ALWAYS LABELLED', () => {
  assert.equal(timeLabel(ISO, { tz: 'America/New_York' }), '7:40 PM EDT');
  assert.equal(timeLabel(ISO, { tz: 'America/Los_Angeles' }), '4:40 PM PDT');
  assert.equal(timeLabel(ISO, { tz: 'Europe/London' }), '12:40 AM BST');
  assert.equal(timeLabel(ISO, { tz: 'UTC' }), '11:40 PM UTC');
});

test('THE FALLBACK IS EASTERN AND SAYS SO - never an unlabelled guess', () => {
  // tz null is the server's first paint with no sv_tz cookie yet.
  assert.equal(timeLabel(ISO, { tz: null }), '7:40 PM ET');
  assert.equal(FALLBACK_LABEL, 'ET');
  // An absent tz is the fallback too (the server-side default).
  assert.equal(timeLabel(ISO), '7:40 PM ET');
  assert.equal(dateTimeLabel(ISO), 'Sun Oct 4 · 7:40 PM ET');
});

test('tz: undefined IS THE RUNNING ZONE, NOT THE FALLBACK (the thu-26 / lobby bug)', () => {
  // A destructuring default `{ tz = null }` turns undefined into Eastern.
  // Compared against this process's own zone, whatever the box runs in.
  const want = timeLabel(ISO, { tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  assert.equal(timeLabel(ISO, { tz: undefined }), want);
  // And the Play lobby's wrapper - where the bug lived until this relay -
  // passes undefined through rather than defaulting it away.
  assert.equal(playTimeLabel(ISO, { tz: 'Europe/London', now: '2026-10-01T12:00:00Z' }), 'Mon 12:40 AM');
  assert.equal(playTimeLabel(ISO, { tz: undefined, now: '2026-10-01T12:00:00Z' }),
    timeLabel(ISO, { tz: undefined, weekday: true, zone: false }));
  assert.notEqual(playTimeLabel(ISO, { tz: 'Europe/London', now: '2026-10-01T12:00:00Z' }),
    playTimeLabel(ISO, { tz: null, now: '2026-10-01T12:00:00Z' }));
  assert.equal(playDateLabel(ISO, { tz: 'Europe/London' }), 'Mon 5 Oct');
  assert.equal(playDateLabel(ISO, { tz: null }), 'Sun 4 Oct');
});

test('THE DAY COMES WITH THE HOUR: a London reader\'s 12:40 AM is MONDAY', () => {
  assert.equal(timeLabel(ISO, { tz: 'Europe/London', weekday: true }), 'Mon 12:40 AM BST');
  assert.equal(timeLabel(ISO, { tz: 'America/Los_Angeles', weekday: true }), 'Sun 4:40 PM PDT');
  assert.equal(dateLabel(ISO, { tz: 'Europe/London' }), 'Mon Oct 5');
  assert.equal(dateLabel(ISO, { tz: 'Europe/London', order: 'dm', weekday: false }), '5 Oct');
  assert.equal(dateTimeLabel(ISO, { tz: 'Europe/London' }), 'Mon Oct 5 · 12:40 AM BST');
  assert.equal(dayKeyIn(ISO, { tz: 'Europe/London' }), '2026-10-05');
  assert.equal(dayKeyIn(ISO, { tz: null }), '2026-10-04');
  assert.equal(weekdayLong(ISO, { tz: 'Europe/London' }), 'Monday');
});

test('zone labels read like zones: BST and CEST, not GMT+1 and GMT+2', () => {
  assert.equal(zoneAbbr(ISO, 'Europe/London'), 'BST');
  assert.equal(zoneAbbr('2026-12-01T12:00:00Z', 'Europe/London'), 'GMT');
  assert.equal(zoneAbbr(ISO, 'Europe/Paris'), 'CEST');
  assert.equal(zoneAbbr('2026-12-01T12:00:00Z', 'America/New_York'), 'EST');
  // A zone with no abbreviation anywhere keeps its honest offset.
  assert.match(zoneAbbr(ISO, 'Asia/Kathmandu'), /^GMT\+5:45$/);
  assert.equal(zoneAbbr(ISO, null), 'ET');
});

test('zone off drops the label; nothing in, nothing out', () => {
  assert.equal(timeLabel(ISO, { tz: 'Europe/London', zone: false }), '12:40 AM');
  assert.equal(timeLabel(null), '');
  assert.equal(timeLabel('not a date'), '');
  assert.equal(dateTimeLabel(''), '');
  assert.deepEqual(zoneOpt(null), { timeZone: 'America/New_York' });
  assert.deepEqual(zoneOpt(undefined), {});
  assert.deepEqual(zoneOpt('Europe/London'), { timeZone: 'Europe/London' });
});

test('standaloneTimeLabel IS timeLabel - one formatter, two names', () => {
  assert.equal(standaloneTimeLabel, timeLabel);
});
