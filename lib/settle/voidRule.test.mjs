// lib/settle/voidRule.test.mjs - the MLB void rule (ruling sun-8 item 1), PURE.
// A game not final blocks until settles_at + 48h; after it, it is void and
// scores 0; a board whose every game is void still refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOID_GRACE_MS, voidCutoff, pastVoidCutoff, storedVoid, voidReadiness } from './voidRule.js';
import { settleGate } from '../run/settle.js';
import { previewReadiness } from '../run/preview.js';
import { scoreCard } from '../october/settle.js';

const SETTLES = '2026-09-28T13:05:00.000Z';     // contest #26's settles_at
const C = { settles_at: SETTLES };

test('the cutoff is settles_at + 48h, >= at the boundary, and absent without settles_at', () => {
  assert.equal(VOID_GRACE_MS, 48 * 3600e3);
  assert.equal(voidCutoff(C).toISOString(), '2026-09-30T13:05:00.000Z');
  assert.equal(pastVoidCutoff(C, new Date('2026-09-30T13:04:59.999Z')), false);
  assert.equal(pastVoidCutoff(C, new Date('2026-09-30T13:05:00.000Z')), true);
  assert.equal(voidCutoff({}), null);
  assert.equal(pastVoidCutoff({ settles_at: null }, new Date('2030-01-01')), false, 'no settles_at, never void');
});

test('storedVoid reads meta.void as numbers and nothing else', () => {
  assert.deepEqual(storedVoid({ meta: { void: ['40237', 12, null, ''] } }), [40237, 12]);
  assert.deepEqual(storedVoid({ meta: {} }), []);
  assert.deepEqual(storedVoid({ meta: { void: 'x' } }), []);
});

const GAMES = [
  { id: 1, slug: 'a', status: 'final' },
  { id: 2, slug: 'b', status: 'final' },
  { id: 3, slug: 'bal-nyy', status: 'cancelled' },
];

test('a cancelled game BEFORE the cutoff blocks; AFTER it, it is void and the board is ready', () => {
  const before = voidReadiness(GAMES, { voidAllowed: pastVoidCutoff(C, new Date('2026-09-29T00:00:00Z')) });
  assert.equal(before.ready, false);
  assert.equal(before.reason, 'games not final');
  assert.equal(before.remaining, 1);
  assert.deepEqual(before.waitingOn, [{ id: 3, slug: 'bal-nyy', status: 'cancelled' }]);
  const after = voidReadiness(GAMES, { voidAllowed: pastVoidCutoff(C, new Date('2026-10-04T00:00:00Z')) });
  assert.equal(after.ready, true);
  assert.deepEqual(after.void, [3]);
  // Postponed, live and plain stuck-scheduled games void the same way.
  for (const status of ['postponed', 'live', 'scheduled']) {
    const r = voidReadiness([{ id: 1, status: 'final' }, { id: 9, status }], { voidAllowed: true });
    assert.deepEqual([r.ready, r.void], [true, [9]], status);
  }
});

test('an ALL-VOID board refuses, before and after the cutoff', () => {
  const all = [{ id: 3, status: 'cancelled' }, { id: 4, status: 'postponed' }];
  assert.equal(voidReadiness(all, { voidAllowed: false }).ready, false);
  const r = voidReadiness(all, { voidAllowed: true });
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'every game void');
  assert.equal(voidReadiness([], { voidAllowed: true }).ready, false, 'no games is not a board');
});

test('a stored void is never un-voided, even when the game later goes final', () => {
  const r = voidReadiness([{ id: 1, status: 'final' }, { id: 3, status: 'final' }], { stored: [3] });
  assert.equal(r.ready, true);
  assert.deepEqual(r.void, [3]);
});

test('voidNow: a game its own ruling already voids does not wait for the cutoff', () => {
  const r = voidReadiness(GAMES, { voidAllowed: false, voidNow: (g) => g.status === 'cancelled' });
  assert.deepEqual([r.ready, r.void], [true, [3]]);
});

test('THE RUN PREVIEW GATE: cancelled blocks before the cutoff, is void after, all-void refuses', () => {
  const meta = { preview: true, round: 'world_series' };
  const before = settleGate({ meta, previewComplete: previewReadiness(GAMES, { voidAllowed: false }) });
  assert.equal(before.ok, false);
  assert.equal(before.reason, 'games-pending');
  assert.equal(before.remaining, 1);
  const after = settleGate({ meta, previewComplete: previewReadiness(GAMES, { voidAllowed: true }) });
  assert.equal(after.ok, true);
  assert.deepEqual(after.void, [3]);
  const allVoid = settleGate({ meta, previewComplete: previewReadiness([GAMES[2]], { voidAllowed: true }) });
  assert.deepEqual([allVoid.ok, allVoid.reason], [false, 'every-game-void']);
  // A REAL round has no game gate - it still asks the series, void or not.
  assert.equal(settleGate({ meta: { round: 'division' }, series: [{ key: 'a', winner: null }] }).ok, false);
});

test('OCTOBER scoreCard: a slot on a void game scores 0 even with a half-game of stat lines', () => {
  const lineup = { arm: { playerId: '7', matchId: 3 } };
  const statBy = new Map([['3:7', { match_id: 3, bdl_player_id: '7', outs_recorded: 15, strikeouts_pitched: 8 }]]);
  const matchBy = new Map([['3', { id: 3, status: 'cancelled' }]]);
  const plain = scoreCard(lineup, statBy, matchBy);
  assert.ok(plain.total > 0, 'without the void list the rows would score');
  const v = scoreCard(lineup, statBy, matchBy, { voidIds: new Set([3]) });
  const arm = v.slots.find((s) => s.slot === 'arm');
  assert.deepEqual([arm.state, arm.points], ['void', 0]);
  assert.equal(v.total, 0);
});
