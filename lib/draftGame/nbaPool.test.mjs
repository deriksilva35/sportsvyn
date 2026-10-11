// lib/draftGame/nbaPool.test.mjs - the NBA pool and NBA scoring, pure (mon-1 S3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeNbaPool } from './nbaPool.js';
import { scoreSeat } from './settle.js';
import { POOL_MAX } from './pool.js';

const teams = new Map([['1', { id: 101, abbr: 'AAA' }], ['2', { id: 102, abbr: 'BBB' }]]);
const P = (id, team, pos = 'G') => ({ id, first_name: 'P', last_name: String(id), position: pos, team: { id: team } });
// A season line worth ~ pts FP/G (points only, 1 per point).
const S = (pts, gp = 10) => ({ gp, pts, reb: 0, ast: 0, stl: 0, blk: 0, turnover: 0, fg3m: 0, dd2: 0, td3: 0 });

test('both clubs, best first; Out is out, no season line is out, the other teams are out', () => {
  const roster = [P(1, '1'), P(2, '1'), P(3, '2'), P(4, '2'), P(5, '9')];
  const current = new Map([['1', S(30)], ['3', S(20)], ['5', S(40)]]);
  const previous = new Map([['4', S(10)]]);
  const rows = shapeNbaPool({ teams, roster, current, previous, injuries: { 3: 'Out', 4: 'Questionable' } });
  assert.deepEqual(rows.map((r) => r.id), [1, 4], 'P2 has no line, P3 is Out, P5 plays for neither club');
  assert.equal(rows.find((r) => r.id === 4).proj > 0, true, 'last season stands in on opening night');
  assert.equal(rows[0].team, 'AAA'); assert.equal(rows[0].team_id, 101);
});

test('the last-3 rule applies to a club only once it has a boxed game this season', () => {
  const roster = [P(1, '1'), P(2, '1'), P(3, '2'), P(4, '2')];
  const current = new Map([['1', S(30)], ['2', S(25)], ['3', S(20)], ['4', S(15)]]);
  // Club 101 has played: only player 1 appeared in its last 3. Club 102 has not played yet.
  const rows = shapeNbaPool({ teams, roster, current, active: new Map([[101, new Set(['1'])]]) });
  assert.deepEqual(rows.map((r) => r.id).sort(), [1, 3, 4]);
});

test('the pool is capped at POOL_MAX', () => {
  const roster = Array.from({ length: POOL_MAX + 6 }, (_, i) => P(i + 1, i % 2 ? '1' : '2'));
  const current = new Map(roster.map((p, i) => [String(p.id), S(10 + i)]));
  assert.equal(shapeNbaPool({ teams, roster, current }).length, POOL_MAX);
});

test('NBA scoring: linePoints, a DNP row did not play and scores 0, best 3 count', () => {
  const row = (pts, extra = {}) => ({ dnp: false, pts, reb: 0, ast: 0, stl: 0, blk: 0, turnovers: 0, fg3m: 0, ...extra });
  const stats = new Map([[1, row(30)], [2, row(10, { reb: 10 })], [3, { dnp: true, pts: 0 }], [4, row(8)]]);
  const picks = [1, 2, 3, 4].map((id, i) => ({ id, n: i * 4 + 1, name: `P${id}`, pos: 'G', team: 'AAA' }));
  const r = scoreSeat(picks, stats, 'nba');
  const p2 = r.players.find((p) => p.id === 2);
  assert.equal(p2.pts, 10 + 12.5 + 1.5, '10 pts + 10 reb x1.25 + the double-double bonus');
  const dnp = r.players.find((p) => p.id === 3);
  assert.equal(dnp.played, false); assert.equal(dnp.pts, 0); assert.equal(dnp.counted, false);
  assert.equal(r.score, 30 + 24 + 8);
  assert.match(r.players.find((p) => p.id === 1).line, /30 PTS/);
});

test('the NBA switch: NBA boards need DRAFT_GAME_BOARDS and DRAFT_GAME_NBA both on; NFL ignores the NBA switch', async () => {
  const { enabledSports, nbaEnabled, ensureGameBoards } = await import('./create.js');
  assert.deepEqual(enabledSports({ DRAFT_GAME_BOARDS: 'on', DRAFT_GAME_NBA: 'on' }), ['nfl', 'nba']);
  assert.deepEqual(enabledSports({ DRAFT_GAME_BOARDS: 'on', DRAFT_GAME_NBA: 'off' }), ['nfl']);
  assert.deepEqual(enabledSports({ DRAFT_GAME_BOARDS: 'on' }), ['nfl'], 'unset is off');
  assert.deepEqual(enabledSports({ DRAFT_GAME_BOARDS: 'off', DRAFT_GAME_NBA: 'on' }), [], 'the master switch rules both');
  assert.equal(nbaEnabled({ DRAFT_GAME_BOARDS: 'on', DRAFT_GAME_NBA: ' ON ' }), true);
  assert.equal(nbaEnabled({ DRAFT_GAME_BOARDS: 'on', DRAFT_GAME_NBA: 'true' }), false);
  // With the master off, the run makes nothing and reads nothing.
  assert.equal((await ensureGameBoards({ env: { DRAFT_GAME_BOARDS: 'off', DRAFT_GAME_NBA: 'on' } })).disabled, true);
});
