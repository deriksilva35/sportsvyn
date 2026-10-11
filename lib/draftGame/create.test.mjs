// lib/draftGame/create.test.mjs - which NFL games get a Game Draft (sun-2: primetime only). PURE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrimetimeNfl, SPORTS } from './create.js';

test('primetime only: Thursday and Monday nights (and any standalone weekday game) - by the ET day', () => {
  assert.equal(isPrimetimeNfl('2026-10-16T00:15:00Z'), true, 'TNF 8:15 PM ET is Thursday, though it is Friday in UTC');
  assert.equal(isPrimetimeNfl('2026-10-13T00:15:00Z'), true, 'MNF 8:15 PM ET is Monday');
  assert.equal(isPrimetimeNfl('2026-12-25T21:30:00Z'), true, 'a Christmas Friday game');
  assert.equal(isPrimetimeNfl('2026-12-23T18:00:00Z'), true, 'a standalone Wednesday');
});

test('weekend games get no board: the Sunday slate, Sunday night, late-season Saturdays', () => {
  assert.equal(isPrimetimeNfl('2026-10-11T17:00:00Z'), false, 'Sunday 1 PM ET');
  assert.equal(isPrimetimeNfl('2026-10-12T00:20:00Z'), false, 'SNF 8:20 PM ET is SUNDAY, though Monday in UTC');
  assert.equal(isPrimetimeNfl('2026-12-19T21:30:00Z'), false, 'a Saturday');
});

test('the filter is NFL-only', () => {
  assert.equal(typeof SPORTS.nfl.gameFilter, 'function');
  assert.equal(SPORTS.nfl.gameFilter({ kickoff_at: '2026-10-11T17:00:00Z' }), false);
  assert.equal(SPORTS.nba.gameFilter, null);
});
