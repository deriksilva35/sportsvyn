// lib/fantasy/seatValuation.test.mjs — the "My Team" sort.
//
// THESE ARE PROPERTIES, NOT CASES, and that is the whole point of the file.
//
// The first version of this feature multiplied the market gap by the engine's
// need weight. It passed a hand-picked case test (equal ADP, positive gap) and
// was WRONG for 94% of the real board: 193 of 206 available players at pick 52
// had a negative gap, and multiplying a negative by a need multiplier > 1 sorts
// needed positions DOWNWARD. The case test confirmed the design instead of
// challenging it.
//
// So every ordering claim below is asserted over an ENTIRE sorted board, at
// several different roster states, including the live pick-52 shape that
// exposed the inversion. A property that holds for every adjacent pair cannot
// be satisfied by picking a friendly example.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeatValuation, compareSeat, slotRank, seatReadOf } from './seatValuation.js';
import { sortsFor, sortPlayers } from './statView.js';
import * as engine from './engine.js';

const ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 };
const ROUNDS = Object.values(ROSTER).reduce((a, b) => a + b, 0);
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
const MY_TEAM = sortsFor('ALL').find((o) => o.key === 'myteam');

const pick = (position, rosterSlot) => ({ position, rosterSlot, slotPos: rosterSlot });

// A board shaped like the real one: ADPs spread either side of the next pick, so
// most rows carry a NEGATIVE gap exactly as they do in production.
function board(n, myNextOverall) {
  return Array.from({ length: n }, (_, i) => ({
    ffcPlayerId: `p${i}`,
    name: `P${i}`,
    position: POSITIONS[i % POSITIONS.length],
    adp: i + 1,
    team: 'CIN',
  })).filter((p) => p.adp !== myNextOverall);
}

// The roster states worth quantifying over: empty, partly filled, RB dedicated
// full with FLEX open, and RB + FLEX both gone.
const SEATS = {
  empty: [],
  partial: [pick('RB', 'RB'), pick('WR', 'WR')],
  rbFlexOpen: [pick('RB', 'RB'), pick('RB', 'RB')],
  rbFlexFull: [pick('RB', 'RB'), pick('RB', 'RB'), pick('WR', 'FLEX')],
};

const valuationFor = (seatPicks, available, myNextOverall) => computeSeatValuation({
  rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks, available, myNextOverall,
});
const sortedWith = (available, v) => sortPlayers(available, MY_TEAM, {}, v);

// ---------------------------------------------------------------------------
// (a) no full row sorts above an open row  — at ANY pick state
// ---------------------------------------------------------------------------

test('property (a): slot buckets never interleave, at any roster state', () => {
  // 52 is the pick number that exposed the original inversion; the others are
  // there so the property is not pinned to one lucky board.
  for (const nextPick of [8, 24, 52, 140]) {
    for (const [label, seat] of Object.entries(SEATS)) {
      const avail = board(206, nextPick);
      const v = valuationFor(seat, avail, nextPick);
      const ranks = sortedWith(avail, v).map((p) => slotRank(seatReadOf(v, p).slot));
      for (let i = 1; i < ranks.length; i++) {
        assert.ok(ranks[i] >= ranks[i - 1],
          `${label} @${nextPick}: a rank-${ranks[i]} row sorted above a rank-${ranks[i - 1]} row`);
      }
    }
  }
});

test('property (a) restated: no FULL row outranks any OPEN row, ever', () => {
  for (const nextPick of [8, 24, 52, 140]) {
    for (const seat of Object.values(SEATS)) {
      const avail = board(206, nextPick);
      const v = valuationFor(seat, avail, nextPick);
      const order = sortedWith(avail, v);
      const lastOpen = order.findLastIndex((p) => seatReadOf(v, p).slot === 'open');
      const firstFull = order.findIndex((p) => seatReadOf(v, p).slot === 'full');
      if (lastOpen !== -1 && firstFull !== -1) {
        assert.ok(firstFull > lastOpen,
          `@${nextPick}: a full-position row appeared above an open one`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// (b) within a bucket, order is strictly by gap
// ---------------------------------------------------------------------------

test('property (b): inside a bucket, gap descends monotonically', () => {
  for (const nextPick of [8, 24, 52, 140]) {
    for (const [label, seat] of Object.entries(SEATS)) {
      const avail = board(206, nextPick);
      const v = valuationFor(seat, avail, nextPick);
      const order = sortedWith(avail, v);
      const seen = new Map(); // slot -> last gap seen
      for (const p of order) {
        const { slot, gap } = seatReadOf(v, p);
        if (seen.has(slot)) {
          assert.ok(gap <= seen.get(slot),
            `${label} @${nextPick}: gap rose within '${slot}' (${seen.get(slot)} -> ${gap})`);
        }
        seen.set(slot, gap);
      }
    }
  }
});

test('property (b) holds for NEGATIVE gaps too - the case the composite got wrong', () => {
  // Every row here is a reach (ADP far beyond the next pick), which is the 94%
  // that the old gap x need ordering inverted.
  const nextPick = 10;
  const avail = board(120, nextPick).filter((p) => p.adp > nextPick);
  const v = valuationFor(SEATS.rbFlexOpen, avail, nextPick);
  const order = sortedWith(avail, v);
  assert.ok(order.every((p) => seatReadOf(v, p).gap < 0), 'precondition: every row is a reach');
  const openGaps = order.filter((p) => seatReadOf(v, p).slot === 'open').map((p) => seatReadOf(v, p).gap);
  for (let i = 1; i < openGaps.length; i++) {
    assert.ok(openGaps[i] <= openGaps[i - 1], 'negative gaps must still descend');
  }
  // ...and the needed positions lead the board rather than trailing it.
  assert.equal(seatReadOf(v, order[0]).slot, 'open',
    'a reach-heavy board must still open with a position the seat can start');
});

// ---------------------------------------------------------------------------
// (c) tags match buckets exactly
// ---------------------------------------------------------------------------

test('property (c): the displayed tag IS the sort bucket', () => {
  // The row renders `slot`; the comparator ranks on `slot`. If they could ever
  // differ, the order would stop being readable off the screen.
  for (const nextPick of [24, 52]) {
    for (const seat of Object.values(SEATS)) {
      const avail = board(206, nextPick);
      const v = valuationFor(seat, avail, nextPick);
      for (const p of avail) {
        const read = seatReadOf(v, p);
        assert.ok(['open', 'flex', 'full'].includes(read.slot), 'tag must be a known bucket');
        assert.equal(slotRank(read.slot), { open: 0, flex: 1, full: 2 }[read.slot],
          'the rank used to sort must be derived from the tag that is shown');
      }
    }
  }
});

test('property (c): FLEX eligibility decides flex vs full, per the engine', () => {
  const nextPick = 40;
  const avail = board(206, nextPick);
  const vOpen = valuationFor(SEATS.rbFlexOpen, avail, nextPick); // RB full, FLEX open
  const vFull = valuationFor(SEATS.rbFlexFull, avail, nextPick); // RB full, FLEX gone
  const rb = avail.find((p) => p.position === 'RB');
  const k = avail.find((p) => p.position === 'PK');
  assert.equal(seatReadOf(vOpen, rb).slot, 'flex', 'a third RB keeps FLEX standing');
  assert.equal(seatReadOf(vFull, rb).slot, 'full', 'and loses it once FLEX is taken');
  assert.equal(seatReadOf(vOpen, k).slot, 'open', 'K is not FLEX-eligible but its own slot is open');
});

// ---------------------------------------------------------------------------
// Recompute, and the engine
// ---------------------------------------------------------------------------

test('the read moves on a pick and returns on an undo', () => {
  const avail = board(60, 40);
  const rb = avail.find((p) => p.position === 'RB');
  const before = valuationFor([pick('RB', 'RB')], avail, 40);
  const after = valuationFor([pick('RB', 'RB'), pick('RB', 'RB')], avail, 40);
  const undone = valuationFor([pick('RB', 'RB')], avail, 40);
  assert.equal(seatReadOf(before, rb).slot, 'open');
  assert.equal(seatReadOf(after, rb).slot, 'flex', 'a pick must change the read');
  assert.deepEqual(seatReadOf(undone, rb), seatReadOf(before, rb), 'undo must restore it exactly');
});

test('no next pick: every gap is null and the board falls back to ADP', () => {
  const avail = board(30, 40);
  const v = valuationFor(SEATS.partial, avail, null);
  assert.ok(avail.every((p) => seatReadOf(v, p).gap === null));
  const order = sortedWith(avail, v).map((p) => p.adp);
  // Buckets still apply; inside each, a null gap leaves ADP as the only order.
  const byBucket = new Map();
  for (const p of sortedWith(avail, v)) {
    const s = seatReadOf(v, p).slot;
    if (!byBucket.has(s)) byBucket.set(s, []);
    byBucket.get(s).push(p.adp);
  }
  for (const [slot, adps] of byBucket) {
    assert.deepEqual(adps, [...adps].sort((a, b) => a - b), `${slot} must fall back to ADP order`);
  }
  assert.equal(order.length, avail.length);
});

test('the comparator is total and stable - no pair is mutually greater', () => {
  const avail = board(80, 30);
  const v = valuationFor(SEATS.partial, avail, 30);
  for (let i = 0; i < 40; i++) {
    const a = avail[i];
    const b = avail[(i * 7 + 3) % avail.length];
    if (a === b) continue; // a player against himself proves nothing
    const ab = compareSeat(a, b, v);
    const ba = compareSeat(b, a, v);
    // `+ 0` normalises -0, which Object.is (and so assert.strictEqual) treats as
    // distinct from 0 - an equal pair would otherwise fail this on a technicality.
    assert.equal(Math.sign(ab) + 0, -Math.sign(ba) + 0, 'compare must be antisymmetric');
  }
});

test('AI picks are byte-identical with the sort computed or not', () => {
  const config = { teams_count: 8, roster_slots: ROSTER, scoring_format: 'ppr' };
  const pool = Array.from({ length: 200 }, (_, i) => ({
    ffcPlayerId: `p${i}`, name: `P${i}`, position: POSITIONS[i % POSITIONS.length],
    adp: i + 1, stdev: 10, team: 'CIN', bye: 7,
  }));
  const seeded = () => { let x = 42; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; };

  const runDraft = (valuateBetweenPicks) => {
    const state = engine.createDraftState(config, pool, 1);
    const rng = seeded();
    const total = state.rounds * state.teamsCount;
    for (let i = 0; i < total; i++) {
      const seat = state.order[state.overallPick - 1];
      if (valuateBetweenPicks) {
        computeSeatValuation({
          rosterSlots: ROSTER, rounds: state.rounds,
          allPicks: state.picks, seatPicks: state.teams[0].picks,
          available: state.available, myNextOverall: state.overallPick + 3,
        });
      }
      if (!(engine.aiPick(state, seat, rng) ?? engine.autoPick(state, seat))) break;
    }
    return state.picks.map((p) => `${p.overallPick}:${p.ffcPlayerId}`);
  };

  const without = runDraft(false);
  const withSort = runDraft(true);
  assert.ok(without.length > 0, 'the control draft must actually run');
  assert.deepEqual(withSort, without, 'valuing the board must not change a single AI pick');
});

test('computeSeatValuation never mutates what it is given', () => {
  const seat = [pick('RB', 'RB')];
  const avail = board(20, 30);
  const seatCopy = JSON.parse(JSON.stringify(seat));
  const availCopy = JSON.parse(JSON.stringify(avail));
  valuationFor(seat, avail, 30);
  assert.deepEqual(seat, seatCopy, 'seat picks untouched');
  assert.deepEqual(avail, availCopy, 'player rows untouched - nothing stamped on them');
});
