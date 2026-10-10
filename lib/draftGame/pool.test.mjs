// lib/draftGame/pool.test.mjs - shapePool, pure (thu-3 S1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapePool, POOL_MAX, PROJ_GAMES } from './pool.js';

const P = (id, pos = 'WR') => ({ id, full_name: `Player ${id}`, position: pos, team_id: id % 2 ? 1 : 2, abbreviation: id % 2 ? 'AAA' : 'BBB' });
// One stat row = 10 receptions for 100 yards = 20.0 PPR.
const line = (id, rec = 10, yds = 100) => ({ nfl_player_id: id, rec, rec_yds: yds });

test('projection is the average PPR of his last games; no game, no place in the pool', () => {
  const rows = shapePool([P(1), P(2), P(3)], [line(1), line(1, 0, 0), line(2)]);
  assert.deepEqual(rows.map((r) => [r.id, r.proj, r.games]), [[2, 20, 1], [1, 10, 2]]);
});

test('only the last PROJ_GAMES games count', () => {
  const stats = [...Array(PROJ_GAMES).fill(0).map(() => line(1)), line(1, 0, 0), line(1, 0, 0)];
  assert.equal(shapePool([P(1)], stats)[0].proj, 20);
});

test('a body under the floor is cut, and the pool is capped at POOL_MAX best first', () => {
  assert.equal(shapePool([P(1)], [line(1, 0, 2)]).length, 0, '0.2 points is not a pick');
  const players = Array.from({ length: POOL_MAX + 10 }, (_, i) => P(i + 1));
  const stats = players.map((p, i) => line(p.id, 1, 10 + i));
  const rows = shapePool(players, stats);
  assert.equal(rows.length, POOL_MAX);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].proj >= r.proj));
});
