// lib/run/settle.test.mjs - a roster scores every game its clubs play, a
// swept club stops scoring, and nothing is zeroed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRoster, clubStateFrom, runTotal } from './settle.js';
import { SLOTS, DNF } from './rules.js';

const g = (matchId, playerId, row) => ({ match_id: matchId, bdl_player_id: String(playerId), ...row });
const pick = (playerId, teamId) => ({ playerId: String(playerId), teamId });

// Two arms, seven bats, across four clubs.
const ROSTER = {
  arm1: pick(10, 1), arm2: pick(11, 2),
  bat1: pick(1, 1), bat2: pick(2, 1), bat3: pick(3, 3), bat4: pick(4, 2),
  bat5: pick(5, 2), bat6: pick(6, 4), bat7: pick(7, 4),
};
const CLUBS = [
  { teamId: 1, abbr: 'TB', alive: true, gamesPlayed: 2 },
  { teamId: 2, abbr: 'ATL', alive: true, gamesPlayed: 2 },
  { teamId: 3, abbr: 'NYY', alive: false, gamesPlayed: 2 },   // swept
  { teamId: 4, abbr: 'SD', alive: false, gamesPlayed: 2 },    // swept
];

test('A ROSTER SCORES EVERY GAME ITS CLUB PLAYS IN THE ROUND', () => {
  // THE UNIT IS THE ROUND. A sweep is three games and a full series is five,
  // which is the whole strategic question: a safe club winning in three can
  // be worth less than a coin-flip club going the distance.
  const rows = [
    g(100, 1, { at_bats: 4, hits: 2, doubles: 1, rbi: 2 }),      // 12
    g(101, 1, { at_bats: 3, hits: 1, home_runs: 1, runs: 1 }),   // 12
  ];
  const c = scoreRoster(ROSTER, rows, CLUBS);
  const bat1 = c.slots.find((s) => s.slot === 'bat1');
  assert.equal(bat1.games, 2, 'two games, both counted');
  assert.equal(bat1.points, 24);
  // AND THE SUB-LINE IS THE ROUND'S, not one box score: 3-7 across both.
  assert.equal(bat1.line, '3-7 · 2B · HR · 2 RBI · 1 R');
});

test('A SWEPT CLUB STOPS SCORING AND NOTHING IS ZEROED', () => {
  // The relay's own rule, and the mock draws it: Judge's slot is marked OUT
  // and KEEPS 7.0. Zeroing would punish a reader twice for one call and make
  // the board unreadable - a 0 is indistinguishable from never appearing.
  const rows = [
    g(200, 3, { at_bats: 4, hits: 1, rbi: 1 }),   // 5
    g(201, 3, { at_bats: 3, hits: 1 }),           // 3
  ];
  const c = scoreRoster(ROSTER, rows, CLUBS);
  const swept = c.slots.find((s) => s.slot === 'bat3');
  assert.equal(swept.state, 'out');
  assert.equal(swept.points, 8, 'kept, not zeroed');
  assert.equal(swept.abbr, 'NYY');
  // The alive ones are not marked out.
  assert.equal(c.slots.find((s) => s.slot === 'bat1').state, 'pending');
  assert.equal(c.out, 3, 'bat3, bat6 and bat7 are on eliminated clubs');
  assert.equal(c.alive, 6);
  // AND THE TOTAL STILL INCLUDES THEM.
  assert.equal(c.total, 8);
});

test('A PLAYER WHO DID NOT APPEAR SCORES 0 ONLY ONCE HIS CLUB HAS PLAYED', () => {
  const played = scoreRoster(ROSTER, [], CLUBS);
  // Every club has gamesPlayed 2, so a player with no rows sat them out: 0,
  // not null. The bench is a risk the picker took.
  assert.ok(played.slots.every((s) => s.points === 0));
  // Before a club plays at all there is NO NUMBER - "no line yet" is a
  // different thing from "did not play", and only true while the round is
  // ahead of them.
  const unplayed = scoreRoster(ROSTER, [], CLUBS.map((c) => ({ ...c, gamesPlayed: 0 })));
  assert.ok(unplayed.slots.every((s) => s.points === null));
  assert.equal(unplayed.total, 0);
});

test('AN ARM SCORES AS AN ARM across the round', () => {
  const rows = [
    g(300, 10, { outs_recorded: 21, strikeouts_pitched: 11, earned_runs: 1, wins: 1, hits_allowed: 4, walks_allowed: 1 }),
    g(301, 10, { outs_recorded: 18, strikeouts_pitched: 7, earned_runs: 2, hits_allowed: 5, walks_allowed: 2 }),
  ];
  const c = scoreRoster(ROSTER, rows, CLUBS);
  const arm = c.slots.find((s) => s.slot === 'arm1');
  // G1: 15.75 + 22 + 4 - 2 - 2.4 - 0.6 = 36.75
  // G2: 13.5 + 14 - 4 - 3 - 1.2 = 19.3
  assert.equal(arm.points, 56.1);
  assert.equal(arm.games, 2);
  assert.match(arm.line, /13\.0 IP · 18 K · 3 ER · W/);
});

test('A POSTPONED GAME IS SIMPLY NOT PLAYED YET', () => {
  // There is no special case: the round's stat rows are whatever exists, and
  // a game not yet played has none. The round does not settle until its last
  // SERIES is decided, which a postponed game cannot be part of.
  const rows = [g(400, 1, { at_bats: 4, hits: 2, doubles: 1, rbi: 2 })];
  const partial = scoreRoster(ROSTER, rows, CLUBS.map((c) => ({ ...c, gamesPlayed: 1 })));
  assert.equal(partial.slots.find((s) => s.slot === 'bat1').games, 1);
  assert.equal(partial.slots.find((s) => s.slot === 'bat1').points, 12);
  // When the makeup is played the same roster picks it up, no carry by hand.
  const later = scoreRoster(ROSTER, [...rows, g(401, 1, { at_bats: 4, hits: 3, home_runs: 1, rbi: 3 })], CLUBS);
  assert.equal(later.slots.find((s) => s.slot === 'bat1').points, 12 + (2 * 3 + 10 + 6));
});

test('ALIVE IS DERIVED FROM THE SERIES, never stored', () => {
  const series = [
    { key: 'wild_card:CHW-TB', winner: 1, teams: [{ id: 1, abbreviation: 'TB' }, { id: 2, abbreviation: 'CHW' }],
      games: [{ status: 'final' }, { status: 'final' }] },
    { key: 'wild_card:BOS-NYY', winner: null, teams: [{ id: 3, abbreviation: 'NYY' }, { id: 4, abbreviation: 'BOS' }],
      games: [{ status: 'final' }, { status: 'live' }] },
  ];
  const clubs = clubStateFrom(series, []);
  const by = new Map(clubs.map((c) => [c.abbr, c]));
  assert.equal(by.get('TB').alive, true);
  assert.equal(by.get('CHW').alive, false, 'lost the series');
  // AN UNDECIDED SERIES LEAVES BOTH ALIVE - that is what "2 going to game 3"
  // means on the mock's sub-line.
  assert.equal(by.get('NYY').alive, true);
  assert.equal(by.get('BOS').alive, true);
  assert.equal(by.get('TB').gamesPlayed, 2);
  assert.equal(by.get('NYY').gamesPlayed, 1, 'only the final one counts as played');
  // A club on the board with no series row keeps its entry rather than
  // vanishing from a roster that named it.
  const withBoard = clubStateFrom([], [{ teamId: 9, abbr: 'MIL' }]);
  assert.deepEqual(withBoard, [{ teamId: 9, abbr: 'MIL', gamesPlayed: 0, alive: true }]);
});

test('THE OCTOBER TOTAL is the sum of settled rounds, and a DNF is 0', () => {
  const rounds = [
    { settled: true, state: 'set', points: 94.5 },
    { settled: true, state: DNF, points: 41.0 },   // scored, never counted
    { settled: true, state: 'set', points: 63.5 },
    { settled: false, state: 'open', points: 12.0 },
  ];
  assert.deepEqual(runTotal(rounds), { total: 158, rounds: 3, dnf: 1, of: 9 });
  assert.equal(runTotal([]).total, 0);
  assert.equal(SLOTS.length, 9);
});
