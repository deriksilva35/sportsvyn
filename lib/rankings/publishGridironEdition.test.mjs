// lib/rankings/publishGridironEdition.test.mjs - the pure half of the
// publisher: the tie rule, the movement rule, and what the field IS.
//
// THE DATABASE HALF IS NOT TESTED HERE and that is deliberate: it is one
// INSERT per row and two UPDATEs, and a test that mocked `sql` would assert
// that I wrote the SQL I wrote. What CAN be wrong without anybody noticing is
// the arithmetic in between - who is in the field, who shares a rank, and what
// a "previous" is - so that is what is pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildEntries, rankBySort, applyMovement, LEAGUE_CONFIG, AP_FIELD_SIZE, METHODOLOGY_VERSION,
} from './publishGridironEdition.js';
import { FCS_KEY } from '../ratings/elo.js';

const team = (id, abbr, classification = 'fbs') => ({ id, abbreviation: abbr, name: abbr, shortName: abbr, classification });
const seat = (elo, history = []) => ({ elo, games: history.length, history });
const game = (gameId, opp, result, margin, eloBefore, eloAfter) =>
  ({ gameId, opp, result, margin, eloBefore, eloAfter, home: true, season: 2026, phase: 'REG', kickoffAt: '2026-09-06T17:00:00Z' });

test('TIES SHARE A RANK AND THE NEXT RANK SKIPS - 1, 2, 2, 4', () => {
  const ranked = rankBySort([
    { teamId: 4, score: 6 }, { teamId: 1, score: 9 }, { teamId: 3, score: 8 }, { teamId: 2, score: 8 },
  ]);
  assert.deepEqual(ranked.map((r) => [r.teamId, r.rank]), [[1, 1], [2, 2], [3, 2], [4, 4]]);
  // Within a tie the order is by team id - stable, so a re-run cannot reorder
  // two teams that are on the same number, which would look like movement.
  assert.deepEqual(rankBySort([{ teamId: 9, score: 8 }, { teamId: 2, score: 8 }]).map((r) => r.teamId), [2, 9]);
  // A whole field on one score is all rank 1.
  assert.deepEqual(rankBySort([{ teamId: 1, score: 5 }, { teamId: 2, score: 5 }, { teamId: 3, score: 5 }])
    .map((r) => r.rank), [1, 1, 1]);
  assert.deepEqual(rankBySort([]), []);
});

test('THE FIELD IS THE PUBLISHABLE TEAMS: FCS is rated, pooled, and NOT an entry', () => {
  const table = new Map([
    [10, seat(1600, [game(1, FCS_KEY, 'W', 42, 1500, 1600)])],
    [11, seat(1400, [game(2, 10, 'L', 7, 1500, 1400)])],
    [FCS_KEY, seat(1100, [game(1, 10, 'L', 42, 1500, 1100)])],
    [99, seat(1500, [])],                                  // a rated id with no team row
  ]);
  const teams = [team(10, 'AAA'), team(11, 'BBB'), team(901, 'FCS1', 'fcs')];
  const rows = buildEntries({ table, teams, apByTeam: new Map(), cfg: LEAGUE_CONFIG.nfl });
  assert.deepEqual(rows.map((r) => r.teamId), [10, 11], 'the pool and the unknown id are both absent');
  assert.equal(rows.some((r) => r.teamId === FCS_KEY), false);
  // The pool DOES shape the field it is not in: team 10 beat it, and that win
  // is in team 10's last3 under the pool's own label.
  assert.deepEqual(rows.find((r) => r.teamId === 10).inputs.last3,
    [{ opp: FCS_KEY, result: 'W', margin: 42 }]);
  // An FCS team that somehow reached the table by id is still excluded by its
  // classification, not only by its key.
  const withFcsId = buildEntries({
    table: new Map([[10, seat(1600, [])], [901, seat(1200, [])]]),
    teams, apByTeam: new Map(), cfg: LEAGUE_CONFIG.nfl,
  });
  assert.deepEqual(withFcsId.map((r) => r.teamId), [10]);
});

test('THE INPUTS BLOB CARRIES THE WORKING, in the shape migration 108 documents', () => {
  const table = new Map([
    [10, seat(1600, [game(1, 11, 'W', 7, 1500, 1550), game(2, 12, 'W', 3, 1550, 1600)])],
    [11, seat(1400, [game(1, 10, 'L', 7, 1500, 1400)])],
  ]);
  const teams = [team(10, 'AAA'), team(11, 'BBB'), team(12, 'CCC')];
  const rows = buildEntries({
    table, teams, apByTeam: new Map([[10, 3]]), cfg: LEAGUE_CONFIG.cfb,
  });
  const top = rows.find((r) => r.teamId === 10);
  assert.deepEqual(Object.keys(top.inputs).sort(), ['ap', 'delta3', 'elo', 'last3', 'weights']);
  assert.equal(top.inputs.elo, 1600);
  assert.equal(top.inputs.delta3, 100, '1600 - 1500, the chain end to end');
  assert.deepEqual(top.inputs.last3, [
    { opp: 'BBB', result: 'W', margin: 7 }, { opp: 'CCC', result: 'W', margin: 3 },
  ], 'opponents by the abbreviation a reader sees, not by id');
  // AP 3 on a 25-team field, through the same curve sitesLayer.test.mjs pins.
  assert.equal(AP_FIELD_SIZE, 25);
  assert.deepEqual(top.inputs.ap, { rank: 3, score: 8.77 });
  assert.equal(top.apScore, 8.77);
  assert.deepEqual(top.inputs.weights, { editorial: 0.7, sites: 0.3 });
  // AN UNRANKED TEAM CARRIES ap: null, not a zero and not an absent key.
  const un = rows.find((r) => r.teamId === 11);
  assert.equal(un.inputs.ap, null);
  assert.equal(un.apRank, null); assert.equal(un.apScore, null);
  // TWO OF FIVE DIMENSIONS, every row, and the three held ones are named.
  assert.deepEqual(top.scoredDims, ['result', 'momentum']);
  assert.deepEqual(top.heldDims, ['process', 'squad', 'coherence']);
});

test('THE NFL CARRIES NO AP AT ALL, by configuration and not by an empty map', () => {
  const table = new Map([[10, seat(1600, [])], [11, seat(1400, [])]]);
  const teams = [team(10, 'AAA'), team(11, 'BBB')];
  // Even handed a poll, an NFL edition must not blend one in.
  const rows = buildEntries({ table, teams, apByTeam: new Map([[10, 1]]), cfg: LEAGUE_CONFIG.nfl });
  for (const r of rows) {
    assert.equal(r.apRank, null); assert.equal(r.apScore, null); assert.equal(r.inputs.ap, null);
  }
  assert.equal(LEAGUE_CONFIG.nfl.usesAp, false);
  assert.deepEqual(rows[0].inputs.weights, { editorial: 1, sites: 0 });
});

test('MOVEMENT COMES FROM A PRIOR EDITION, and NO prior is "new" - never zero', () => {
  const rows = [{ teamId: 1, rank: 1, score: 9 }, { teamId: 2, rank: 2, score: 8 }, { teamId: 3, rank: 3, score: 7 }];
  const prior = { byTeam: new Map([[1, { rank: 3, score: 6.5 }], [2, { rank: 2, score: 8 }]]) };
  applyMovement(rows, prior);
  // POSITIVE MEANS CLIMBED - 3rd to 1st is +2, the convention lib/cfb/
  // rankings.js already uses for the AP poll's own movement.
  assert.deepEqual(rows.map((r) => [r.teamId, r.previousRank, r.rankMovement, r.movementLabel]), [
    [1, 3, 2, 'up'], [2, 2, 0, 'hold'], [3, null, null, 'new'],
  ]);
  assert.equal(rows[0].scoreMovement, 2.5);
  assert.equal(rows[1].scoreMovement, 0);
  assert.equal(rows[2].scoreMovement, null, 'a new team has no score to have moved from');
  // NO PRIOR AT ALL - the first computed edition - is every row "new", which
  // is what stops a movement glyph appearing on edition 1.
  applyMovement(rows, null);
  assert.deepEqual(rows.map((r) => r.movementLabel), ['new', 'new', 'new']);
  assert.deepEqual(rows.map((r) => r.rankMovement), [null, null, null]);
});

test('EDITION 0 IS NEVER A PREVIOUS - the prior is found by methodology_version', () => {
  // The hand-seeded boards are methodology_version '1.0'; every edition this
  // file writes is '3.0', and loadPriorComputedEdition filters on exactly that.
  // Asserting the constant here is what keeps the two halves in step: change
  // the version string without changing the lookup and edition 0 becomes a
  // previous again, which is the one thing the header forbids.
  assert.equal(METHODOLOGY_VERSION, '3.0');
  const src = readSource('lib/rankings/publishGridironEdition.js');
  assert.match(src, /methodology_version = \$\{METHODOLOGY_VERSION\}/,
    'the prior lookup must filter on the computed methodology version');
  assert.equal(/edition_number\s*>\s*0/.test(src), false,
    'and must NOT identify a computed edition by its number, which a re-seed could reuse');
});

const readSource = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
