// lib/rankings/failurePush.test.mjs - a failed publish buzzes the admin's phone (tue-6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pushPublishFailure, eventIdFor } from './failurePush.js';
import { copyFor } from '../push/copy.js';
import { ADMIN_USER_IDS } from '../admin/gate.js';

test('ONE EVENT PER LIST PER UTC DAY, to the admin account, with the list named', async () => {
  const calls = [];
  const notify = async (id, recipients) => { calls.push({ id, recipients }); return { sent: 1 }; };
  const r = await pushPublishFailure({ list: 'nfl-power', now: new Date('2026-09-29T13:05:25Z'), notify });
  assert.deepEqual(r, { sent: 1 });
  assert.equal(calls[0].id, 'ops-power-edition-failed:nfl-power:2026-09-29');
  assert.deepEqual(calls[0].recipients, ADMIN_USER_IDS.map((userId) => ({ userId, params: { list: 'nfl-power' } })));
  assert.notEqual(eventIdFor('nfl-power-z', new Date('2026-09-29T13:05Z')), eventIdFor('nfl-power', new Date('2026-09-29T13:05Z')), 'two lists, two pushes');
  assert.notEqual(eventIdFor('nfl-power', new Date('2026-10-06T13:05Z')), calls[0].id, 'next Tuesday is a new event');
});

test('A PUSH THAT CANNOT BE SENT NEVER THROWS INTO THE ROUTE', async () => {
  const r = await pushPublishFailure({ list: 'nfl-power', notify: async () => { throw new Error('apns down'); } });
  assert.deepEqual(r, { error: 'apns down' });
});

test('THE COPY EXISTS and names the list', () => {
  const c = copyFor('ops-power-edition-failed:nfl-power:2026-09-29');
  assert.ok(c, 'an unknown prefix would be skipped silently');
  assert.match(c.body, /\{list\}/);
});

test('THE ROUTE PUSHES ON BOTH FAILURES - the Elo board and nfl-power-z - and only on failure', () => {
  const src = readFileSync(new URL('../../app/api/cron/power-edition/route.js', import.meta.url), 'utf8');
  const elo = src.slice(src.indexOf('if (!res.ok) {'));
  assert.match(elo.slice(0, elo.indexOf('\n  }\n')), /await pushPublishFailure\(\{ list: LEAGUE_CONFIG\[league\]\.listSlug \}\)/);
  const z = src.slice(src.indexOf("subject: `[pollers] ${SOURCE} FAILED for nfl-power-z`"));
  assert.match(z.slice(0, 400), /await pushPublishFailure\(\{ list: 'nfl-power-z' \}\)/);
  assert.equal((src.match(/pushPublishFailure\(/g) ?? []).length, 2, 'no push on the success path');
});
