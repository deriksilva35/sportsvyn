// lib/fantasy/smallConfig.test.mjs - THE DEAD-SLOT LAW under small configs.
//
// THE LAW: a player who cannot occupy ANY remaining slot - given positional
// caps and FLEX eligibility - has ZERO marginal value to that roster, and sorts
// below anyone who can.
//
// WHY THIS FILE EXISTS. The Weekly Six is the first config in the product with
// NO BENCH: eight picks, all starters. Every rule about "what can this roster
// still use" was written and measured against fifteen-round leagues with six
// bench spots, where the answer is almost always "anything". These tests pin
// the law at the other extreme, where the answer is usually "almost nothing".
//
// WHAT THE INVESTIGATION FOUND: the law already held. canRoster clause (d)
// reads openDed + openFlex + openBN from the team's slots, which are built from
// THE DRAFT'S OWN CONFIG - there is no 15-round assumption anywhere in the
// path. slotStateFor returns 'full' when nothing is open, and the My Team
// comparator ranks 'full' last. These tests are the guard that keeps it true,
// not a fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The env loader is here only because this file imports DRAFT_CONFIG from
// lib/draft/contest.js, which pulls in lib/db.js at module load. Reading the
// ranked config from its real home rather than restating it is worth the
// import: a test that hardcoded {QB:1,RB:2,...} would keep passing after
// somebody changed the format it claims to be guarding.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { computeSeatValuation, compareSeat } = await import('./seatValuation.js');
const { seatTeamFromPicks, slotStateFor, canRoster } = await import('./engine.js');
const { canFieldSix } = await import('../draft/bestball.js');
const { DRAFT_CONFIG } = await import('../draft/contest.js');

const WEEKLY = DRAFT_CONFIG.rosterSlots;          // the ranked format itself
const pick = (position, rosterSlot) => ({ position, rosterSlot });

// Seven of eight taken: RB x2, WR x3, TE, and an RB in the FLEX. Only QB left.
const ONLY_QB_OPEN = [
  pick('RB', 'RB'), pick('RB', 'RB'),
  pick('WR', 'WR'), pick('WR', 'WR'), pick('WR', 'WR'),
  pick('TE', 'TE'), pick('RB', 'FLEX'),
];

const AVAILABLE = [
  { ffcPlayerId: 'r1', position: 'RB', adp: 40 },   // far better market value
  { ffcPlayerId: 'w1', position: 'WR', adp: 35 },
  { ffcPlayerId: 't1', position: 'TE', adp: 50 },
  { ffcPlayerId: 'k1', position: 'PK', adp: 150 },
  { ffcPlayerId: 'q1', position: 'QB', adp: 90 },
  { ffcPlayerId: 'q2', position: 'QB', adp: 110 },
];

const valuationFor = (seatPicks, available = AVAILABLE) => computeSeatValuation({
  rosterSlots: WEEKLY, rounds: 8, allPicks: [], seatPicks, available,
  myNextOverall: 96, currentOverall: 90, teamsCount: 12,
});

// ---------------------------------------------------------------------------
// (a) THE MY TEAM SORT
// ---------------------------------------------------------------------------

test('(a) with only QB open, EVERY QB sorts above EVERY non-QB', () => {
  // Even though every non-QB here has a far better market gap. A player who
  // cannot be rostered is worth nothing to this seat, whatever the market says.
  const val = valuationFor(ONLY_QB_OPEN);
  const sorted = [...AVAILABLE].sort((a, b) => compareSeat(a, b, val));
  const positions = sorted.map((p) => p.position);
  const lastQb = positions.lastIndexOf('QB');
  const firstOther = positions.findIndex((p) => p !== 'QB');
  assert.ok(lastQb < firstOther,
    `dead-slot players outranked a usable one: ${positions.join(', ')}`);
});

test('(a) and those dead positions read as "full", not as a small number', () => {
  const val = valuationFor(ONLY_QB_OPEN);
  assert.equal(val.get('q1').slot, 'open');
  for (const id of ['r1', 'w1', 't1', 'k1']) {
    assert.equal(val.get(id).slot, 'full', `${id} should have nowhere to go`);
  }
});

test('(a) A FLEX-ELIGIBLE PLAYER WITH FLEX OPEN IS NOT DEAD - and must not be demoted', () => {
  // The counterweight, and the case most likely to be mistaken for the bug: at
  // six picks in, QB and FLEX are both open, so a running back CAN be rostered.
  // Ranking him by value there is correct, not a defect. Demoting anything a
  // seat can legally use would break "inform, never prohibit".
  const sixIn = ONLY_QB_OPEN.slice(0, 6);
  const val = valuationFor(sixIn);
  assert.equal(val.get('r1').slot, 'flex', 'FLEX is open, so an RB is playable');
  assert.equal(val.get('q1').slot, 'open');
});

test('(a) the sort reads THE DRAFT\'S config, not a 15-round shape', () => {
  // The same seven picks under a bench-carrying config leave the bench open, so
  // nothing is dead. If this ever matched the Weekly Six result, the valuation
  // would be reading a hardcoded roster rather than the one in play.
  const withBench = { ...WEEKLY, BN: 6 };
  const val = computeSeatValuation({
    rosterSlots: withBench, rounds: 14, allPicks: [], seatPicks: ONLY_QB_OPEN,
    available: AVAILABLE, myNextOverall: 96, currentOverall: 90, teamsCount: 12,
  });
  assert.equal(val.get('r1').slot, 'bench', 'a bench spot makes him playable again');
});

// ---------------------------------------------------------------------------
// (b) AI AND AUTO-BPA PICKS
// ---------------------------------------------------------------------------

test('(b) canRoster REFUSES a dead-slot player for engine seats', () => {
  const team = seatTeamFromPicks(WEEKLY, ONLY_QB_OPEN);
  const state = { qbCap: 2 };
  assert.equal(canRoster(state, team, { position: 'QB' }, 8, null, {}), true);
  for (const pos of ['RB', 'WR', 'TE', 'PK', 'DEF']) {
    assert.equal(canRoster(state, team, { position: pos }, 8, null, {}), false,
      `${pos} can fill no slot and must not be draftable`);
  }
});

test('(b) and refuses it for a HUMAN pick too - humanPick relaxes K/DST, not arithmetic', () => {
  // opts.humanPick exists so a person may stash a second kicker on a bench slot
  // that would otherwise sit empty. It has never relaxed clause (d), and must
  // not: there is no bench here and nowhere for the player to go.
  const team = seatTeamFromPicks(WEEKLY, ONLY_QB_OPEN);
  const state = { qbCap: 2 };
  for (const pos of ['RB', 'WR', 'TE']) {
    assert.equal(canRoster(state, team, { position: pos }, 8, null, { humanPick: true }), false);
  }
});

test('(b) slotStateFor agrees with canRoster - the tag cannot contradict the arithmetic', () => {
  const team = seatTeamFromPicks(WEEKLY, ONLY_QB_OPEN);
  const state = { qbCap: 2 };
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const usable = canRoster(state, team, { position: pos }, 8, null, {});
    const tagged = slotStateFor(team, pos) !== 'full';
    assert.equal(tagged, usable, `${pos}: tag says ${tagged}, arithmetic says ${usable}`);
  }
});

// ---------------------------------------------------------------------------
// (c) FIELDABILITY
// ---------------------------------------------------------------------------

test('(c) A COMPLETED WEEKLY SIX ROSTER CAN ALWAYS FIELD SIX', () => {
  // The interaction worth checking: could a roster take eight legal picks and
  // still fail canFieldSix? Not under this config. The shape deals 1 QB and 7
  // flex-eligible bodies, and canFieldSix needs 1 + 5 - so the only way to fail
  // is to not finish, which is a DNF for a different reason.
  const roster = [
    { pos: 'QB' }, { pos: 'RB' }, { pos: 'RB' },
    { pos: 'WR' }, { pos: 'WR' }, { pos: 'WR' }, { pos: 'TE' }, { pos: 'RB' },
  ];
  assert.equal(roster.length, 8);
  assert.equal(canFieldSix(roster).ok, true);
});

test('(c) the config itself guarantees fieldability, by arithmetic', () => {
  // Stated as a property of DRAFT_CONFIG rather than of one sampled roster, so
  // changing the ranked shape to something unfieldable fails here.
  const slots = WEEKLY;
  const flexable = (slots.RB ?? 0) + (slots.WR ?? 0) + (slots.TE ?? 0) + (slots.FLEX ?? 0);
  assert.ok((slots.QB ?? 0) >= 1, 'the format must deal at least one QB');
  assert.ok(flexable >= 5, `only ${flexable} flex-eligible slots; canFieldSix needs 5`);
});
