// lib/daily/boardGenerator.test.mjs — rules (a), (b), (c), (e), (f), each
// proven on a constructed fixture before anything touches real season data.
// Rule (d) is dropped (no win-loss source exists for any season); teams may
// repeat across boards (see boardScheduling.test.mjs for that mechanic).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCard, cardsBySeasonTeam, drawTeams, generateBoard, TEAM_COUNT, CARD_MAX } from './boardGenerator.js';
import { makeRng } from './pool.js';

// A minimal real-shaped row: only the fields fantasyPoints(toSeasonStatLine())
// actually reads, plus team_key/position, which buildCard needs.
const row = (team_key, position, over) => ({
  team_key, position, pass_yds: 0, pass_td: 0, pass_int: 0,
  rush_yds: 0, rush_td: 0, rec: 0, rec_yds: 0, rec_td: 0,
  fumbles_lost: null, fgm: 0, xp: 0, sacks: 0, def_int: 0, def_td: 0,
  ...over,
});

test('(b) positional surplus - a team with three real RBs shows three RBs, not one', () => {
  const rows = [
    row('T', 'RB', { rush_yds: 900, rush_td: 8 }),
    row('T', 'RB', { rush_yds: 700, rush_td: 5 }),
    row('T', 'RB', { rush_yds: 500, rush_td: 3 }),
    row('T', 'QB', { pass_yds: 3000, pass_td: 20 }),
  ];
  const { players } = buildCard(rows);
  assert.equal(players.filter((p) => p.position === 'RB').length, 3, 'no per-position cap - surplus shows');
});

test('(a) the standout is the card\'s own top scorer, read off the FINAL card', () => {
  const rows = [
    row('T', 'QB', { pass_yds: 4000, pass_td: 35 }), // clearly the best line here
    row('T', 'RB', { rush_yds: 400, rush_td: 2 }),
    row('T', 'WR', { rec: 40, rec_yds: 500, rec_td: 3 }),
  ];
  const { standout } = buildCard(rows);
  assert.equal(standout.position, 'QB');
});

test('(c) a kicker survives only when the card also holds something better (PPR_FLOOR)', () => {
  const goodTeam = [
    row('T', 'PK', { fgm: 25, xp: 30 }),
    row('T', 'QB', { pass_yds: 3500, pass_td: 25 }), // well over PPR_FLOOR
  ];
  const { players: goodCard } = buildCard(goodTeam);
  assert.ok(goodCard.some((p) => p.position === 'PK'), 'the kicker stays - the team has something better');

  const badTeam = [
    row('T', 'PK', { fgm: 25, xp: 30 }),
    row('T', 'QB', { pass_yds: 50, pass_td: 0 }), // 50/25 = 2pts, under PPR_FLOOR (4)
  ];
  const { players: badCard, standout } = buildCard(badTeam);
  assert.ok(!badCard.some((p) => p.position === 'PK'), 'the kicker is cut - nothing else clears the bar');
  assert.notEqual(standout?.position, 'PK', 'the standout can never be a kicker riding alone');
});

test('(c) a team whose ONLY real activity is its kicker fails fillability honestly', () => {
  const rows = [row('T', 'PK', { fgm: 20, xp: 22 })];
  const { players, standout } = buildCard(rows);
  assert.deepEqual(players, [], 'the kicker-only card is empty, not a card of one');
  assert.equal(standout, null);
});

test('a team with zero eligible rows gets an empty card, not a crash', () => {
  assert.deepEqual(buildCard([]), { players: [], standout: null });
  assert.deepEqual(buildCard(undefined), { players: [], standout: null });
});

test('cardsBySeasonTeam groups by team_key and drops off-board positions before scoring', () => {
  const rows = [
    row('T1', 'QB', { pass_yds: 3000, pass_td: 20 }),
    row('T1', 'CB', { def_int: 4 }), // no slot on this board - must not appear
    row('T2', 'RB', { rush_yds: 1000, rush_td: 9 }),
  ];
  const cards = cardsBySeasonTeam(rows);
  assert.equal(cards.size, 2);
  assert.equal(cards.get('T1').players.length, 1);
  assert.equal(cards.get('T1').players[0].position, 'QB');
});

// ------------------------------------------------------- the team draw

function fillableTeamCards(n) {
  const cards = new Map();
  for (let i = 0; i < n; i++) {
    const key = `T${i}`;
    cards.set(key, buildCard([
      row(key, 'QB', { pass_yds: 3000 + i, pass_td: 20 }),
      row(key, 'RB', { rush_yds: 900 + i, rush_td: 6 }),
      row(key, 'WR', { rec: 70, rec_yds: 900 + i, rec_td: 6 }),
      row(key, 'PK', { fgm: 25, xp: 30 }),
    ]));
  }
  return cards;
}

test('(f) per-team fillability - a card-less team never enters the draw pool', () => {
  const cards = fillableTeamCards(TEAM_COUNT);
  cards.set('DEAD', { players: [], standout: null }); // unfillable
  const draw = drawTeams(cards, makeRng('seed-1'));
  assert.equal(draw.ok, true);
  assert.ok(!draw.teams.some((t) => t.key === 'DEAD'), 'the unfillable team was never eligible to be drawn');
});

test('refuses rather than shrinking when fewer than TEAM_COUNT teams are fillable', () => {
  const cards = fillableTeamCards(TEAM_COUNT - 1);
  const draw = drawTeams(cards, makeRng('seed-2'));
  assert.equal(draw.ok, false);
  assert.equal(draw.reason, 'fewer fillable teams than the draw needs');
  assert.deepEqual(draw.teams, []);
});

test('(e) shuffled draw - two different seeds draw different team sets from a larger pool', () => {
  const cards = fillableTeamCards(24);
  const d1 = drawTeams(cards, makeRng('seed-A'));
  const d2 = drawTeams(cards, makeRng('seed-B'));
  assert.equal(d1.ok, true); assert.equal(d2.ok, true);
  const keys1 = new Set(d1.teams.map((t) => t.key));
  const keys2 = new Set(d2.teams.map((t) => t.key));
  assert.notDeepEqual([...keys1].sort(), [...keys2].sort(), 'two seeds over a 24-team pool should not draw the identical 12');
});

test('drawTeams draws from the FULL fillable pool every time - teams may repeat across independent draws', () => {
  // Exactly TEAM_COUNT fillable teams: every draw MUST use all of them,
  // proving nothing is excluded by a prior call (there is no prior-call
  // state at all - drawTeams takes no history).
  const cards = fillableTeamCards(TEAM_COUNT);
  const d1 = drawTeams(cards, makeRng('rep-1'));
  const d2 = drawTeams(cards, makeRng('rep-2'));
  assert.equal(d1.ok, true); assert.equal(d2.ok, true);
  assert.deepEqual([...d1.teams.map((t) => t.key)].sort(), [...d2.teams.map((t) => t.key)].sort(),
    'both draws had to use the same 12 teams - the only 12 that exist - proving no cross-call exclusion');
});

test('generateBoard is the one-call path: raw rows + rng -> a drawn board', () => {
  const rows = [];
  for (let i = 0; i < TEAM_COUNT; i++) {
    rows.push(
      row(`T${i}`, 'QB', { pass_yds: 3000 + i * 10, pass_td: 20 }),
      row(`T${i}`, 'RB', { rush_yds: 900, rush_td: 6 }),
      row(`T${i}`, 'WR', { rec: 70, rec_yds: 900, rec_td: 6 }),
      row(`T${i}`, 'TE', { rec: 40, rec_yds: 500, rec_td: 3 }),
      row(`T${i}`, 'PK', { fgm: 25, xp: 30 }),
    );
  }
  const draw = generateBoard(rows, makeRng('seed-5'));
  assert.equal(draw.ok, true);
  assert.equal(draw.teams.length, TEAM_COUNT);
  for (const t of draw.teams) assert.ok(t.card.length >= 1 && t.card.length <= CARD_MAX);
});
