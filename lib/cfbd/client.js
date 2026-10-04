// lib/cfbd/client.js - THE ONE DOOR TO CollegeFootballData.
//
// Every CFBD request in this repo goes through cfbdFetch / cfbdGet below.
// lib/cfbd/clientCensus.test.mjs walks the tree and fails if any other source
// file names the CFBD host, so a new caller cannot quietly grow its own fetch.
//
// WHY ONE DOOR (sun-9). The plan is 75,000 calls a month and on 3 Oct the
// burn was ~5,400 a day; nobody could say which job spent what, because the
// eleven private fetchers counted nothing. One door gives three things free:
//
//   TIMEOUT. AbortSignal.timeout(CFBD_TIMEOUT_MS) on every request, body
//   included. A CFBD stall used to hold a 120 s cron function until Vercel
//   killed it mid-write; now one call fails in 25 s and the tick fails fast
//   and loud, and the next tick tries again.
//
//   A CALL COUNT. Every request (each retry too - CFBD counts them) is noted
//   on the process counter AND on every enclosing ledger (withCfbdLedger), so
//   recordRun can put `cfbdCalls` and `cfbdByEndpoint` on each sync_runs row.
//
//   THE QUOTA, FOR NOTHING. x-calllimit-remaining rides every CFBD response
//   (checked 3 Oct 23:59Z on /games: `x-calllimit-remaining: 68090`; there is
//   no x-calllimit-reset header). The door reads it off the call that was
//   happening anyway, so the dedicated /conferences probe that cost one call a
//   tick (lib/pollers/runRecorder.js) is no longer needed.

import { AsyncLocalStorage } from 'node:async_hooks';

export const CFBD_BASE = 'https://apinext.collegefootballdata.com';
export const CFBD_TIMEOUT_MS = 25_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ledgers = new AsyncLocalStorage();

// One process's worth. On Vercel a warm instance keeps it across invocations;
// on the droplet it lives as long as the poller. Never relied on for money -
// the per-run ledger is the record.
const processLedger = newLedger(null);

function newLedger(parent) {
  return { calls: 0, byEndpoint: {}, quota: null, parent };
}

/** '/games?year=2026&week=6' -> '/games'. The endpoint, not the query. */
export function endpointOf(pathAndQuery) {
  return String(pathAndQuery).split('?')[0] || '/';
}

/** The quota as a response states it, or null when it does not. */
export function quotaFrom(headers, at = new Date()) {
  const raw = headers?.get?.('x-calllimit-remaining');
  if (raw == null || !/^\d+$/.test(String(raw).trim())) return null;
  return { remaining: Number(raw), at: new Date(at).toISOString() };
}

function note(pathAndQuery) {
  const ep = endpointOf(pathAndQuery);
  for (let l = ledgers.getStore() ?? null; l; l = l.parent) {
    l.calls += 1; l.byEndpoint[ep] = (l.byEndpoint[ep] ?? 0) + 1;
  }
  processLedger.calls += 1;
  processLedger.byEndpoint[ep] = (processLedger.byEndpoint[ep] ?? 0) + 1;
}

function noteQuota(q) {
  if (!q) return;
  for (let l = ledgers.getStore() ?? null; l; l = l.parent) l.quota = q;
  processLedger.quota = q;
}

/**
 * Run `fn(ledger)` with a fresh ledger: every CFBD call made inside it (at any
 * async depth) is counted here and on any enclosing ledger. Returns
 * { value, ledger }. A throw from fn propagates; the ledger is lost with it,
 * which is fine - a failed run's row carries the error, not a count.
 */
export async function withCfbdLedger(fn) {
  const ledger = newLedger(ledgers.getStore() ?? null);
  const value = await ledgers.run(ledger, () => fn(ledger));
  return { value, ledger };
}

/** The ledger of the run we are inside, or null. */
export const currentCfbdLedger = () => ledgers.getStore() ?? null;

/** The process-wide counter (calls, byEndpoint, last quota reading). */
export function cfbdProcessStats() {
  return { calls: processLedger.calls, byEndpoint: { ...processLedger.byEndpoint }, quota: processLedger.quota };
}

/** Test seam. */
export function _resetCfbdProcessStats() {
  processLedger.calls = 0; processLedger.byEndpoint = {}; processLedger.quota = null;
}

/**
 * The raw request. Returns the Response (any status) so a caller with its own
 * status handling keeps it. `retry429` > 0 retries a 429 that many times with
 * ~1 s, ~2 s jittered waits (CFBD's /live/plays refuses CONCURRENCY with 429 -
 * see playsImport.js). A timeout throws `CFBD timeout after 25000ms on <path>`.
 */
export async function cfbdFetch(pathAndQuery, {
  timeoutMs = CFBD_TIMEOUT_MS, retry429 = 0, wait = sleep, base = CFBD_BASE,
} = {}) {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  for (let attempt = 0; ; attempt++) {
    note(pathAndQuery);
    let res;
    try {
      res = await fetch(`${base}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new Error(`CFBD timeout after ${timeoutMs}ms on ${pathAndQuery}`);
      }
      throw e;
    }
    noteQuota(quotaFrom(res.headers));
    if (res.status === 429 && attempt < retry429) {
      await wait(1000 * (attempt + 1) + Math.floor(Math.random() * 400));
      continue;
    }
    return res;
  }
}

/** GET and parse JSON; a non-2xx throws `CFBD <status> on <path>: <body head>`. */
export async function cfbdGet(pathAndQuery, opts = {}) {
  const res = await cfbdFetch(pathAndQuery, opts);
  if (!res.ok) throw new Error(`CFBD ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  try {
    return await res.json();
  } catch (e) {
    // The 25 s signal covers the body too: a stalled 2.7 MB body aborts here.
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`CFBD timeout after ${opts.timeoutMs ?? CFBD_TIMEOUT_MS}ms reading ${pathAndQuery}`);
    }
    throw e;
  }
}
