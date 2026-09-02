// lib/fantasy/collegeBoard.test.mjs — college players on the SAME board.
// node --test. Pure: the fixture is real data, captured, and nothing here
// touches a database.
//
// THE RULING THESE PIN. College players live in the same pool and the same
// board, placed below every NFL player and ordered among themselves by NCAAF
// ADP. The NCAAF ADP is a DISPLAY AND SORT value for the NCAA filter only -
// never a board position, never fed to the engine. A college row is
// bench-eligible only. The bots stay away from them not because anything
// converts one board's prices into the other's, but because the autodrafter
// simply never reaches that far down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDraftState, ensureFillablePool, runFullDraft, makeRng, canRoster,
  temperature, PARAMS, _internals,
} from './engine.js';
import { COLLEGE_PLACEMENT_BASE } from '../fantrax/import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
const BOARD = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'fantrax-one-board.json'), 'utf8'));

const CONFIG = { teams_count: BOARD.teamsCount, roster_slots: BOARD.rosterSlots, scoring_format: 'ppr' };
const nflOnly = () => BOARD.nfl.map((p) => ({ ...p }));
const oneBoard = () => [...BOARD.nfl, ...BOARD.ncaaf].map((p) => ({ ...p }));

test('the fixture is the real board: NFL above, college below, placements derived and contiguous', () => {
  assert.equal(BOARD.nfl.length, 417);
  assert.equal(BOARD.ncaaf.length, 927);
  // Every college placement is below every NFL row, including the 999 rows -
  // 999 is Fantrax's unranked sentinel, and the base has to clear it.
  const maxNfl = Math.max(...BOARD.nfl.map((p) => p.adp));
  assert.equal(maxNfl, 999, 'the sentinel is still on the board; the base must clear it');
  assert.ok(COLLEGE_PLACEMENT_BASE > maxNfl);
  assert.equal(Math.min(...BOARD.ncaaf.map((p) => p.adp)), COLLEGE_PLACEMENT_BASE);
  // The placement IS the NCAAF-ADP rank: contiguous, and monotone in ncaafAdp.
  for (let i = 1; i < BOARD.ncaaf.length; i++) {
    assert.equal(BOARD.ncaaf[i].adp, BOARD.ncaaf[i - 1].adp + 1, `placement ${i} is contiguous`);
    assert.ok(BOARD.ncaaf[i].ncaafAdp >= BOARD.ncaaf[i - 1].ncaafAdp, `placement ${i} follows NCAAF ADP`);
  }
  // And the true price is NOT the placement - the whole point of two columns.
  assert.equal(BOARD.ncaaf[0].ncaafAdp, 2.06);
  assert.equal(BOARD.ncaaf[0].adp, 10000);
});

// ===========================================================================
// t1 — no engine path reads NCAAF ADP
// ===========================================================================
test('t1: the engine never reads NCAAF ADP - by source, and by poisoning the value', () => {
  // (a) textual: the engine may know `league` (that is the bench gate and the
  //     coverage exclusion) but must never touch the college price.
  const engine = src('lib/fantasy/engine.js');
  assert.ok(!/ncaafAdp|ncaaf_adp/.test(engine), 'engine.js must not name the college ADP at all');

  // (b) behavioural, which is the assertion that survives a refactor: poison
  //     every college row's ncaafAdp with a value that WOULD dominate the board
  //     if anything read it, and require the draft to come out identical.
  const clean = oneBoard();
  const poisoned = oneBoard().map((p) => (p.league === 'ncaaf' ? { ...p, ncaafAdp: -9999 } : p));
  const a = runFullDraft(CONFIG, clean, 1, { auto: true }, makeRng(4242));
  const b = runFullDraft(CONFIG, poisoned, 1, { auto: true }, makeRng(4242));
  const strip = (r) => r.picks.map((p) => `${p.overallPick}:${p.ffcPlayerId}:${p.rosterSlot}`);
  assert.deepEqual(strip(b), strip(a), 'a poisoned college price changed a pick - something reads it');
});

// ===========================================================================
// t2 — a bot never takes a college player while any NFL player remains
// ===========================================================================
test('t2: no bot takes a college player, and the NFL board never ran out', () => {
  for (const seed of [1, 7, 99, 1234]) {
    const pool = oneBoard();
    const res = runFullDraft(CONFIG, pool, 1, { auto: true }, makeRng(seed));
    const byId = new Map(pool.map((p) => [p.ffcPlayerId, p]));
    const college = res.picks.filter((p) => byId.get(p.ffcPlayerId)?.league === 'ncaaf');
    assert.deepEqual(college, [], `seed ${seed}: a bot drafted a college player`);
    // The claim is about PREFERENCE, not about running out: prove NFL rows were
    // still available at the last pick. Otherwise t2 would pass on an empty board.
    const takenNfl = res.picks.length;
    assert.ok(BOARD.nfl.length > takenNfl,
      `seed ${seed}: ${BOARD.nfl.length} NFL rows vs ${takenNfl} picks - the board must not drain`);
  }
});

// ===========================================================================
// t3 — the placement is inert: same draft with and without the college rows
// ===========================================================================
test('t3: adding 927 college rows changes no pick, no par and no temperature', () => {
  for (const seed of [11, 202]) {
    const withCollege = runFullDraft(CONFIG, oneBoard(), 3, { auto: true }, makeRng(seed));
    const without = runFullDraft(CONFIG, nflOnly(), 3, { auto: true }, makeRng(seed));
    const strip = (r) => r.picks.map((p) => `${p.overallPick}:${p.ffcPlayerId}:${p.rosterSlot}:${p.adpAtPick}`);
    assert.deepEqual(strip(withCollege), strip(without), `seed ${seed}: the board is not inert`);
  }
  // Temperature is taken per candidate; the candidates are NFL either way, so
  // the table must be identical for the same players.
  const sWith = createDraftState(CONFIG, oneBoard(), 1);
  const sWithout = createDraftState(CONFIG, nflOnly(), 1);
  for (const c of sWithout.available.slice(0, 40)) {
    assert.equal(temperature(sWith, c), temperature(sWithout, c), `T differs for ${c.name}`);
  }
  // Board par is available[0].adp, and the best remaining row must still be NFL.
  assert.equal(sWith.available[0].ffcPlayerId, sWithout.available[0].ffcPlayerId);
  assert.equal(sWith.available[0].league, 'nfl');
});

// ===========================================================================
// t4 — tempMode does not flip (caveat A: it is a majority vote over the pool)
// ===========================================================================
test('t4: tempMode is a majority vote over the whole pool, and college rows do not flip it', () => {
  // The Fantrax board carries no stdev at all, so it is an adp-temperature room
  // before and after. Measured: 417/0 with stdev.
  assert.equal(createDraftState(CONFIG, nflOnly(), 1).tempMode, 'adp');
  assert.equal(createDraftState(CONFIG, oneBoard(), 1).tempMode, 'adp');

  // THE MARGIN IS THE POINT, and it is thin enough to state. tempMode is
  // `withStdev * 2 >= fillable.length`, so a stdev-carrying pool (FFC's) would
  // flip to 'adp' - changing T for every candidate in the room - if enough
  // null-stdev rows were ever added to it. Pinned as arithmetic on the real
  // sizes rather than as a hope that it never happens.
  const ffcSized = 972;
  assert.ok(ffcSized * 2 >= ffcSized + BOARD.ncaaf.length,
    'FFC + this college board still votes stdev');
  assert.ok(!(ffcSized * 2 >= ffcSized + BOARD.ncaaf.length + 46),
    'and 46 more null-stdev rows would flip it - the margin, recorded');
});

// ===========================================================================
// t5 — caveat B: college rows are not coverage
// ===========================================================================
test('t5: ensureFillablePool ignores college rows when counting K/DST coverage', () => {
  const synthOf = (pool) => ensureFillablePool(pool, CONFIG).filter((p) => p.synthetic === true);
  // Same answer with and without the college board: the 58 college kickers and
  // 80 school defenses must not be read as coverage.
  assert.equal(synthOf(oneBoard()).length, synthOf(nflOnly()).length);

  // And the case that proves it is doing something: strip the NFL kickers out.
  // Without the exclusion the college kickers would "cover" the K slots and no
  // replacement would be built.
  const noNflK = nflOnly().filter((p) => p.position !== 'PK');
  const noNflKPlusCollege = [...noNflK, ...BOARD.ncaaf.map((p) => ({ ...p }))];
  const need = CONFIG.roster_slots.K * CONFIG.teams_count;
  assert.equal(synthOf(noNflK).filter((p) => p.position === 'PK').length, need);
  assert.equal(synthOf(noNflKPlusCollege).filter((p) => p.position === 'PK').length, need,
    'college kickers were counted as coverage - a league with no NFL kicker would draft none');
  assert.ok(BOARD.ncaaf.some((p) => p.position === 'PK'), 'the fixture really does carry college kickers');
});

// ===========================================================================
// BENCH PINS — a college row is bench-eligible only
// ===========================================================================
const seatState = () => createDraftState(CONFIG, oneBoard(), 1);
const collegeRB = () => ({ ...BOARD.ncaaf.find((p) => p.position === 'RB') });
const nflRB = () => ({ ...BOARD.nfl.find((p) => p.position === 'RB') });

test('bench pin: a college player fills BN, never a starting slot and never FLEX', () => {
  const st = seatState();
  const team = st.teams[0];
  // An empty roster: RB and FLEX are both wide open, which is exactly when a
  // position-only assignToSlot would put him in one.
  assert.equal(team.slots.RB.filled, 0);
  assert.equal(team.slots.FLEX.filled, 0);
  const slot = _internals.assignToSlot(team, collegeRB());
  assert.equal(slot, 'BN', 'a college RB must land on the bench with RB and FLEX open');
  assert.equal(team.slots.RB.filled, 0, 'the starting RB slot must be untouched');
  assert.equal(team.slots.FLEX.filled, 0, 'FLEX must be untouched');
  assert.equal(team.slots.BN.filled, 1);
  // The control: an NFL RB in the same state DOES take the starting slot.
  const st2 = seatState();
  assert.equal(_internals.assignToSlot(st2.teams[0], nflRB()), 'RB');
});

test('bench pin: with the bench full a college pick is illegal - refused, not re-slotted', () => {
  const st = seatState();
  const team = st.teams[0];
  const round = 1;
  // Bench open: legal.
  assert.equal(canRoster(st, team, collegeRB(), round), true);
  assert.equal(canRoster(st, team, collegeRB(), round, null, { humanPick: true }), true);
  // Fill the bench and nothing else. Starting slots stay wide open, so a
  // position-only reading of this roster would still say "plenty of room".
  team.slots.BN.filled = team.slots.BN.cap;
  assert.ok(team.slots.RB.cap - team.slots.RB.filled > 0, 'starters are still open');
  assert.equal(canRoster(st, team, collegeRB(), round), false, 'no bench, no college pick');
  // THE REFUSAL IS NOT OVERRULEABLE BY A HUMAN. Every other gate in canRoster is
  // engine judgement a person may overrule; this one is the roster shape.
  assert.equal(canRoster(st, team, collegeRB(), round, null, { humanPick: true }), false,
    'a human pick must be refused too - the league has no slot for him');
  // An NFL RB in the SAME state is still legal, so the refusal is about the
  // college row and not about a full roster.
  assert.equal(canRoster(st, team, nflRB(), round, null, { humanPick: true }), true);
  // And assignToSlot refuses rather than silently re-slotting, if it is ever
  // reached with a full bench.
  assert.throws(() => _internals.assignToSlot(team, collegeRB()), /no open bench slot/);
});

// ===========================================================================
// IDENTITY — a college row must never borrow an NFL player's stats
// ===========================================================================
test('the identity matcher is scoped to league=nfl, on both the read and the write', () => {
  const nm = src('lib/gridiron/nameMatch.js');
  // The read: the identity sweep must not consider college rows at all.
  assert.match(nm, /FROM sim_player_pool\s*\n\s*WHERE league = 'nfl' ORDER BY/,
    'the identity SELECT must be scoped to nfl');
  // The write: the UPDATE must carry the predicate too, so an NFL identity
  // cannot reach a college row sharing (name, position, team).
  const upd = nm.match(/UPDATE sim_player_pool SET matched_player_id[\s\S]*?`;/);
  assert.ok(upd, 'the matcher still writes matched_player_id');
  assert.match(upd[0], /AND league = 'nfl'/, 'the identity UPDATE must be scoped to nfl');
});

test('the college board really does contain the names that would have false-matched', () => {
  // The scope above is only worth having if the collision is real. These six
  // names are on the live college board and each shares a normalized name and
  // position with an NFL player - measured 2 Sep 2026. If the feed ever stops
  // carrying them the test should be re-measured, not deleted.
  const names = new Set(BOARD.ncaaf.map((p) => `${p.name}|${p.position}`));
  for (const k of ['Chris Henry|WR', 'Chris Johnson|RB', 'Daequan Wright|TE',
                   'Sutton Smith|RB', 'Marcus Sanders|WR', 'Darius Johnson|WR']) {
    assert.ok(names.has(k), `${k} should be on the college board`);
  }
  // And the three school defenses whose code IS an NFL club abbreviation.
  const dstCodes = new Set(BOARD.ncaaf.filter((p) => p.position === 'DEF').map((p) => p.team));
  for (const c of ['Ind', 'MIN', 'Hou']) assert.ok(dstCodes.has(c), `school code ${c} should be present`);
});
