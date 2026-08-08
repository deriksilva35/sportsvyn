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
import { computeSeatValuation, compareSeat, slotRank, seatReadOf, isPlayableNow } from './seatValuation.js';
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
      const ranks = sortedWith(avail, v).map((p) => slotRank(seatReadOf(v, p)));
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
        assert.ok(['open', 'flex', 'bench', 'full'].includes(read.slot), 'tag must be a known bucket');
        // The rank follows from the tag PLUS deferral. open-and-undeferred, flex
        // and bench all share rank 0: every one of them can take the player
        // today, so they settle it on gap rather than on category.
        const expected = read.slot === 'open' ? (read.deferred ? 1 : 0)
          : read.slot === 'flex' ? 0
            : read.slot === 'bench' ? (read.streamer ? 2 : 0)
              : 3;
        assert.equal(slotRank(read), expected,
          'the rank used to sort must follow from what the row displays');
      }
    }
  }
});

test('property (c): FLEX eligibility decides flex vs bench, per the engine', () => {
  const nextPick = 40;
  const avail = board(206, nextPick);
  const vOpen = valuationFor(SEATS.rbFlexOpen, avail, nextPick); // RB full, FLEX open
  const vFull = valuationFor(SEATS.rbFlexFull, avail, nextPick); // RB full, FLEX gone
  const rb = avail.find((p) => p.position === 'RB');
  const k = avail.find((p) => p.position === 'PK');
  assert.equal(seatReadOf(vOpen, rb).slot, 'flex', 'a third RB keeps FLEX standing');
  // Once FLEX is gone he is BENCH, not 'full' - the roster still has six empty
  // bench spots, and pretending otherwise is what buried the best value.
  assert.equal(seatReadOf(vFull, rb).slot, 'bench', 'and drops to bench once FLEX is taken');
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

// ---------------------------------------------------------------------------
// ROUND CONTEXT — the field failure, as a property.
//
// Reported live from round 7 with FLEX and six bench slots open: the sort served
// five DSTs at gaps of -11 to -46 across the top of the board. Every one of
// those slots really was open. None of them was anywhere near its turn. The
// deferral rule reads that from the pool - a position waits while its best
// available player is still more than a full round away - so it needs no
// per-position constants and expires by itself as the draft advances.
// ---------------------------------------------------------------------------

const TEAMS = 12;

// A realistic board: skill positions priced near the current pick, K and DST
// priced where they actually go (deep), which is what makes them deferrable.
function realisticBoard() {
  const rows = [];
  let i = 0;
  const add = (position, adp) => { rows.push({ ffcPlayerId: `x${i++}`, name: `${position}${i}`, position, adp, team: 'CIN' }); };
  for (let a = 84; a < 150; a += 3) { add('RB', a); add('WR', a + 1); }
  for (let a = 90; a < 160; a += 12) { add('TE', a); add('QB', a + 4); }
  for (let a = 150; a < 190; a += 8) { add('DEF', a); add('PK', a + 3); }
  return rows;
}

// Derik's reported shape: pick 83 (round 7 of a 12-team draft), starters filled
// except FLEX, with K and DST slots still empty.
const ROUND7_SEAT = [
  pick('QB', 'QB'), pick('RB', 'RB'), pick('RB', 'RB'),
  pick('WR', 'WR'), pick('WR', 'WR'), pick('TE', 'TE'),
];

test('round 7: no K or DST outranks a flex-eligible player with a better gap', () => {
  const avail = realisticBoard();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: ROUND7_SEAT,
    available: avail, myNextOverall: 95, currentOverall: 83, teamsCount: TEAMS,
  });
  const order = sortedWith(avail, v);

  // Precondition: K and DST slots ARE open - the bug was never about legality.
  const anyDst = avail.find((p) => p.position === 'DEF');
  assert.equal(seatReadOf(v, anyDst).slot, 'open', 'the DST slot is genuinely open');
  assert.equal(seatReadOf(v, anyDst).deferred, true, '...but the market says it can wait');

  const firstKDst = order.findIndex((p) => p.position === 'DEF' || p.position === 'PK');
  const lastFlex = order.findLastIndex((p) => seatReadOf(v, p).slot === 'flex');
  assert.ok(firstKDst > lastFlex,
    'a K/DST row appeared above a flex-eligible one - this is the reported failure');

  // And concretely: the top of the board is not defenses.
  const top5 = order.slice(0, 5).map((p) => p.position);
  assert.ok(!top5.includes('DEF') && !top5.includes('PK'),
    `top of board was ${top5.join(',')} - K/DST must not lead in round 7`);
});

test('the deferral expires on its own once the market catches up', () => {
  // Same seat, same board, late draft. Nothing changes but the pick number.
  const avail = realisticBoard();
  const late = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: ROUND7_SEAT,
    available: avail, myNextOverall: 160, currentOverall: 150, teamsCount: TEAMS,
  });
  const dst = avail.find((p) => p.position === 'DEF');
  assert.equal(seatReadOf(late, dst).deferred, false,
    'by pick 150 the best DST is inside a round - the wait is over');

  // ...and K/DST are now PLAYABLE rather than parked. They do not necessarily
  // lead: since the tiers collapsed, a flex-eligible player with a better gap
  // outranks them, which is the correct answer. What must hold is that they
  // have left the deferred bucket and now sit above everything still in it.
  const order = sortedWith(avail, late);
  const k = avail.find((p) => p.position === 'PK');
  assert.equal(slotRank(seatReadOf(late, dst)), 0, 'DST must now rank as playable');
  assert.equal(slotRank(seatReadOf(late, k)), 0, 'K must now rank as playable');
  const firstDeferred = order.findIndex((p) => seatReadOf(late, p).deferred);
  const lastKDst = order.findLastIndex((p) => ['DEF', 'PK'].includes(p.position));
  if (firstDeferred !== -1) {
    assert.ok(lastKDst < firstDeferred, 'K/DST must sit above anything still deferred');
  }
});

test('deferral is decided per position by the pool, not by a round table', () => {
  const avail = realisticBoard();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: ROUND7_SEAT,
    available: avail, myNextOverall: 95, currentOverall: 83, teamsCount: TEAMS,
  });
  // TE and QB slots are filled on this seat, so they are not 'open' at all;
  // the positions that ARE open (K, DST) are deferred purely because their best
  // available ADP sits beyond 83 + 12. Nothing here names a round.
  for (const p of avail) {
    const read = seatReadOf(v, p);
    if (read.slot !== 'open') continue;
    const best = Math.min(...avail.filter((q) => q.position === p.position).map((q) => q.adp));
    assert.equal(read.deferred, best > 83 + TEAMS,
      `${p.position}: deferral must follow bestAdp ${best} vs horizon ${83 + TEAMS}`);
  }
});

test('an unknown pick position defers nothing - absence must not demote', () => {
  const avail = realisticBoard();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: ROUND7_SEAT,
    available: avail, myNextOverall: 95, // no currentOverall / teamsCount
  });
  assert.ok(avail.every((p) => seatReadOf(v, p).deferred === false),
    'with no round context, no position may be marked deferred');
});

test('buckets still never interleave once deferral is in play', () => {
  const avail = realisticBoard();
  for (const at of [12, 40, 83, 120, 150, 180]) {
    const v = computeSeatValuation({
      rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: ROUND7_SEAT,
      available: avail, myNextOverall: at + 12, currentOverall: at, teamsCount: TEAMS,
    });
    const ranks = sortedWith(avail, v).map((p) => slotRank(seatReadOf(v, p)));
    for (let i = 1; i < ranks.length; i++) {
      assert.ok(ranks[i] >= ranks[i - 1], `@${at}: rank ${ranks[i]} sorted above ${ranks[i - 1]}`);
    }
  }
});

// ---------------------------------------------------------------------------
// PLAYABLE COMPETES ON VALUE
//
// Reported live from round 6, pick 63, with QB and FLEX both open: the sort put
// FIVE QBs at -4 to -21 above every flex-eligible player, while an ADP sort
// showed a +1 and a +0 running back sitting right there. A -21 reach outranked a
// +1 value purely because no gap was allowed to cross a bucket boundary.
//
// Open-dedicated and flex-eligible are now ONE bucket. If you can start him this
// week, he competes on value; the tag still says which kind of playable he is.
// ---------------------------------------------------------------------------

// A board that actually reproduces the reported condition: a QB priced INSIDE
// the one-round horizon, so his open slot is undeferred and genuinely competes.
// realisticBoard() prices QBs at 94+, which at pick 63 (horizon 75) makes them
// deferred - the reported failure could not occur there, and a test built on it
// would pass without exercising anything.
function pick63Board() {
  const rows = [];
  let i = 0;
  const add = (position, adp) => { rows.push({ ffcPlayerId: `p${i++}`, name: `${position}${i}`, position, adp, team: 'CIN' }); };
  // flex-eligible skill, straddling the pick
  for (let a = 60; a < 130; a += 4) { add('RB', a); add('WR', a + 2); }
  for (let a = 64; a < 120; a += 14) { add('TE', a); }
  // QBs INSIDE the horizon -> open and undeferred, exactly as reported
  for (let a = 66; a < 110; a += 9) { add('QB', a); }
  // K/DST far out -> still deferred
  for (let a = 150; a < 190; a += 8) { add('DEF', a); add('PK', a + 3); }
  return rows;
}

// Round 6, pick 63: RB2/WR2/TE filled, QB and FLEX open, K/DST/bench open.
const PICK63_SEAT = [
  pick('RB', 'RB'), pick('RB', 'RB'),
  pick('WR', 'WR'), pick('WR', 'WR'), pick('TE', 'TE'),
];

test('pick 63: no playable row with a worse gap sits above a better one', () => {
  // The property, quantified over the WHOLE playable run - slot kind is
  // irrelevant to the order, only the gap is.
  const avail = pick63Board();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: PICK63_SEAT,
    available: avail, myNextOverall: 75, currentOverall: 63, teamsCount: TEAMS,
  });
  const playable = sortedWith(avail, v).filter((p) => isPlayableNow(seatReadOf(v, p)));
  assert.ok(playable.length > 2, 'precondition: several playable rows');
  for (let i = 1; i < playable.length; i++) {
    const prev = seatReadOf(v, playable[i - 1]).gap;
    const cur = seatReadOf(v, playable[i]).gap;
    assert.ok(cur <= prev,
      `a ${seatReadOf(v, playable[i]).slot} row at ${cur} sat above a ${seatReadOf(v, playable[i - 1]).slot} row at ${prev}`);
  }
});

test('pick 63: a QB with an open slot does NOT outrank a better-gap flex player', () => {
  // The exact reported shape. Both are legitimately in play; value decides.
  const avail = pick63Board();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: PICK63_SEAT,
    available: avail, myNextOverall: 75, currentOverall: 63, teamsCount: TEAMS,
  });
  const order = sortedWith(avail, v);
  const firstQb = order.findIndex((p) => p.position === 'QB');
  const firstFlex = order.findIndex((p) => seatReadOf(v, p).slot === 'flex');
  assert.ok(firstQb !== -1 && firstFlex !== -1, 'precondition: both kinds present');
  // NON-VACUOUS: the QB slot must be open AND undeferred, or this test proves
  // nothing about the collapse - a deferred QB was never competing anyway.
  assert.equal(seatReadOf(v, order[firstQb]).slot, 'open', 'precondition: the QB slot is open');
  assert.equal(seatReadOf(v, order[firstQb]).deferred, false, 'precondition: and undeferred');
  const qbGap = seatReadOf(v, order[firstQb]).gap;
  const flexGap = seatReadOf(v, order[firstFlex]).gap;
  // Whichever leads must be the one with the better gap - not the one whose
  // slot happens to be dedicated.
  if (firstQb < firstFlex) {
    assert.ok(qbGap >= flexGap, 'a QB may only lead a flex row on gap, never on slot kind');
  } else {
    assert.ok(flexGap >= qbGap, 'a flex row may only lead a QB on gap, never on slot kind');
  }
});

test('open and flex share a rank; deferred and full still do not', () => {
  const avail = pick63Board();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: PICK63_SEAT,
    available: avail, myNextOverall: 75, currentOverall: 63, teamsCount: TEAMS,
  });
  const kinds = new Map();
  for (const p of avail) {
    const r = seatReadOf(v, p);
    const key = r.slot === 'open' && r.deferred ? 'open-deferred' : r.slot;
    if (!kinds.has(key)) kinds.set(key, slotRank(r));
  }
  assert.equal(kinds.get('open'), 0, 'an undeferred open slot is playable');
  assert.equal(kinds.get('flex'), 0, 'flex-eligible is equally playable');
  if (kinds.has('bench')) assert.equal(kinds.get('bench'), 0, 'so is an open bench spot');
  if (kinds.has('open-deferred')) assert.equal(kinds.get('open-deferred'), 1);
  if (kinds.has('full')) assert.equal(kinds.get('full'), 3);
});

test('the round-7 DST behaviour is UNCHANGED by the collapse', () => {
  // Deferral is the thing that still separates buckets. Collapsing the two
  // playable tiers must not let a deferred defense back to the top.
  const avail = realisticBoard();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: ROUND7_SEAT,
    available: avail, myNextOverall: 95, currentOverall: 83, teamsCount: TEAMS,
  });
  const order = sortedWith(avail, v);
  const firstKDst = order.findIndex((p) => p.position === 'DEF' || p.position === 'PK');
  const lastPlayable = order.findLastIndex((p) => isPlayableNow(seatReadOf(v, p)));
  assert.ok(firstKDst > lastPlayable,
    'a deferred K/DST must still sit below every playable row');
});

// ---------------------------------------------------------------------------
// BENCH IS PLAYABLE
//
// Reported from round 6 with QB, TE, DST and K open, FLEX FULL and six bench
// spots empty: the best value on the whole board (a +5 receiver) did not appear
// in the playable tier at all, because WR and FLEX were full so he bucketed as
// 'full'. A drafter in round 6 with an open bench takes that receiver over a
// -11 tight end every time. Benches are what those rounds are for.
// ---------------------------------------------------------------------------

// FLEX filled, WR filled, but six bench spots open.
const BENCH_SEAT = [
  pick('RB', 'RB'), pick('RB', 'RB'),
  pick('WR', 'WR'), pick('WR', 'WR'), pick('WR', 'FLEX'),
];

test('a bench-only player is PLAYABLE and competes on value', () => {
  const avail = pick63Board();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: BENCH_SEAT,
    available: avail, myNextOverall: 75, currentOverall: 63, teamsCount: TEAMS,
  });
  const wr = avail.find((p) => p.position === 'WR');
  assert.equal(seatReadOf(v, wr).slot, 'bench', 'WR and FLEX full, bench open -> bench');
  assert.equal(slotRank(seatReadOf(v, wr)), 0, 'bench is playable, not buried');

  // The reported inversion: the best-gap player must lead, whatever his tag.
  const order = sortedWith(avail, v);
  const best = [...avail].sort((a, b) => seatReadOf(v, b).gap - seatReadOf(v, a).gap)[0];
  assert.equal(order[0].ffcPlayerId, best.ffcPlayerId,
    'the best gap on the board must lead, even when its only home is the bench');
});

test('bench never outranks a starting slot on anything but gap', () => {
  const avail = pick63Board();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: BENCH_SEAT,
    available: avail, myNextOverall: 75, currentOverall: 63, teamsCount: TEAMS,
  });
  const playable = sortedWith(avail, v).filter((p) => isPlayableNow(seatReadOf(v, p)));
  for (let i = 1; i < playable.length; i++) {
    assert.ok(seatReadOf(v, playable[i]).gap <= seatReadOf(v, playable[i - 1]).gap,
      'gap alone orders the playable tier - bench, flex and open alike');
  }
});

test("'full' now means nowhere left at all", () => {
  // Every slot taken, including the bench: only then is a player unplayable.
  const seat = [
    pick('QB', 'QB'), pick('RB', 'RB'), pick('RB', 'RB'),
    pick('WR', 'WR'), pick('WR', 'WR'), pick('TE', 'TE'), pick('RB', 'FLEX'),
    ...Array.from({ length: 6 }, () => pick('WR', 'BN')),
  ];
  const avail = pick63Board();
  const v = computeSeatValuation({
    rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: seat,
    available: avail, myNextOverall: 75, currentOverall: 63, teamsCount: TEAMS,
  });
  const wr = avail.find((p) => p.position === 'WR');
  assert.equal(seatReadOf(v, wr).slot, 'full', 'with the bench gone there is nowhere left');
  assert.equal(slotRank(seatReadOf(v, wr)), 3, 'full is the last tier, below streamer-bench');
});

// ---------------------------------------------------------------------------
// STREAMABLE POSITIONS RANK BEHIND SKILL DEPTH ON THE BENCH
//
// Reported from round 10 with Denver already rostered: the sort led with a
// SECOND defense at +17.3, tagged 'DST · bench', above a +12.5 tight end for an
// OPEN tight end slot. Bench-playable was working as built; the miss is that
// bench value is not position-uniform. One starting slot, no flex path,
// replaceable off waivers - a second one occupies a bench spot that skill depth
// wants. Structural, symmetric across K and DST, and nothing else moves.
// ---------------------------------------------------------------------------

// DST and K already rostered; TE open; bench open. Round 10 shape.
const STREAMER_SEAT = [
  pick('RB', 'RB'), pick('RB', 'RB'), pick('WR', 'WR'), pick('WR', 'WR'),
  pick('QB', 'QB'), pick('WR', 'FLEX'), pick('DEF', 'DST'), pick('PK', 'K'),
];

function streamerBoard() {
  const rows = [];
  let i = 0;
  const add = (position, adp) => { rows.push({ ffcPlayerId: `s${i++}`, name: `${position}${i}`, position, adp, team: 'CIN' }); };
  add('TE', 105);                                   // open slot, good gap
  for (let a = 108; a < 150; a += 6) { add('WR', a); add('RB', a + 2); }
  for (let a = 100; a < 140; a += 10) { add('DEF', a); add('PK', a + 4); }
  return rows;
}
const streamerV = (seat = STREAMER_SEAT) => computeSeatValuation({
  rosterSlots: ROSTER, rounds: ROUNDS, allPicks: [], seatPicks: seat,
  available: streamerBoard(), myNextOverall: 130, currentOverall: 118, teamsCount: TEAMS,
});

test('(a) a second DST never outranks a skill playable row - but it is still there', () => {
  const avail = streamerBoard();
  const v = streamerV();
  const order = sortedWith(avail, v);

  const dst = avail.find((p) => p.position === 'DEF');
  const read = seatReadOf(v, dst);
  assert.equal(read.slot, 'bench', 'the tag stays honest - it IS bench-eligible');
  assert.equal(read.streamer, true, 'and it is flagged as streamable');
  assert.equal(slotRank(read), 2, 'demoted below every other playable row');

  // It is present, not hidden. A drafter who wants it can find it.
  assert.ok(order.some((p) => p.position === 'DEF'), 'the row must remain on the board');

  const firstStreamer = order.findIndex((p) => seatReadOf(v, p).streamer);
  const lastSkillPlayable = order.findLastIndex((p) => {
    const r = seatReadOf(v, p);
    return isPlayableNow(r) && !r.streamer;
  });
  assert.ok(firstStreamer > lastSkillPlayable,
    'no second defense may sit above a skill row that is playable now');

  // The reported outcome: the open TE slot leads.
  assert.equal(order[0].position, 'TE', `expected the open-slot TE to lead, got ${order[0].position}`);
});

test('(c) the same holds for kickers - symmetric, and nothing else moves', () => {
  const avail = streamerBoard();
  const v = streamerV();
  const k = avail.find((p) => p.position === 'PK');
  assert.equal(seatReadOf(v, k).streamer, true, 'a second kicker is streamable too');
  assert.equal(slotRank(seatReadOf(v, k)), 2);
  // Skill bench is untouched: a spare RB still competes normally.
  const rb = avail.find((p) => p.position === 'RB');
  assert.equal(seatReadOf(v, rb).streamer, false, 'running backs are not streamable');
  assert.equal(slotRank(seatReadOf(v, rb)), 0, 'a third RB benches fine - that is what benches are for');
});

test('(b-part) with the DST slot OPEN, defenses compete normally - no over-correction', () => {
  // Same board, but the seat has NOT rostered a defense. Nothing is demoted;
  // post-deferral behaviour is exactly as before this change.
  const seatNoDst = [
    pick('RB', 'RB'), pick('RB', 'RB'), pick('WR', 'WR'), pick('WR', 'WR'),
    pick('QB', 'QB'), pick('WR', 'FLEX'),
  ];
  const avail = streamerBoard();
  const v = streamerV(seatNoDst);
  const dst = avail.find((p) => p.position === 'DEF');
  const read = seatReadOf(v, dst);
  assert.equal(read.slot, 'open', 'its own slot is open');
  assert.equal(read.streamer, false, 'so it is not a bench streamer at all');
  assert.ok([0, 1].includes(slotRank(read)),
    'it ranks as playable, or deferred if the market says wait - never demoted');
});
