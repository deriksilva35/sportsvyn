// lib/fantrax/fantrax.test.mjs — the Fantrax boundary, pure parts. No network,
// no database: the shapes below are the ones the probe measured on the real
// fxea payloads (.fantrax-probe/ holds the full dumps; it is gitignored, so the
// fixtures here are inlined and small).
// Run: node --test lib/fantrax/fantrax.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  swapLastFirst, toPoolPosition, toRosterSlots, toScoringFormat, draftablePositions,
} from './vocabulary.js';
import { buildCrosswalk, toPoolRows, toTeams, toKeepers, heldByLeague, nameHit, toMinors } from './import.js';
import { overallFor, seatFor, keeperPicks, runSeats, pickInRoundFor, providerSeatConflicts } from './keeperSeed.js';

// ---- names ---------------------------------------------------------------
test('names: "Last, First" swaps on the FIRST comma only; a name without one is untouched', () => {
  assert.equal(swapLastFirst('Bowers, Brock'), 'Brock Bowers');
  assert.equal(swapLastFirst('Smith, John Jr.'), 'John Jr. Smith');
  assert.equal(swapLastFirst('St. Brown, Amon-Ra'), 'Amon-Ra St. Brown');
  assert.equal(swapLastFirst('Bijan Robinson'), 'Bijan Robinson');
  assert.equal(swapLastFirst('  Chase, JaMarr  '), 'JaMarr Chase');
});

// ---- three vocabularies --------------------------------------------------
test('positions: Fantrax K/DST -> pool PK/DEF; a team row is DEF whatever it says; FB is RB', () => {
  assert.equal(toPoolPosition('K'), 'PK');
  assert.equal(toPoolPosition('DST'), 'DEF');
  assert.equal(toPoolPosition('WR', { isTeamRow: true }), 'DEF');
  assert.equal(toPoolPosition('FB'), 'RB');
  assert.equal(toPoolPosition('LB'), 'LB'); // passed through; the slot filter decides
});

test('roster: RWT is FLEX, bench is derived from maxTotalPlayers, 17 rounds from 10 active', () => {
  const rosterInfo = {
    maxTotalPlayers: 17,
    positionConstraints: {
      QB: { maxActive: 1 }, RB: { maxActive: 2 }, WR: { maxActive: 3 }, TE: { maxActive: 1 },
      RWT: { maxActive: 1 }, K: { maxActive: 1 }, DST: { maxActive: 1 },
    },
  };
  const r = toRosterSlots(rosterInfo);
  assert.deepEqual(r.slots, { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 7 });
  assert.equal(r.active, 10); assert.equal(r.total, 17); assert.deepEqual(r.unmapped, []);
  // An unrecognised constraint is reported, never dropped.
  const idp = toRosterSlots({ maxTotalPlayers: 18, positionConstraints: { ...rosterInfo.positionConstraints, LB: { maxActive: 1 } } });
  assert.deepEqual(idp.unmapped, ['LB']);
});

test('scoring: H2H points + ppr -> ppr; two QB slots win; anything else rejects with a reason, never a fifth value', () => {
  const base = { scoringSystem: { type: 'HEAD_TO_HEAD_POINTS_BASED' }, ppr: true,
    rosterInfo: { positionConstraints: { QB: { maxActive: 1 } } } };
  assert.deepEqual(toScoringFormat(base), { ok: true, format: 'ppr' });
  assert.deepEqual(toScoringFormat({ ...base, ppr: false }), { ok: true, format: 'standard' });
  assert.deepEqual(toScoringFormat({ ...base, rosterInfo: { positionConstraints: { QB: { maxActive: 2 } } } }), { ok: true, format: '2qb' });
  const cat = toScoringFormat({ ...base, scoringSystem: { type: 'ROTISSERIE' } });
  assert.equal(cat.ok, false); assert.match(cat.error, /ROTISSERIE/);
  assert.equal(toScoringFormat({ ...base, ppr: undefined }).ok, false);
});

test('draftable positions derive from the slots: the league\'s pool, not the provider\'s universe', () => {
  const d = draftablePositions({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 7 });
  assert.deepEqual([...d].sort(), ['DEF', 'PK', 'QB', 'RB', 'TE', 'WR']);
  assert.ok(!d.has('LB'));
});

// ---- crosswalk + pool ----------------------------------------------------
const playerIds = {
  '06je0': { name: 'Bowers, Brock', position: 'TE', teamShortName: 'LV' },
  '05abc': { name: 'Brown, Chase', position: 'RB', teamShortName: 'CIN' },
  '20295#1100': { name: 'Bills', position: 'DST', teamShortName: 'BUF' },
  '9zzzz': { name: 'Watt, T.J.', position: 'LB', teamShortName: 'PIT' },
};
const slots = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 7 };

test('crosswalk: compound team keys resolve by full key AND by bare prefix; a real id is never shadowed', () => {
  const x = buildCrosswalk(playerIds);
  assert.equal(x.get('20295#1100').compound, true);
  assert.equal(x.get('20295').name, 'Bills');
  assert.equal(x.get('06je0').compound, false);
});

test('pool rows: ADP_PPR, swapped names, pool vocabulary, IDP filtered by the slots, nameless skipped', () => {
  const x = buildCrosswalk(playerIds);
  const adp = [
    { id: '06je0', pos: 'TE', ADP_PPR: 9.8, ADP: 12 },
    { id: '20295', tmId: '1100', name: 'Bills', pos: 'DST', ADP_PPR: 150.2 },
    { id: '9zzzz', pos: 'LB', ADP_PPR: 88 },
    { id: 'devy1', pos: 'RB', ADP_PPR: 300 },
  ];
  const { rows, skipped } = toPoolRows(adp, x, { snapshotDate: '2026-09-01', scoringFormat: 'ppr', teamsCount: 12, slots });
  assert.deepEqual(rows.map((r) => [r.ffc_player_id, r.name, r.position, r.team, r.adp, r.source]), [
    ['06je0', 'Brock Bowers', 'TE', 'LV', 9.8, 'fantrax'],
    ['20295', 'Bills', 'DEF', 'Bills', 150.2, 'fantrax'],
  ]);
  assert.deepEqual(skipped.map((s) => s.reason), ['undraftable position LB', 'no name']);
});

// ---- teams + keepers -----------------------------------------------------
const draftResults = {
  draftOrder: ['tA', 'tB', 'tC'],
  draftPicks: [
    { round: 1, pickInRound: 3, teamId: 'tC', playerId: '06je0' },
    { round: 2, pickInRound: 3, teamId: 'tA', playerId: '05abc' },   // even round: pick 3 is seat 1
    { round: 3, pickInRound: 1, teamId: 'tA' },                       // unmade: no playerId
  ],
};
const leagueInfo = { teamInfo: { tA: { id: 'tA', name: 'Alpha ' }, tB: { id: 'tB', name: 'Beta' }, tC: { id: 'tC', name: 'Gamma' } } };

test('teams: draftOrder gives the slots; the reader\'s entry is marked isMine once, at import', () => {
  const teams = toTeams(draftResults, leagueInfo, 'tB');
  assert.deepEqual(teams, [
    { slot: 1, name: 'Alpha ', fantraxTeamId: 'tA' },
    { slot: 2, name: 'Beta', fantraxTeamId: 'tB', isMine: true },
    { slot: 3, name: 'Gamma', fantraxTeamId: 'tC' },
  ]);
  assert.ok(!toTeams(draftResults, leagueInfo).some((t) => 'isMine' in t), 'no teamId, no mark');
});

test('keepers: made picks only, names via the crosswalk, seat from the team; an unresolved id is reported', () => {
  const x = buildCrosswalk(playerIds);
  const teams = toTeams(draftResults, leagueInfo, 'tB');
  const { rows, unresolved } = toKeepers(draftResults, x, teams);
  // Stage 3B: the row also freezes the keeper's price and team, because the
  // pool no longer carries him (he is held) and the shelf is built from this
  // record. No ADP feed here -> adp null, never 0.
  // 084: the row names its OWNER (fantrax_team_id) - the durable key - and keeps
  // the provider's seating (team_slot, pick_in_round) as what Fantrax said.
  assert.deepEqual(rows, [
    { fantrax_team_id: 'tC', team_slot: 3, round: 1, pick_in_round: 3, fantrax_player_id: '06je0', player_name: 'Brock Bowers', position: 'TE', adp: null, team: 'LV' },
    { fantrax_team_id: 'tA', team_slot: 1, round: 2, pick_in_round: 3, fantrax_player_id: '05abc', player_name: 'Chase Brown', position: 'RB', adp: null, team: 'CIN' },
  ]);
  const priced = toKeepers(draftResults, x, teams, [{ id: '06je0', ADP_PPR: 9.8, ADP: 12 }, { id: '05abc', ADP: 40 }]);
  assert.deepEqual(priced.rows.map((r) => r.adp), [9.8, 40]);
  assert.deepEqual(unresolved, []);
  const bad = toKeepers({ ...draftResults, draftPicks: [{ round: 1, pickInRound: 1, teamId: 'tA', playerId: 'ghost' }] }, x, teams);
  assert.deepEqual(bad.unresolved, ['ghost']);
});

test('snake: overall is a straight walk, the seat reverses on even rounds; pickInRoundFor inverts seatFor', () => {
  assert.equal(overallFor(1, 10, 12), 10);
  assert.equal(overallFor(12, 11, 12), 143);
  assert.equal(seatFor(1, 10, 12), 9);
  assert.equal(seatFor(12, 11, 12), 1);   // pick 11 of an even round is seat 2 (index 1)
  assert.equal(seatFor(13, 2, 12), 1);
  for (const r of [1, 2, 12, 13]) for (let i = 0; i < 12; i++) assert.equal(seatFor(r, pickInRoundFor(r, i, 12), 12), i);
});

// Twelve seats in import order; the reader is the team imported at seat 2.
const LEAGUE = Array.from({ length: 12 }, (_, i) => ({ slot: i + 1, fantraxTeamId: `t${i + 1}`, name: `Team ${i + 1}`, ...(i === 1 ? { isMine: true } : {}) }));

test('runSeats: the default is the identity; a chosen seat is a SWAP with the team imported there; out of range and no isMine throw', () => {
  const id = runSeats(LEAGUE, 2);
  assert.deepEqual(id.teamAt.map((t) => t.fantraxTeamId), LEAGUE.map((t) => t.fantraxTeamId));
  assert.equal(id.seatOf.get('t2'), 1);
  const nine = runSeats(LEAGUE, 9);
  assert.equal(nine.seatOf.get('t2'), 8, 'the reader sits at 9');
  assert.equal(nine.seatOf.get('t9'), 1, 'the team imported at 9 takes the reader\'s seat');
  for (const t of ['t1', 't3', 't4', 't5', 't6', 't7', 't8', 't10', 't11', 't12']) assert.equal(nine.seatOf.get(t), Number(t.slice(1)) - 1, `${t} stays`);
  // Unsorted input is sorted by slot first - the swap is by seat, not by array position.
  assert.equal(runSeats([...LEAGUE].reverse(), 9).seatOf.get('t2'), 8);
  assert.throws(() => runSeats(LEAGUE, 13), /outside 1\.\.12/);
  assert.throws(() => runSeats(LEAGUE, 0), /outside 1\.\.12/);
  assert.throws(() => runSeats(LEAGUE, 'x'), /outside 1\.\.12/);
  assert.throws(() => runSeats(LEAGUE.map((t) => ({ ...t, isMine: undefined })), 2), /no isMine/);
});

test('keeperPicks: a keeper\'s round is the keeper\'s, its column is wherever its owner sits THIS run - round 12 reverses', () => {
  const rows = [
    { fantrax_team_id: 't10', team_slot: 10, round: 1, pick_in_round: 10, fantrax_player_id: 'bowers', player_name: 'Brock Bowers', position: 'TE' },
    { fantrax_team_id: 't2', team_slot: 2, round: 12, pick_in_round: 11, fantrax_player_id: 'qj', player_name: 'Quentin Johnston', position: 'WR', adp: '92.08', team: 'LAC' },
    { fantrax_team_id: 't9', team_slot: 9, round: 12, pick_in_round: 4, fantrax_player_id: 'db', player_name: 'Denzel Boston', position: 'WR' },
    { fantrax_team_id: 't2', team_slot: 2, round: 13, pick_in_round: 2, fantrax_player_id: 'rd', player_name: 'Rico Dowdle', position: 'RB' },
  ];
  const by = (recs) => Object.fromEntries(recs.map((r) => [r.playerName, r.overallPick]));
  // Default seating: exactly the cells the seat-keyed design produced (pre-084 pins: 10 and 143).
  const dflt = keeperPicks(rows, 12, runSeats(LEAGUE, 2).seatOf);
  assert.equal(dflt.conflicts.length, 0);
  assert.deepEqual(by(dflt.recs), { 'Brock Bowers': 10, 'Quentin Johnston': 143, 'Denzel Boston': 136, 'Rico Dowdle': 146 });
  assert.equal(dflt.recs[0].pickedBy, 'logged');
  assert.equal(dflt.recs[0].isKeeper, true);
  assert.equal(dflt.recs.find((r) => r.playerName === 'Quentin Johnston').adpAtPick, 92.08);
  // Seat 9: Johnston moves 12-11 -> 12-4 (overall 136), Boston (displaced to seat 2) 12-4 -> 12-11 (143),
  // Dowdle 13-2 -> 13-9 (153); Bowers' owner did not move, so 1-10 stays.
  const nine = keeperPicks(rows, 12, runSeats(LEAGUE, 9).seatOf);
  assert.deepEqual(by(nine.recs), { 'Brock Bowers': 10, 'Quentin Johnston': 136, 'Denzel Boston': 143, 'Rico Dowdle': 153 });
  assert.deepEqual(nine.recs.map((r) => r.overallPick), [10, 136, 143, 153], 'ordered by overall');
  // The provider's pick_in_round on the row is not consulted: a wrong one changes nothing.
  const lying = rows.map((r) => ({ ...r, pick_in_round: 1 }));
  assert.deepEqual(by(keeperPicks(lying, 12, runSeats(LEAGUE, 9).seatOf).recs), by(nine.recs));
  // An owner the seating cannot place is a conflict, reported and skipped, never guessed.
  const orphan = keeperPicks([{ ...rows[0], fantrax_team_id: 'ghost' }], 12, runSeats(LEAGUE, 2).seatOf);
  assert.equal(orphan.recs.length, 0);
  assert.deepEqual(orphan.conflicts, [{ round: 1, owner: 'ghost', player: 'Brock Bowers', reason: 'owner_not_seated' }]);
});

test('providerSeatConflicts: the import-time check - Fantrax\'s own slot and pick_in_round must agree under snake', () => {
  assert.deepEqual(providerSeatConflicts([{ team_slot: 2, round: 12, pick_in_round: 11, player_name: 'P' }], 12), []);
  assert.deepEqual(providerSeatConflicts([{ team_slot: 11, round: 12, pick_in_round: 11, player_name: 'P' }], 12),
    [{ round: 12, pickInRound: 11, seatFromOrder: 10, seatFromSnake: 1, player: 'P' }]);
});

test('084 backfill: fantrax_team_id comes from teams[slot] on the SAME config row, then NOT NULL, then unique per owner per round', () => {
  const mig = readFileSync(new URL('../../migrations/084_keeper_owner_and_run_seat.sql', import.meta.url), 'utf8');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS fantrax_team_id text/);
  assert.match(mig, /SET fantrax_team_id = t->>'fantraxTeamId'\s+FROM draft_configs c, jsonb_array_elements\(c\.teams\) t\s+WHERE c\.id = k\.config_id\s+AND \(t->>'slot'\)::int = k\.team_slot/);
  assert.match(mig, /ALTER COLUMN fantrax_team_id SET NOT NULL/);
  assert.match(mig, /UNIQUE \(config_id, fantrax_team_id, round\)/);
  assert.match(mig, /ALTER TABLE drafts ADD COLUMN IF NOT EXISTS user_seat integer/);
  assert.doesNotMatch(mig, /DROP/, 'the provider\'s seating columns and their unique stay');
});

test('held: playerInfo T and WW are held, FA is not; the map is keyed by string id', () => {
  const held = heldByLeague({ '06je0': { status: 'T' }, '05abc': { status: 'ww' }, '9zzzz': { status: 'FA' }, x: {} });
  assert.deepEqual([...held.entries()], [['06je0', 'T'], ['05abc', 'WW']]);
  assert.equal(heldByLeague(null).size, 0);
});

test('pool exclusion: draftable counts AFTER the position gate, then draftable - excluded = written', () => {
  const x = buildCrosswalk(playerIds);
  const adp = [
    { id: '06je0', pos: 'TE', ADP_PPR: 9.8 },                         // held -> excluded
    { id: '05abc', pos: 'RB', ADP_PPR: 20 },                          // written
    { id: '20295', tmId: '1100', name: 'Bills', pos: 'DST', ADP_PPR: 150.2 },
    { id: '9zzzz', pos: 'LB', ADP_PPR: 88 },                          // held AND undraftable: the gate wins, not counted as excluded
  ];
  const exclude = new Map([['06je0', 'T'], ['9zzzz', 'T']]);
  const { rows, skipped, draftable, excluded } = toPoolRows(adp, x, { snapshotDate: '2026-09-01', scoringFormat: 'ppr', teamsCount: 12, slots, exclude });
  assert.equal(draftable, 3);
  assert.equal(excluded, 1);
  assert.equal(rows.length, draftable - excluded);
  assert.deepEqual(rows.map((r) => r.ffc_player_id), ['05abc', '20295']);
  assert.deepEqual(skipped.map((s) => s.reason), ['rostered (T)', 'undraftable position LB']);
});

test('nameHit: exact on the house key; loose = same last name, first within two edits; else null', () => {
  assert.equal(nameHit('Omar Cooper Jr.', 'Omar Cooper'), 'exact');
  assert.equal(nameHit('Elijiah Sarratt', 'Elijah Sarratt'), 'loose');
  assert.equal(nameHit('Kayton Allen', 'Kaytron Allen'), 'loose');
  assert.equal(nameHit('Issac Brown', 'Isaac Brown'), 'loose');
  assert.equal(nameHit('Chris Bell', 'Chris Henry'), null);       // last name differs
  assert.equal(nameHit('Jonathan Moore', 'TJ Moore'), null);      // too far on the first name
  assert.equal(nameHit('', 'TJ Moore'), null);
});

// A two-team roster: keepers on the shelf and off it, a waiver claim, a devy
// nobody's table knows, and the reader's own seat.
const minorTeams = [
  { slot: 1, fantraxTeamId: 'tA', name: 'Alpha', isMine: false },
  { slot: 2, fantraxTeamId: 'tB', name: 'Beta', isMine: true },
];
const nflTable = new Map([
  ['06je0', { name: 'Bowers, Brock', position: 'TE' }],
  ['05abc', { name: 'Brown, Chase', position: 'RB' }],
  ['073py', { name: 'Washington Jr., Mike', position: 'RB' }],
  ['0750d', { name: 'Sarratt, Elijah', position: 'WR' }],
  ['060lt', { name: 'Walker III, Kenneth', position: 'RB' }],
]);
const ncaafTable = new Map([['06kj6', { name: 'Wingo, Ryan', position: 'WR' }]]);
const rosters = { rosters: {
  tA: { rosterItems: [
    { id: '06je0', position: 'TE', status: 'ACTIVE' },           // keeper, active
    { id: '0750d', position: 'WR', status: 'MINORS' },           // minors, nfl name
    { id: '060lt', position: 'RB', status: 'ACTIVE' },           // active non-keeper: an ADD
    { id: 'dev01', position: 'WR', status: 'MINORS' },           // nameless devy
  ] },
  tB: { rosterItems: [
    { id: '05abc', position: 'RB', status: 'MINORS' },           // keeper ON the minors shelf
    { id: '073py', position: 'RB', status: 'MINORS' },
    { id: '06kj6', position: 'WR', status: 'MINORS' },           // ncaaf rung
    { id: 'dev02', position: 'QB', status: 'MINORS' },           // nameless devy
    { id: 'dev03', position: 'WR', status: 'INJURED_RESERVE' },  // an add on IR
  ] },
} };
const keeperIds = new Set(['06je0', '05abc']);

test('minors: every rostered player lands in exactly one bucket; team from the provider; alsoKeeper on the shelf', () => {
  const m = toMinors(rosters, minorTeams, { nfl: nflTable, ncaaf: ncaafTable, keeperIds });
  assert.equal(m.rostered, 9);
  assert.deepEqual(m.buckets, { keeperActive: 1, keeperMinors: 1, minors: 5, adds: 2 });
  assert.equal(m.buckets.keeperActive + m.buckets.keeperMinors + m.buckets.minors + m.buckets.adds, m.rostered);
  assert.equal(m.count, 6);
  assert.deepEqual(m.missingKeepers, []);
  assert.deepEqual(m.unknownTeams, []);
  assert.deepEqual(m.unknownStatus, []);
  const b = m.entries.find((e) => e.slot === 2);
  assert.deepEqual(b.minors, [
    { fantraxId: '05abc', name: 'Chase Brown', position: 'RB', nameSource: 'nfl', alsoKeeper: true },
    { fantraxId: '073py', name: 'Mike Washington Jr.', position: 'RB', nameSource: 'nfl' },
    { fantraxId: '06kj6', name: 'Ryan Wingo', position: 'WR', nameSource: 'ncaaf' },
    { fantraxId: 'dev02', name: null, position: 'QB', nameSource: null },
  ]);
  assert.deepEqual(m.adds, [
    { slot: 1, fantraxId: '060lt', name: 'Kenneth Walker III', position: 'RB', status: 'ACTIVE' },
    { slot: 2, fantraxId: 'dev03', name: null, position: 'WR', status: 'INJURED_RESERVE' },
  ]);
  // A keeper the roster no longer carries, an unknown team, an unknown status: each is reported, none is dropped.
  const odd = toMinors({ rosters: { ...rosters.rosters, tZ: { rosterItems: [{ id: 'q', position: 'QB', status: 'ACTIVE' }] },
    tA: { rosterItems: [...rosters.rosters.tA.rosterItems, { id: 'w', position: 'WR', status: 'TAXI' }] } } },
    minorTeams, { nfl: nflTable, keeperIds: new Set(['06je0', 'gone']) });
  assert.deepEqual(odd.unknownTeams, ['tZ']);
  assert.deepEqual(odd.unknownStatus, [{ teamId: 'tA', id: 'w', status: 'TAXI' }]);
  assert.deepEqual(odd.missingKeepers, ['gone']);
});

test('fixture rung: owner -> team only on evidence, a name offered only to that team\'s one fitting nameless entry, a loose hit reported as loose', () => {
  const fixture = { season: 2026, owners: [
    { owner: 'Derik', players: ['Mike Washington Jr.', 'Ryan Wingo', 'Arch Manning'] },  // Manning -> the one nameless QB on Beta
    { owner: 'Brad', players: ['Elijiah Sarratt', 'Chris Henry Jr.'] },                 // Henry -> the one nameless WR on Alpha
    { owner: 'Nobody', players: ['Bo Jackson'] },                                        // no evidence: no team, nothing placed
  ] };
  const m = toMinors(rosters, minorTeams, { nfl: nflTable, ncaaf: ncaafTable, fixture, keeperIds, myOwner: 'Derik' });
  const owners = Object.fromEntries(m.audit.owners.map((o) => [o.owner, o]));
  assert.equal(owners.Derik.slot, 2);
  assert.ok(owners.Derik.evidence.some((e) => e.hit === 'isMine'));
  assert.equal(owners.Brad.slot, 1);
  assert.equal(owners.Brad.names[0].outcome, 'loose: "Elijiah Sarratt" ~ "Elijah Sarratt" (nfl)');
  assert.equal(owners.Nobody.slot, null);
  assert.equal(owners.Nobody.names[0].outcome, 'unplaced');
  assert.deepEqual(m.audit.fixtureAssignments, [
    { team: 'Beta', slot: 2, fantraxId: 'dev02', position: 'QB', name: 'Arch Manning' },
    { team: 'Alpha', slot: 1, fantraxId: 'dev01', position: 'WR', name: 'Chris Henry Jr.' },
  ]);
  assert.deepEqual(m.audit.ambiguous, []);
  assert.equal(m.entries[1].minors.find((e) => e.fantraxId === 'dev02').nameSource, 'fixture');

  // Two spare names for one nameless entry is not a match; a typed position that
  // contradicts the roster's is not a match either. Both are reported, neither is written.
  const two = toMinors(rosters, minorTeams, { nfl: nflTable, ncaaf: ncaafTable, keeperIds, myOwner: 'Derik',
    fixture: { owners: [{ owner: 'Derik', players: ['Arch Manning', 'Sam Leavitt'] }] } });
  assert.equal(two.entries[1].minors.find((e) => e.fantraxId === 'dev02').name, null);
  assert.deepEqual(two.audit.ambiguous.map((a) => a.fixtureName), ['Arch Manning', 'Sam Leavitt']);
  const wrongPos = toMinors(rosters, minorTeams, { nfl: nflTable, ncaaf: ncaafTable, keeperIds, myOwner: 'Derik',
    fixture: { owners: [{ owner: 'Derik', players: [{ name: 'Jeremiah Smith', position: 'WR' }] }] } });
  assert.equal(wrongPos.entries[1].minors.find((e) => e.fantraxId === 'dev02').name, null);
  assert.deepEqual(wrongPos.audit.ambiguous, [{ owner: 'Derik', team: 'Beta', fixtureName: 'Jeremiah Smith', candidates: [] }]);
  assert.deepEqual(wrongPos.audit.fixtureAssignments, []);
});
