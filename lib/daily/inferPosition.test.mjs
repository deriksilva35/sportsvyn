// lib/daily/inferPosition.test.mjs — the position-inference law, against
// four REAL 1995 rows (pulled from DEV's own raw stat columns, not
// invented) that prove the exact defect this law fixes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inferPosition } from './inferPosition.js';

test('Harvey Williams 1995 -> RB (255 rush att, 1 trick-play pass attempt)', () => {
  // real DEV row: pass_att=1, pass_yds=13, pass_td=1; rush_att=255,
  // rush_yds=1114, rush_td=9; rec=54, rec_yds=375 - the exact defect this
  // law fixes: the OLD inference read this as QB off the pass field's mere
  // presence, with a real 1,114-yard rushing season sitting right there.
  const row = {
    passAtt: 1, passYds: 13, passTd: 1,
    rushAtt: 255, rushYds: 1114, rushTd: 9,
    rec: 54, recYds: 375, recTd: 0,
  };
  assert.equal(inferPosition(row), 'RB');
});

test('Carl Pickens 1995 -> WR (99 catches, one end-around)', () => {
  // real DEV row: rush_att=1, rush_yds=6 (a trick play); rec=99,
  // rec_yds=1234, rec_td=17 - a real receiving season an order of
  // magnitude larger than the single rush.
  const row = { rushAtt: 1, rushYds: 6, rushTd: 0, rec: 99, recYds: 1234, recTd: 17 };
  assert.equal(inferPosition(row), 'WR');
});

test('Steve Young 1995 -> QB (447 pass attempts, real mobile-QB rushing too)', () => {
  // real DEV row: pass_att=447, pass_yds=3200, pass_td=20, pass_int=11;
  // rush_att=50, rush_yds=250, rush_td=3 - passing dwarfs the rushing, and
  // 447 clears the 100-attempt floor with room to spare.
  const row = {
    passAtt: 447, passYds: 3200, passTd: 20, passInt: 11,
    rushAtt: 50, rushYds: 250, rushTd: 3,
  };
  assert.equal(inferPosition(row), 'QB');
});

test('Norm Johnson 1995 -> K (pure kicker, nothing offensive at all)', () => {
  const row = { fgm: 34, fga: 41, xp: 39 };
  assert.equal(inferPosition(row), 'PK');
});

test('90 pass attempts with big rushing -> RB, not QB (the attempts floor, not just magnitude)', () => {
  // Even though these passing numbers alone would be real - the 100-
  // attempt floor is a hard gate, not a tiebreaker: at 90 attempts, QB is
  // not a candidate at all, regardless of how its points compare.
  const row = {
    passAtt: 90, passYds: 600, passTd: 4, passInt: 2,
    rushAtt: 120, rushYds: 800, rushTd: 8,
  };
  assert.equal(inferPosition(row), 'RB');
});

test('a Defense-only row (no offensive or kicking component) infers no position', () => {
  assert.equal(inferPosition({ defInt: 3, defTd: 1, sacks: 2 }), null);
});

test('Derek Loville 1995 -> RB (218 rush att, 87 rec - touches, not points, decide it)', () => {
  // real DEV row: rush_att=218, rush_yds=693, rush_td=6; rec=87,
  // rec_yds=612, rec_td=1 - a real receiving back whose catch count is
  // substantial, but whose 218 carries still outnumber his 87 catches.
  // Under the pre-amendment points rule this could plausibly have leaned
  // WR; touches put it at RB.
  const row = {
    rushAtt: 218, rushYds: 693, rushTd: 6,
    rec: 87, recYds: 612, recTd: 1,
  };
  assert.equal(inferPosition(row), 'RB');
});

test('a dead-even touch count resolves to WR, never left unresolved (rec >= rushAtt breaks the tie)', () => {
  const row = { rushAtt: 50, rushYds: 500, rushTd: 0, rec: 50, recYds: 500, recTd: 0 };
  const result = inferPosition(row);
  assert.equal(typeof result, 'string');
  assert.equal(result, 'WR');
});
