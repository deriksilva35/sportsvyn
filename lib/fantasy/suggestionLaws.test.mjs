// lib/fantasy/suggestionLaws.test.mjs - the K/DST cap and the force-up floor.
//
// The laws under test:
//   CAP: no copies beyond STARTABLE slots for singleton positions - excluded
//        from every suggestion surface once filled, never a hardcoded 1.
//   FORCE-UP: when picks remaining <= open starter slots, every engine pick
//        fills a starter (the floors' contrapositive; recon verdict: BUILT
//        here, it did not previously exist).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SINGLETON_POSITIONS } from './config.js';
import { canRoster, createDraftState, applyPick, autoPick } from './engine.js';
import { bestAvailableAtMyPick, cappedPositions } from './needs.js';
import { computeSeatValuation, seatReadOf, slotRank } from './seatValuation.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

// A tiny pool: enough of everything, ids stable.
let nextId = 1;
const P = (position, adp) => ({ ffcPlayerId: `p${nextId++}`, name: `${position}${nextId}`, position, adp, stdev: 5, team: 'AA', bye: 9 });
const pool = () => {
  nextId = 1;
  return [
    ...Array.from({ length: 6 }, (_, i) => P('QB', 10 + i)),
    ...Array.from({ length: 14 }, (_, i) => P('RB', 1 + i)),
    ...Array.from({ length: 14 }, (_, i) => P('WR', 2 + i)),
    ...Array.from({ length: 6 }, (_, i) => P('TE', 30 + i)),
    ...Array.from({ length: 4 }, (_, i) => P('PK', 140 + i)),
    ...Array.from({ length: 4 }, (_, i) => P('DEF', 130 + i)),
  ];
};

// The engine reads SNAKE_CASE config (teams_count / roster_slots) - the DB
// row shape, not the console's camelCase.
const SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 2 };
const CONFIG = { teams_count: 2, scoring_format: 'ppr', roster_slots: SLOTS };

test('the singleton set is defined once, in config, and names K + DST', () => {
  assert.deepEqual(SINGLETON_POSITIONS, ['K', 'DST']);
});

// ---------------------------------------------------------------------------
// THE CAP - engine floor (b), generalized
// ---------------------------------------------------------------------------

test('a roster holding its K refuses a second to ENGINE seats - and only them', () => {
  const state = createDraftState(CONFIG, pool(), 1);
  const team = state.teams[0];
  const k1 = state.available.find((p) => p.position === 'PK');
  applyPick(state, 0, k1, 'user');
  const k2 = state.available.find((p) => p.position === 'PK');
  assert.equal(canRoster(state, team, k2, 9), false, 'engine seat: capped');
  assert.equal(canRoster(state, team, k2, 9, null, { humanPick: true }), true,
    'a HUMAN may still stash one - the room accepts, the sort demotes');
});

test('the cap reads the roster shape - a 2-K room caps at 2, not 1', () => {
  const cfg = { ...CONFIG, roster_slots: { ...SLOTS, K: 2 } };
  const state = createDraftState(cfg, pool(), 1);
  const team = state.teams[0];
  const k1 = state.available.find((p) => p.position === 'PK');
  applyPick(state, 0, k1, 'user');
  const k2 = state.available.find((p) => p.position === 'PK');
  assert.equal(canRoster(state, team, k2, 13), true,
    'the SECOND K of a 2-K room is under cap - the old hardcoded >=1 barred it');
  applyPick(state, 0, k2, 'user');
  const k3 = state.available.find((p) => p.position === 'PK');
  assert.equal(canRoster(state, team, k3, 13), false, 'the THIRD is capped');
});

test('autoPick inherits the cap for free - it never takes the second DST', () => {
  const state = createDraftState(CONFIG, pool(), 1);
  const d1 = state.available.find((p) => p.position === 'DEF');
  applyPick(state, 0, d1, 'user');
  // burn picks until the roster would otherwise tempt a DST value fall
  for (let i = 0; i < 6; i += 1) {
    const rec = autoPick(state, 0);
    assert.ok(rec, 'a legal pick always exists');
    assert.notEqual(rec.position, 'DEF', 'the second defense is excluded, not sunk');
  }
});

// ---------------------------------------------------------------------------
// FORCE-UP - floor (f), BUILT (recon item 2 verdict)
// ---------------------------------------------------------------------------

test('3 picks left, QB/K/DST open -> the candidate set is exactly those positions', () => {
  const state = createDraftState(CONFIG, pool(), 1);
  // Fill RB2 WR2 TE1 FLEX1 + both bench = 8 picks; QB, K, DST remain open,
  // 3 picks remain. rounds = 11.
  const take = (pos) => {
    const pl = state.available.find((p) => p.position === pos);
    applyPick(state, 0, pl, 'user');
  };
  ['RB', 'RB', 'WR', 'WR', 'TE', 'RB', 'WR', 'RB'].forEach(take);
  assert.equal(state.rounds - state.teams[0].picks.length, 3, 'harness: three picks remain');
  for (let i = 0; i < 3; i += 1) {
    const rec = autoPick(state, 0);
    assert.ok(rec, 'a legal pick always exists');
    assert.ok(['QB', 'K', 'DST'].includes(rec.slotPos),
      `pick ${i + 1} must fill a required slot, took ${rec.slotPos} - auto-draft benched a skill player while a starter starved`);
  }
});

// ---------------------------------------------------------------------------
// THE PANELS - bestAvailable and MY TEAM
// ---------------------------------------------------------------------------

test('bestAvailableAtMyPick never shows a capped position', () => {
  const players = pool();
  const capped = cappedPositions(SLOTS, [{ position: 'DEF' }]);
  assert.deepEqual([...capped], ['DST']);
  const top = bestAvailableAtMyPick(players, 130, 10, { capped });
  assert.ok(top.length > 0);
  assert.ok(top.every((p) => p.position !== 'DEF'), 'never show a DST to a roster that holds one');
  // and the 2-K shape frees the second K
  const capped2 = cappedPositions({ ...SLOTS, K: 2 }, [{ position: 'PK' }]);
  assert.equal(capped2.has('K'), false, 'one K in a 2-K room is not capped');
});

test('MY TEAM ranks a capped singleton ABSOLUTE LAST - exclusion as ranking', () => {
  const players = pool();
  const v = computeSeatValuation({
    rosterSlots: SLOTS, rounds: 11,
    allPicks: [], seatPicks: [{ position: 'DEF', rosterSlot: 'DST' }],
    available: players, myNextOverall: 20, currentOverall: 18, teamsCount: 2,
  });
  const dst = players.find((p) => p.position === 'DEF');
  const read = seatReadOf(v, dst);
  assert.equal(read.streamer, true);
  assert.equal(slotRank(read), 4, 'below every rank, including full');
});

// ---------------------------------------------------------------------------
// VAL hoist - the canonical form only
// ---------------------------------------------------------------------------

test('neither room hand-writes the VAL arithmetic - valueGap is the canon', () => {
  for (const rel of ['components/sim/DraftRoom.js', 'components/sim/TrackerRoom.js']) {
    const t = src(rel);
    assert.ok(!/Math\.round\(currentOverall - Number\(p\.adp\)\)/.test(t),
      `${rel} inlines the VAL arithmetic - import valueGap`);
    assert.match(t, /valueGap\(currentOverall, p\.adp\)/, `${rel} must use the canonical form`);
  }
});
