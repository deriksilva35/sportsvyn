// lib/october/settle.test.mjs - points land as the box score does, and the
// four cases the relay named: DNF, burn, max-two, and a rain-postponed game.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCard, octoberTotal } from './settle.js';
import { DNF, dayState, refuseReason } from './rules.js';

const BOARD = [
  { match_id: 1, slug: 'tb-nyy', kickoff_at: '2026-09-29T17:08:00Z' },
  { match_id: 2, slug: 'phi-atl', kickoff_at: '2026-09-29T18:08:00Z' },
  { match_id: 3, slug: 'det-sea', kickoff_at: '2026-09-29T22:08:00Z' },
];
const pick = (playerId, matchId) => ({ playerId: String(playerId), matchId });

const FULL = {
  arm: pick(10, 3), bat1: pick(1, 1), bat2: pick(2, 2), bat3: pick(3, 2), bat4: pick(4, 3),
};

const stat = (matchId, playerId, row) => [`${matchId}:${playerId}`, row];

test('THE MOCK\'S OWN LIVE CARD: one final, two live, two waiting', () => {
  const statBy = new Map([
    stat(1, 1, { at_bats: 4, hits: 2, doubles: 1, rbi: 2 }),          // Díaz, final
    stat(2, 2, { at_bats: 3, hits: 1, home_runs: 1, runs: 1, rbi: 1 }), // Harper, live
    stat(2, 3, { at_bats: 2, hits: 1, walks: 1, stolen_bases: 1 }),   // Acuña, live
  ]);
  const matchBy = new Map([
    ['1', { status: 'final' }], ['2', { status: 'live' }], ['3', { status: 'scheduled' }],
  ]);
  const c = scoreCard(FULL, statBy, matchBy);
  assert.deepEqual(c.slots.map((s) => s.state), ['pending', 'final', 'live', 'live', 'pending']);
  assert.equal(c.slots[1].points, 12);   // 2-4 with a double and two RBI
  assert.equal(c.slots[2].points, 14);   // the mock's Harper: HR + R + RBI
  assert.equal(c.slots[3].points, 10);   // 1B 3 + BB 2 + SB 5
  // A SLOT WHOSE GAME HAS NOT STARTED HAS NO NUMBER - the mock prints an
  // em-dash and the first pitch, not a zero.
  assert.equal(c.slots[0].points, null);
  assert.equal(c.slots[4].points, null);
  assert.equal(c.total, 36);
  assert.equal(c.settled, 1, 'only the final one has settled');
  assert.equal(c.complete, false);
  // The printed line is the mock's grammar.
  assert.equal(c.slots[1].line, '2-4 · 2B · 2 RBI');
});

test('A PLAYER WHO DID NOT APPEAR IN A FINISHED GAME SCORES 0, not null', () => {
  // The bench is a risk the picker took. "No line yet" is a different thing
  // and is only true while the game is unfinished.
  const matchBy = new Map([['1', { status: 'final' }], ['2', { status: 'final' }], ['3', { status: 'final' }]]);
  const c = scoreCard(FULL, new Map(), matchBy);
  assert.deepEqual(c.slots.map((s) => s.points), [0, 0, 0, 0, 0]);
  assert.equal(c.settled, 5);
  assert.equal(c.complete, true, 'five zeroes is a completed card');
  assert.equal(c.total, 0);
});

test('A RAIN-POSTPONED GAME CARRIES THE SLOT, it does not lose it', () => {
  // The slot points at a MATCH, not at a date. There is no special case for
  // this in the settle - it falls out of settling per match - and that is the
  // point of the design.
  const statBy = new Map([stat(1, 1, { at_bats: 4, hits: 3, home_runs: 1, rbi: 4 })]);
  const matchBy = new Map([
    ['1', { status: 'final' }],
    ['2', { status: 'postponed' }],   // rained out, makeup Thursday
    ['3', { status: 'final' }],
  ]);
  const c = scoreCard(FULL, statBy, matchBy);
  // The postponed game's two slots are PENDING, not zero and not lost.
  assert.equal(c.slots[2].state, 'pending');
  assert.equal(c.slots[3].state, 'pending');
  assert.equal(c.slots[2].points, null);
  // THE DAY IS NOT COMPLETE, which is the honest answer: the card is not
  // finished, so it does not settle until the makeup is played.
  assert.equal(c.complete, false);
  // And the slot that WAS played keeps its points meanwhile.
  assert.equal(c.slots[1].points, 2 * 3 + 10 + 4 * 2, "3-4 with a homer: two singles, a HR and four RBI");

  // When the makeup is played, the same lineup settles - nothing was carried
  // by hand, the match simply turned final.
  const later = scoreCard(FULL, new Map([
    ...statBy,
    stat(2, 2, { at_bats: 4, hits: 1, doubles: 1 }),
    stat(2, 3, { at_bats: 3, hits: 0, walks: 2 }),
  ]), new Map([['1', { status: 'final' }], ['2', { status: 'final' }], ['3', { status: 'final' }]]));
  assert.equal(later.complete, true);
  assert.equal(later.slots[2].points, 5);
  assert.equal(later.slots[3].points, 4);
});

test('A DNF IS NOT A ZERO, in the day and in the total', () => {
  const four = { arm: pick(10, 3), bat1: pick(1, 1), bat2: pick(2, 2), bat3: pick(3, 2) };
  // Before the last first pitch it is simply an open card.
  assert.equal(dayState(four, BOARD, new Date('2026-09-29T20:00:00Z')).state, 'open');
  // After it, the card can never be completed.
  assert.equal(dayState(four, BOARD, new Date('2026-09-29T22:08:00Z')).state, DNF);

  // IN THE OCTOBER TOTAL a DNF day is 0 AND IS SHOWN AS DNF - both, which is
  // why octoberTotal returns the count as well as the number. The mock's
  // board prints "DNF" in the delta column of a row whose total is 187.0.
  const days = [
    { settled: true, state: 'complete', points: 44.0 },
    { settled: true, state: DNF, points: 31.5 },   // scored, but not counted
    { settled: true, state: 'complete', points: 12.5 },
    { settled: false, state: 'open', points: 9.0 },
  ];
  assert.deepEqual(octoberTotal(days), { total: 56.5, days: 3, dnf: 1 });
  // A day that has not settled is not in the total at all.
  assert.equal(octoberTotal([{ settled: false, state: 'complete', points: 99 }]).total, 0);
});

test('A DAY BOUNDARY REFUSES NOTHING, and THE CAP survives a swap', () => {
  const now = new Date('2026-09-29T16:00:00Z');
  // NO BURN ACROSS THE BOUNDARY: a player spent on an earlier day is pickable.
  assert.equal(refuseReason({}, 'bat1', { playerId: 7, matchId: 1, kind: 'bat' },
    { board: BOARD, now }), null);
  // The cap: three games, so ceil(5/3) = 2, and the arm counts as a player
  // from its game.
  const two = { arm: pick(10, 2), bat1: pick(1, 2) };
  assert.equal(refuseReason(two, 'bat2', { playerId: 5, matchId: 2, kind: 'bat' },
    { board: BOARD, now }), 'max_from_game');
  // AND A SWAP IS NOT A THIRD. Replacing bat1 with another PHI/ATL bat is
  // legal; the slot being overwritten must not count against its replacement.
  assert.equal(refuseReason(two, 'bat1', { playerId: 5, matchId: 2, kind: 'bat' },
    { board: BOARD, now }), null);
});
