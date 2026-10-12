// lib/draft/roomLook.test.mjs - the weekly Draft room's words and shapes (sun-3). PURE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankedEyebrow, rankedTitle, seatStripSeats, poolSub, filterPool, myTeamView, missingLine, POSITION_CHIPS } from './roomLook.js';

const TEAMS = 12; const ROUNDS = 8;
const SLOTS = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 };
const snake = (teams, rounds) => Array.from({ length: teams * rounds }, (_, i) => {
  const r = Math.floor(i / teams); const k = i % teams; return r % 2 === 0 ? k : teams - 1 - k;
});
const ORDER = snake(TEAMS, ROUNDS);

test('the header copy, as the mock has it', () => {
  assert.equal(rankedEyebrow(6), 'THE DRAFT · NFL WEEK 6 · BEST 6 OF 8 COUNT');
  assert.equal(rankedTitle({ currentOverall: 14, teams: 12, rounds: 8, yourTurn: true }), 'Round 2 of 8 · your pick');
  assert.equal(rankedTitle({ currentOverall: 14, teams: 12, rounds: 8, yourTurn: false }), 'Round 2 of 8 · on deck');
  assert.equal(rankedTitle({ currentOverall: 97, teams: 12, rounds: 8, yourTurn: false, complete: true }), 'Draft complete');
  assert.deepEqual(POSITION_CHIPS, ['ALL', 'QB', 'RB', 'WR', 'TE']);
});

test('the seat strip: 12 tiles, You, everyone else with their LAST pick, the seat on the clock', () => {
  const picks = [
    { overallPick: 1, playerName: 'Christian McCaffrey', slotPos: 'RB' },
    { overallPick: 2, playerName: "Ja'Marr Chase", slotPos: 'WR' },
    { overallPick: 24, playerName: 'Travis Kelce', slotPos: 'TE' }, // seat 1 again (snake)
  ];
  const s = seatStripSeats({ teams: TEAMS, order: ORDER, picks, userTeamIndex: 2, currentOverall: 3 });
  assert.equal(s.length, 12);
  assert.equal(s[0].sub, 'TE Kelce', 'the last pick, not the first');
  assert.equal(s[1].sub, 'WR Chase');
  assert.equal(s[2].label, 'You'); assert.equal(s[2].you, true); assert.equal(s[2].onClock, true);
  assert.equal(s[5].sub, '-');
  assert.equal(s[5].label, 'Seat 6');
});

test('a pool row: TEAM vs OPP · ADP n · proj n, absent parts dropped', () => {
  const m = { KC: { opp: 'BUF', home: true }, BUF: { opp: 'KC', home: false } };
  assert.equal(poolSub({ team: 'KC', adp: 3.4, ppg: 21.36 }, m), 'KC vs BUF · ADP 3 · proj 21.4');
  assert.equal(poolSub({ team: 'BUF', adp: 10, ppg: null }, m), 'BUF @KC · ADP 10');
  assert.equal(poolSub({ team: 'NYJ', adp: 40, ppg: 9 }, null), 'NYJ · ADP 40 · proj 9.0');
});

test('Players: position chips and search compose; ADP order is kept', () => {
  const av = [
    { name: 'Josh Allen', position: 'QB', team: 'BUF' }, { name: 'James Cook', position: 'RB', team: 'BUF' },
    { name: 'Allen Lazard', position: 'WR', team: 'NYJ' },
  ];
  assert.deepEqual(filterPool(av, { pos: 'ALL', q: 'allen' }).map((p) => p.name), ['Josh Allen', 'Allen Lazard']);
  assert.deepEqual(filterPool(av, { pos: 'QB', q: 'allen' }).map((p) => p.name), ['Josh Allen']);
  assert.deepEqual(filterPool(av, { pos: 'ALL', q: 'buf' }).map((p) => p.name), ['Josh Allen', 'James Cook'], 'a team code matches');
});

test('My team: 8 slots, empty ones name the round that fills them, the missing positions, the next pick', () => {
  // You are seat 3 (index 2); picks 3 (round 1) and 22 (round 2) made: a QB and a WR.
  const userPicks = [
    { overallPick: 3, rosterSlot: 'QB', playerName: 'Josh Allen', ffcPlayerId: 'a' },
    { overallPick: 22, rosterSlot: 'WR', playerName: 'Puka Nacua', ffcPlayerId: 'b' },
  ];
  const v = myTeamView({ userPicks, rosterSlots: SLOTS, order: ORDER, userTeamIndex: 2, currentOverall: 23, teams: TEAMS, projOf: (p) => ({ a: 22.5, b: 17.25 })[p.ffcPlayerId] });
  assert.equal(v.count, 2); assert.equal(v.of, 8);
  assert.equal(v.projTotal, 39.8);
  assert.equal(v.slots.length, 8);
  const empties = v.slots.filter((s) => !s.pick);
  assert.deepEqual(empties.map((s) => s.emptyRound), [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(v.missing, ['RB', 'WR', 'TE'], 'three WR slots, one filled: WR is still missing');
  assert.deepEqual(v.slots.map((s) => s.label), ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE', 'FLEX']);
  assert.equal(v.nextPick, 27, 'round 3 for seat 3 is pick 27');
  assert.equal(missingLine(v.missing), 'Still need a RB, a WR and a TE.');
  assert.equal(missingLine([]), 'Every position is covered.');
});
