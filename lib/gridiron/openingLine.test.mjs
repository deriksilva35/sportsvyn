// lib/gridiron/openingLine.test.mjs - the opening spread read (scores-v4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingSpreads } from './openingLine.js';

function stub(rows) {
  const calls = [];
  const db = (strings, ...values) => { calls.push({ sql: strings.join('?'), values }); return Promise.resolve(rows); };
  return { db, calls };
}

test('the read is one index probe per slate match: unnest(ids) LATERAL ... ORDER BY fetched_at LIMIT 1 (migration 117 serves it)', async () => {
  const { db, calls } = stub([]);
  await openingSpreads([30, 10, 30, null, 20], { db });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /unnest\(\?::int\[\]\) AS mid\(id\)/);
  assert.match(calls[0].sql, /CROSS JOIN LATERAL/);
  assert.match(calls[0].sql, /o\.match_id = mid\.id/);
  assert.match(calls[0].sql, /ORDER BY o\.fetched_at ASC, o\.id ASC\s+LIMIT 1/, 'the EARLIEST snapshot per match');
  assert.deepEqual(calls[0].values[0], [10, 20, 30]);
});

test('no ids, no query', async () => {
  const { db, calls } = stub([]);
  assert.equal((await openingSpreads([], { db })).size, 0);
  assert.equal((await openingSpreads(null, { db })).size, 0);
  assert.equal(calls.length, 0);
});

test('oriented to the home side the way the current line is (shapeSpreadRows)', async () => {
  const { db } = stub([
    { match_id: 1, selection_label: 'Chicago Bears', selection_value: '-1.5', home_name: 'Chicago Bears', away_name: 'Philadelphia Eagles' },
    { match_id: 2, selection_label: 'Philadelphia Eagles', selection_value: '-2.5', home_name: 'Chicago Bears', away_name: 'Philadelphia Eagles' },
  ]);
  const m = await openingSpreads([1, 2], { db });
  assert.equal(m.get(1), -1.5, 'home favoured by 1.5');
  assert.equal(m.get(2), 2.5, 'away favoured by 2.5 is +2.5 for home');
});
