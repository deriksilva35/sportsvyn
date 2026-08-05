// lib/theOddsApi.test.mjs — the retry policy on the gridiron odds client.
//
// Every one of these fails SILENTLY in the wrong direction, which is why they
// are pinned rather than trusted:
//   · retrying a 401 would ask a rejected key twice and log a second failure
//     for a fault no backoff can fix
//   · NOT retrying a network error is the bug this whole change exists to fix
//   · losing the attempt count means a network path degrading from "monthly
//     blip" to "twice a day" looks identical in the ledger, which is the one
//     thing constraint 2 asked us not to allow
//
// fetch is stubbed on globalThis - no network, no credits, no key needed beyond
// a placeholder.
//
// The backoff is REAL, so this file takes ~13s: the two exhaustion cases each
// sit through the full 1s + 4s envelope. That is deliberate. Faking the timers
// would mean the constants under test are no longer the constants that ship,
// and the whole point of the last assertion is that the shipped numbers add up.
// 13s is a fair price for testing the real envelope.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ODDS_API_KEY = process.env.ODDS_API_KEY || 'test-key-not-real';

const mod = await import('./theOddsApi.js');
const realFetch = globalThis.fetch;

// A vendor response good enough for the client: JSON array + budget headers.
function okResponse(body = []) {
  return {
    ok: true,
    status: 200,
    headers: { get: (h) => ({
      'x-requests-remaining': '99000', 'x-requests-used': '1000', 'x-requests-last': '3',
    }[h.toLowerCase()] ?? null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
function errResponse(status, body = 'nope') {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => body,
  };
}

let calls = 0;
beforeEach(() => { calls = 0; });
afterEach(() => { globalThis.fetch = realFetch; });

test('a network failure is retried and the run still succeeds', async () => {
  // The exact production shape: fetch rejects with TypeError, nothing reaches
  // the vendor. Attempt 2 works - which is what would have saved 2026-08-05.
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return okResponse([{ id: 'e1' }]);
  };
  const r = await mod.fetchSportOdds('americanfootball_nfl');
  assert.equal(calls, 2, 'must have retried exactly once');
  assert.equal(r.events.length, 1);
  assert.equal(r.attempts, 2, 'the ledger must record which attempt won');
});

test('attempts is 1 on a clean call, so healthy runs stay unmarked', async () => {
  globalThis.fetch = async () => { calls += 1; return okResponse([]); };
  const r = await mod.fetchSportOdds('americanfootball_nfl');
  assert.equal(calls, 1);
  assert.equal(r.attempts, 1, 'a first-try success must be distinguishable from a retried one');
});

test('a persistent network failure gives up after the third attempt', async () => {
  globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => mod.fetchSportOdds('americanfootball_nfl'),
    (e) => {
      // The original error must survive: the alert email quotes it.
      assert.match(String(e.message), /fetch failed/);
      assert.equal(e.attempts, 3, 'the exhausted count must be attached');
      return true;
    },
  );
  assert.equal(calls, 3, 'exactly ATTEMPTS tries, never more');
});

test('a 401 is NOT retried - no backoff fixes a bad key', async () => {
  globalThis.fetch = async () => { calls += 1; return errResponse(401, 'unauthorized'); };
  await assert.rejects(() => mod.fetchSportOdds('americanfootball_nfl'), /401/);
  assert.equal(calls, 1, 'a 4xx must fail on the first attempt');
});

test('a 422 is NOT retried - the query is wrong, not the network', async () => {
  globalThis.fetch = async () => { calls += 1; return errResponse(422, 'bad market'); };
  await assert.rejects(() => mod.fetchSportOdds('americanfootball_nfl'), /422/);
  assert.equal(calls, 1);
});

test('a 5xx IS retried, and recovery is ledgered', async () => {
  globalThis.fetch = async () => {
    calls += 1;
    return calls < 3 ? errResponse(503, 'upstream down') : okResponse([{ id: 'x' }]);
  };
  const r = await mod.fetchSportOdds('americanfootball_nfl');
  assert.equal(calls, 3);
  assert.equal(r.attempts, 3);
});

test('a 429 IS retried - backoff is precisely what it asks for', async () => {
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? errResponse(429, 'slow down') : okResponse([]);
  };
  const r = await mod.fetchSportOdds('americanfootball_nfl');
  assert.equal(calls, 2);
  assert.equal(r.attempts, 2);
});

test('the futures call carries the same policy', async () => {
  // Same client, so this guards against a future refactor giving the outrights
  // path its own unretried fetch.
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return okResponse([]);
  };
  const r = await mod.fetchSportOutrights('americanfootball_nfl_super_bowl_winner');
  assert.equal(calls, 2);
  assert.equal(r.attempts, 2);
});

test('the retry envelope stays inside the poller cadence', async () => {
  // Constraint 1, as arithmetic rather than prose. Only caller is
  // /api/cron/gridiron-odds: */15 (900s cycle), maxDuration 60s.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./theOddsApi.js', import.meta.url), 'utf8');
  const attempts = Number(/const ATTEMPTS = (\d+)/.exec(src)[1]);
  const backoff = JSON.parse(/const BACKOFF_MS = (\[[^\]]*\])/.exec(src)[1]);
  const timeout = Number(/const ATTEMPT_TIMEOUT_MS = (\d+)/.exec(src)[1]);

  assert.equal(backoff.length, attempts - 1, 'one backoff between each pair of attempts');
  const backoffTotal = backoff.reduce((a, b) => a + b, 0);
  assert.ok(backoffTotal <= 5000, `backoff budget ${backoffTotal}ms must stay <= 5s`);

  const worstCallMs = attempts * timeout + backoffTotal;
  assert.ok(worstCallMs < 60000, `one call worst case ${worstCallMs}ms must fit maxDuration 60s`);
  // The cycle is 900s and the platform kills the function at 60s, so the
  // envelope can never reach the next tick. This asserts the margin is real.
  assert.ok(worstCallMs < 900000, 'retry envelope must not approach the 15-minute cycle');
});
