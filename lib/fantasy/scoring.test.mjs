// lib/fantasy/scoring.test.mjs - fantasy points rules.
// Expected values are hand-computed from the rules stated in scoring.js, not
// read back off the implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fantasyPoints, seasonSummary, isExactlyScored, RECEPTION_PTS } from './scoring.js';

test('a QB line scores passing yards, TDs and interceptions', () => {
  // 300/25 = 12, +3 TD = 12, -1 INT = -2, +20 rush /10 = 2  => 24
  const line = { passYds: 300, passTd: 3, int: 1, rushYds: 20 };
  assert.equal(fantasyPoints(line, 'ppr'), 24);
});

test('reception value is the only axis the format changes', () => {
  const line = { rec: 8, recYds: 100, recTd: 1 }; // 10 + 6 = 16 before receptions
  assert.equal(fantasyPoints(line, 'standard'), 16);
  assert.equal(fantasyPoints(line, 'half-ppr'), 20); // +8 * 0.5
  assert.equal(fantasyPoints(line, 'ppr'), 24); // +8 * 1
});

test('2qb scores as ppr (roster format, not a scoring format)', () => {
  assert.equal(RECEPTION_PTS['2qb'], RECEPTION_PTS.ppr);
  const line = { rec: 5, recYds: 50 };
  assert.equal(fantasyPoints(line, '2qb'), fantasyPoints(line, 'ppr'));
});

test('an unknown format falls back to ppr rather than scoring zero receptions', () => {
  const line = { rec: 6, recYds: 60 };
  assert.equal(fantasyPoints(line, 'wildcard-format'), fantasyPoints(line, 'ppr'));
});

test('negative plays subtract: fumbles lost and interceptions', () => {
  // 50/10 = 5, -2 fumble => 3
  assert.equal(fantasyPoints({ rushYds: 50, fumblesLost: 1 }, 'ppr'), 3);
  // -2 * 2 INT = -4
  assert.equal(fantasyPoints({ int: 2 }, 'ppr'), -4);
});

test('a scoreless line is 0, and missing/blank input never throws', () => {
  assert.equal(fantasyPoints({}, 'ppr'), 0);
  assert.equal(fantasyPoints(null, 'ppr'), 0);
  assert.equal(fantasyPoints({ recYds: undefined, rec: null }, 'ppr'), 0);
});

test('rushing and receiving yards both score at 1 per 10, passing at 1 per 25', () => {
  assert.equal(fantasyPoints({ rushYds: 10 }, 'standard'), 1);
  assert.equal(fantasyPoints({ recYds: 10 }, 'standard'), 1);
  assert.equal(fantasyPoints({ passYds: 25 }, 'standard'), 1);
});

test('points round to 1dp, the precision leagues display', () => {
  // 47/10 = 4.7 exactly; 143/25 = 5.72 -> 5.7
  assert.equal(fantasyPoints({ rushYds: 47 }, 'standard'), 4.7);
  assert.equal(fantasyPoints({ passYds: 143 }, 'standard'), 5.7);
});

test('seasonSummary averages over games PLAYED, not a 17 week season', () => {
  const games = [
    { stats: { rushYds: 100 } }, // 10
    { stats: { rushYds: 200 } }, // 20
  ];
  const s = seasonSummary(games, 'ppr');
  assert.equal(s.points, 30);
  assert.equal(s.games, 2);
  assert.equal(s.ppg, 15); // 30/2, NOT 30/17 - a bye is not a zero
});

test('seasonSummary on an empty log is zero, not NaN', () => {
  const s = seasonSummary([], 'ppr');
  assert.deepEqual(s, { points: 0, ppg: 0, games: 0 });
  assert.ok(!Number.isNaN(s.ppg));
});

test('K and DST are flagged as NOT exactly scored (distance tiers / points allowed)', () => {
  for (const p of ['QB', 'RB', 'WR', 'TE']) assert.equal(isExactlyScored(p), true);
  for (const p of ['K', 'DST']) assert.equal(isExactlyScored(p), false);
});
