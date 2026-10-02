// lib/six/pool.test.mjs - the pool's pure half, the lobby row, the league key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolRows, injuryMap, withInjuries, outIdsOf, isOutStatus, shortName } from './pool.js';
import { sixItem, PLAY_REGISTRY } from '../games/playRegistry.js';
import { LEAGUE_GAME_TYPES, isLeagueGame } from '../leagues/gameTypes.js';

const BOARD = [{ match_id: 7, home_team_id: 1, away_team_id: 2, home: { abbr: 'HOU' }, away: { abbr: 'GSW' } }];
const TEAMS = new Map([['1', { pid: '11', abbr: 'HOU' }], ['2', { pid: '10', abbr: 'GSW' }]]);
const P = (id, first, last, position, team) => ({ id, first_name: first, last_name: last, position, team: { id: team } });

test('poolRows: one row per rostered player of a club on the slate, FP/G from this season or last', () => {
  const roster = [
    P(115, 'Stephen', 'Curry', 'G', 10), P(140, 'Kevin', 'Durant', 'F', 11),
    P(999, 'Rook', 'Ie', 'F', 11), P(5, 'Not', 'Tonight', 'C', 99),
  ];
  const current = new Map([['140', { gp: 2, pts: 30, reb: 8, ast: 4, stl: 1, blk: 1, tov: 3, fg3m: 2, dd2: 0, td3: 0 }]]);
  const previous = new Map([['115', { gp: 43, pts: 26.6, reb: 3.6, ast: 4.7, stl: 1.1, blk: 0.4, tov: 2.8, fg3m: 4.4, dd2: 3, td3: 0 }]]);
  const by = poolRows({ board: BOARD, teams: TEAMS, roster, current, previous, season: 2026 });
  const rows = by['7'];
  assert.deepEqual(rows.map((r) => r.playerId), ['140', '115', '999'], 'sorted by FP/G, the no-line rookie last; a club not on the slate is not offered');
  const durant = rows.find((r) => r.playerId === '140');
  assert.deepEqual([durant.team, durant.teamId, durant.opp, durant.home, durant.fppgSeason], ['HOU', 1, 'GSW', true, 2026]);
  const curry = rows.find((r) => r.playerId === '115');
  assert.deepEqual([curry.short, curry.opp, curry.home, curry.fppgSeason], ['S. Curry', 'HOU', false, 2025], 'last season stands in on opening night');
  assert.equal(rows.find((r) => r.playerId === '999').fppg, null);
});

test('injuries: Out and Out For Season take a player out; Questionable does not; nobody is removed', () => {
  assert.ok(isOutStatus('Out')); assert.ok(isOutStatus('Out For Season')); assert.ok(!isOutStatus('Questionable'));
  const inj = { at: 'x', byPlayer: injuryMap([{ player: { id: 79 }, status: 'Out' }, { player: { id: 115 }, status: 'Questionable' }, { player: {}, status: 'Out' }]) };
  assert.deepEqual(inj.byPlayer, { 79: 'Out', 115: 'Questionable' });
  assert.deepEqual([...outIdsOf(inj)], ['79']);
  const pool = { byGame: { 7: [{ playerId: '79', fppg: 40 }, { playerId: '115', fppg: 30 }, { playerId: '140', fppg: 20 }] } };
  const w = withInjuries(pool, inj);
  assert.deepEqual(w.byGame['7'].map((r) => [r.playerId, r.injury, r.out]), [['115', 'Questionable', false], ['140', null, false], ['79', 'Out', true]],
    'Out sinks to the bottom, still listed');
  assert.equal(shortName('Nikola Jokic'), 'N. Jokic');
});

// THE PLAY LOBBY (thu-38 + fri-1): the registry item carries the next tip as
// an instant (rendered in the page's zone), not "4:00 PM PT" in its words.
test("the lobby item: next tip while a slot is open, 'all tipped' after - never DNF", () => {
  const now = new Date('2026-10-21T20:00:00Z');
  const e = PLAY_REGISTRY.find((x) => x.key === 'nba-six');
  const open = sixItem(e, { st: { games: 3, filled: 4, locked: 0, size: 6, nextTip: '2026-10-21T23:00:00Z' } }, { signedIn: true, now });
  assert.equal(open.key, 'nba-six'); assert.equal(open.href, '/six');
  assert.equal(open.status, '4 of 6');
  assert.deepEqual(open.at, { iso: '2026-10-21T23:00:00Z', words: 'next tip' });
  assert.equal(sixItem(e, { st: { games: 3, filled: 6, locked: 6, size: 6, nextTip: null } }, { signedIn: true, now }).status, '3 games · all tipped · 6 of 6 in play');
  assert.equal(sixItem(e, { st: { games: 1, filled: 5, locked: 5, size: 6, nextTip: null } }, { signedIn: true, now }).status, '1 game · all tipped · 5 of 6 in play');
});

test("the league key is registered: 'six', NBA", () => {
  assert.deepEqual(LEAGUE_GAME_TYPES.find((g) => g.key === 'six'), { key: 'six', label: "Tonight's Six", sports: ['nba'] });
  assert.ok(isLeagueGame('six'));
});

test('the live chip: period and clock, separated so they never read as one number', async () => {
  const { liveChip } = await import('./entry.js');
  assert.equal(liveChip({ period: 4, clock: '2:31' }), 'Q4 · 2:31');
  assert.equal(liveChip({ period: 5, clock: '0:41' }), 'OT · 0:41');
  assert.equal(liveChip({ period: 2, clock: '0:00' }), 'Half', 'the half is a state, not a clock');
  assert.equal(liveChip(null), 'LIVE');
});
