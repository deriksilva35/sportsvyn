// lib/cfbd/client.test.mjs - the one CFBD door: timeout, count, quota, retry.
// No network: globalThis.fetch is stubbed per test and restored.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.CFBD_API_KEY = process.env.CFBD_API_KEY || 'test-key';
const {
  cfbdFetch, cfbdGet, withCfbdLedger, cfbdProcessStats, _resetCfbdProcessStats,
  quotaFrom, endpointOf, CFBD_TIMEOUT_MS, CFBD_BASE,
} = await import('./client.js');

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const ok = (body, remaining = '68090') => new Response(JSON.stringify(body), {
  status: 200, headers: remaining == null ? {} : { 'x-calllimit-remaining': remaining },
});

test('the timeout is 25 s and every request carries an abort signal', async () => {
  assert.equal(CFBD_TIMEOUT_MS, 25_000);
  let seen;
  globalThis.fetch = async (u, init) => { seen = { u: String(u), init }; return ok([]); };
  await cfbdGet('/games?year=2026&seasonType=regular&week=6');
  assert.equal(seen.u, `${CFBD_BASE}/games?year=2026&seasonType=regular&week=6`);
  assert.ok(seen.init.signal instanceof AbortSignal, 'AbortSignal.timeout on the request');
  assert.equal(seen.init.headers.Authorization, `Bearer ${process.env.CFBD_API_KEY}`);
});

test('a stalled CFBD fails the call fast, by name', async () => {
  globalThis.fetch = (u, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const t0 = Date.now();
  // AbortSignal.timeout's timer is unref'd: hold the loop open while it runs.
  const keep = setTimeout(() => {}, 5000);
  try {
  await assert.rejects(cfbdGet('/games?year=2026', { timeoutMs: 40 }), /CFBD timeout after 40ms on \/games\?year=2026/);
  } finally { clearTimeout(keep); }
  assert.ok(Date.now() - t0 < 2000);
});

test('every request is counted on the run ledger, nested ledgers, and the process', async () => {
  _resetCfbdProcessStats();
  globalThis.fetch = async () => ok([]);
  const { ledger: outer } = await withCfbdLedger(async () => {
    await cfbdGet('/games?year=2026&week=6');
    const { ledger: inner } = await withCfbdLedger(async () => { await cfbdGet('/scoreboard'); });
    assert.equal(inner.calls, 1);
    assert.deepEqual(inner.byEndpoint, { '/scoreboard': 1 });
  });
  assert.equal(outer.calls, 2, 'the inner call is counted outside too');
  assert.deepEqual(outer.byEndpoint, { '/games': 1, '/scoreboard': 1 });
  assert.equal(cfbdProcessStats().calls, 2);
  // Outside any ledger: process only.
  await cfbdGet('/teams?year=2026');
  assert.equal(cfbdProcessStats().calls, 3);
});

test('the quota is read off the response headers, for free', async () => {
  _resetCfbdProcessStats();
  globalThis.fetch = async () => ok([], '67001');
  const { ledger } = await withCfbdLedger(() => cfbdGet('/games?year=2026'));
  assert.equal(ledger.quota.remaining, 67001);
  assert.equal(cfbdProcessStats().quota.remaining, 67001);
  assert.equal(quotaFrom(new Headers({})), null);
  assert.equal(quotaFrom(new Headers({ 'x-calllimit-remaining': 'lots' })), null);
  assert.equal(endpointOf('/live/plays?gameId=1'), '/live/plays');
});

test('429 is retried only when asked, and each retry is a counted call', async () => {
  const statuses = [429, 429, 200];
  globalThis.fetch = async () => { const s = statuses.shift(); return s === 200 ? ok([1]) : new Response('busy', { status: 429 }); };
  const waits = [];
  const { value, ledger } = await withCfbdLedger(() => cfbdGet('/live/plays?gameId=1', { retry429: 2, wait: async (ms) => { waits.push(ms); } }));
  assert.deepEqual(value, [1]);
  assert.equal(ledger.calls, 3);
  assert.equal(waits.length, 2);
  globalThis.fetch = async () => new Response('busy', { status: 429 });
  await assert.rejects(cfbdGet('/scoreboard'), /CFBD 429 on \/scoreboard: busy/, 'no retry by default');
});

test('a missing key throws before any request', async () => {
  const k = process.env.CFBD_API_KEY; delete process.env.CFBD_API_KEY;
  let called = false; globalThis.fetch = async () => { called = true; return ok([]); };
  try { await assert.rejects(cfbdFetch('/games'), /CFBD_API_KEY missing/); }
  finally { process.env.CFBD_API_KEY = k; }
  assert.equal(called, false);
});
