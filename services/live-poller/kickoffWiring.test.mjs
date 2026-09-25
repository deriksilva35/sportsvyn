// services/live-poller/kickoffWiring.test.mjs - the poller's MLB kickoff and
// line-score hooks (03a9d1a), kept through the 25 Sep rollback of the BDL live
// state (8607b62 reverted). Their composed DB test lived in mlbBdl.test.mjs,
// which went with the revert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mlbKickoff, writeKickoff } from './poll.mjs';

test('mlbKickoff is BDL\'s own first pitch', () => {
  assert.equal(mlbKickoff({ date: '2026-09-25T21:30:00.000Z' }), '2026-09-25T21:30:00.000Z');
  assert.equal(mlbKickoff({}), null);
});

test('writeKickoff writes only when the time differs, and says whether it did', async () => {
  const seen = [];
  const sql = (strings, ...v) => { seen.push(strings.join('?')); return Promise.resolve(v[0] === 'x' ? [] : [{ id: 1 }]); };
  assert.equal(await writeKickoff(sql, 1, '2026-09-25T21:30:00.000Z'), true);
  assert.equal(await writeKickoff(sql, 1, 'x'), false);
  assert.match(seen[0], /IS DISTINCT FROM/);
});

test('the poller passes the registry\'s detail AND kickoffOf to pollOnce', () => {
  const src = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const at = src.indexOf('await pollOnce(sql, {');
  const call = src.slice(at, src.indexOf('});', at));
  assert.match(call, /detail: lg\.detail \?\? null/);
  assert.match(call, /kickoffOf: lg\.kickoffOf \?\? null/);
  assert.match(src, /kickoffOf: mlbKickoff/);
  assert.match(src, /detail: mlbDetail/);
});
