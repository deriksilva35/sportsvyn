// lib/gridiron/cfbdRetry.test.mjs - CFBD's 429 is concurrency, not quota: it is
// retried, twice, and everything else fails as before. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.CFBD_API_KEY = process.env.CFBD_API_KEY || 'test-key';
const { cfbdGet, CFBD_429_RETRIES } = await import('./playsImport.js');
const realFetch = globalThis.fetch;
const answer = (status, body = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const run = async (statuses) => {
  const seen = []; const waits = [];
  globalThis.fetch = async (u) => { seen.push(String(u)); const s = statuses.shift(); return s === 200 ? answer(200, [{ id: 1 }]) : answer(s, '{"message":"Too many concurrent requests for this endpoint."}'); };
  try { return { value: await cfbdGet('/live/plays?gameId=1', { wait: async (ms) => { waits.push(ms); } }), seen, waits }; }
  catch (e) { return { error: e, seen, waits }; }
  finally { globalThis.fetch = realFetch; }
};

test('a 429 is retried and the game is imported (26 Sep: 3-7 games a minute lost to it)', async () => {
  const r = await run([429, 200]);
  assert.deepEqual(r.value, [{ id: 1 }]); assert.equal(r.seen.length, 2);
  assert.ok(r.waits[0] >= 1000 && r.waits[0] < 1400, 'about a second, jittered');
  const r2 = await run([429, 429, 200]);
  assert.deepEqual(r2.value, [{ id: 1 }]); assert.equal(r2.seen.length, 3);
  assert.ok(r2.waits[1] >= 2000 && r2.waits[1] < 2400, 'then about two');
});

test('three 429s fail as before, and a 400 is never retried', async () => {
  assert.equal(CFBD_429_RETRIES, 2);
  const r = await run([429, 429, 429]);
  assert.match(String(r.error?.message), /CFBD 429/); assert.equal(r.seen.length, 3);
  const nf = await run([400]);
  assert.match(String(nf.error?.message), /CFBD 400/); assert.equal(nf.seen.length, 1, '"No plays found for game." is an answer, not a busy signal');
});

test('plays-live imports three games at a time, not six', () => {
  const src = readFileSync(new URL('../../app/api/cron/plays-live/route.js', import.meta.url), 'utf8');
  assert.match(src, /^const POOL = 3;$/m);
});
