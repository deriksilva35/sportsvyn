// lib/daily/lockIn.test.mjs - the Daily lock-in's rules, pure (mon-4): choosing a team
// commits; no backing out; a pick only from the committed team; a placed pick is
// final; the page sees names until a team is chosen; submit grades the steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseTeam, pickPlayer, picksFromSteps, progressView, emptySteps } from './lockIn.js';

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'];
const card = (i) => [
  { position: 'QB', name: `QB ${i}`, points: 300 - i }, { position: 'RB', name: `RB ${i}`, points: 250 - i },
  { position: 'WR', name: `WR ${i}`, points: 240 - i }, { position: 'TE', name: `TE ${i}`, points: 200 - i },
];
const BOARD = { board: [...Array.from({ length: 10 }, (_, i) => ({ key: `T${i}`, abbr: `T${i}`, card: card(i) })),
  { key: 'KK', abbr: 'KK', card: [{ position: 'PK', name: 'Kicker', points: 140 }] },
  { key: 'QQ', abbr: 'QQ', card: [{ position: 'QB', name: 'Only QB', points: 280 }] }] };
const go = (steps, ...ops) => ops.reduce((s, [k, ...a]) => {
  const r = k === 'c' ? chooseTeam(BOARD, s, a[0], SLOTS) : pickPlayer(BOARD, s, a[0], a[1], SLOTS);
  assert.equal(r.ok, true, r.reason); return r.steps;
}, steps);

test('choosing COMMITS: a second team is refused until a player of the first is placed', () => {
  const s = go(emptySteps(), ['c', 'T0']);
  assert.equal(s.committed, 'T0');
  const back = chooseTeam(BOARD, s, 'T1', SLOTS);
  assert.equal(back.ok, false); assert.equal(back.status, 409); assert.match(back.reason, /pick a player from T0 first/);
  assert.equal(chooseTeam(BOARD, s, 'T0', SLOTS).ok, true, 'choosing the same team again is a retry, not a change');
  const placed = go(s, ['p', 0, 'QB 0']);
  assert.equal(placed.committed, null);
  assert.equal(chooseTeam(BOARD, placed, 'T1', SLOTS).ok, true, 'free again once the pick is placed');
});

test('a pick only from the COMMITTED team; none without a commitment', () => {
  assert.match(pickPlayer(BOARD, emptySteps(), 0, 'QB 0', SLOTS).reason, /choose a team first/);
  const s = go(emptySteps(), ['c', 'T0']);
  const other = pickPlayer(BOARD, s, 0, 'QB 1', SLOTS);
  assert.equal(other.ok, false); assert.match(other.reason, /not on T0's card - you are committed to T0/);
  assert.match(pickPlayer(BOARD, s, 1, 'QB 0', SLOTS).reason, /does not fit RB/);
});

test('a placed pick is FINAL: its slot cannot be filled again, its team cannot be chosen again', () => {
  const s = go(emptySteps(), ['c', 'T0'], ['p', 1, 'RB 0'], ['c', 'T1']);
  const swap = pickPlayer(BOARD, s, 1, 'RB 1', SLOTS);
  assert.equal(swap.ok, false); assert.match(swap.reason, /that pick is final/);
  assert.match(chooseTeam(BOARD, go(emptySteps(), ['c', 'T0'], ['p', 1, 'RB 0']), 'T0', SLOTS).reason, /already used/);
});

test('a team none of whose players fits an open slot cannot be chosen (it would trap the run)', () => {
  const s = go(emptySteps(), ['c', 'T0'], ['p', 0, 'QB 0']);
  const r = chooseTeam(BOARD, s, 'QQ', SLOTS);
  assert.equal(r.ok, false); assert.match(r.reason, /no QQ player fits a slot you have left/);
  assert.match(chooseTeam(BOARD, emptySteps(), 'GHOST', SLOTS).reason, /not on this board/);
});

test('the page sees NAMES until a team is chosen; then that one card, and the placed picks', () => {
  const v0 = progressView(BOARD, emptySteps());
  assert.equal(v0.teams.length, 12);
  assert.ok(v0.teams.every((t) => Array.isArray(t.card) && t.card.length === 0), 'no card leaves the server before a choice');
  assert.equal(v0.committed, null);
  const s = go(emptySteps(), ['c', 'T3'], ['p', 5, 'TE 3'], ['c', 'KK']);
  const v = progressView(BOARD, s);
  assert.ok(v.teams.every((t) => t.card.length === 0));
  assert.equal(v.committed.key, 'KK'); assert.equal(v.committed.card[0].name, 'Kicker');
  assert.deepEqual(v.picks.map((p) => [p.slotIndex, p.teamKey, p.player.name]), [[5, 'T3', 'TE 3']]);
  assert.equal(progressView(BOARD, null).committed, null, 'a run from before the lock-in has no steps yet');
});

test('submit grades the STEPS: one entry per slot, empty slots null, in slot order', () => {
  const s = go(emptySteps(), ['c', 'T2'], ['p', 3, 'WR 2'], ['c', 'KK'], ['p', 7, 'Kicker']);
  const picks = picksFromSteps(s, SLOTS);
  assert.equal(picks.length, 8);
  assert.deepEqual(picks[3], { slotIndex: 3, teamKey: 'T2', playerName: 'WR 2' });
  assert.deepEqual(picks[0], { slotIndex: 0, teamKey: null, playerName: null });
  assert.deepEqual(picksFromSteps(null, SLOTS).filter((p) => p.teamKey).length, 0);
});
