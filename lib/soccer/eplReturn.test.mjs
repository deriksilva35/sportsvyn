// lib/soccer/eplReturn.test.mjs - EPL comes back (thu-24): the first PROD run
// names its plan, and the crons that went with soccer are scheduled again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiSportsPlan } from './epl.js';

const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('THE PLAN, from /status: name, active, end, today\'s count - and an error never throws', async () => {
  const ok = await apiSportsPlan({ status: async () => ({ subscription: { plan: 'Ultra', active: true, end: '2027-04-01T07:40:58+00:00' }, requests: { current: 10, limit_day: 75000 } }) });
  assert.deepEqual(ok, { plan: 'Ultra', active: true, end: '2027-04-01T07:40:58+00:00', requestsToday: 10, limitDay: 75000 });
  const arr = await apiSportsPlan({ status: async () => [{ subscription: { plan: 'Free' }, requests: {} }] });
  assert.equal(arr.plan, 'Free');
  assert.deepEqual(await apiSportsPlan({ status: async () => { throw new Error('down'); } }), { error: 'down' });
});

test('THE FIXTURE RUN carries the plan in its summary, and a failed run names it in its error', () => {
  const r = src('app/api/cron/epl-fixtures/route.js');
  assert.match(r, /const apiSportsAccount = await apiSportsPlan\(\);/);
  assert.match(r, /return \{ \.\.\.\(await syncEpl\(\)\), apiSports: apiSportsAccount \};/);
  assert.match(r, /\[api-sports plan: \$\{apiSportsAccount\.plan \?\? apiSportsAccount\.error\}\]/);
  assert.match(src('lib/apiSports.js'), /status: \(\) => get\('\/status'\)/);
});

test('THE CRONS are back at their old minutes; poll-live is not', () => {
  const crons = JSON.parse(src('vercel.json')).crons;
  const at = (p) => crons.find((c) => c.path === `/api/cron/${p}`)?.schedule;
  assert.equal(at('epl-fixtures'), '25 13 * * *');
  assert.equal(at('epl-standings'), '26 13 * * *');
  assert.equal(at('epl-player-stats'), '30 20,2 * * *');
  assert.equal(at('epl-live'), '* * * * *');
  assert.equal(at('poll-live'), undefined);
  assert.equal(at('gridiron-odds'), '*/15 * * * *');
  assert.equal(at('gridiron-props'), '0 13,17,21,23 * * *');
  assert.match(src('app/api/cron/gridiron-props/route.js'), /\{ sport: 'epl', slug: 'epl', source: 'epl-props' \}/);
});

test('EPL ONLY: the World Cup, the friendlies and editorial stay retired', async () => {
  const { RETIRED_ROUTES, isRetiredLeague } = await import('../retired.js');
  for (const k of ['/world-cup', '/world-cup-2026', '/bracket', '/schedule', '/stats', '/today', '/article']) assert.ok(k in RETIRED_ROUTES, k);
  assert.ok(!('/epl' in RETIRED_ROUTES));
  assert.equal(isRetiredLeague('epl'), false);
  assert.equal(isRetiredLeague('fifa-wc-2026'), true);
});
