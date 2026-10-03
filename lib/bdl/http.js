// lib/bdl/http.js - THE ONE DOOR TO THE SECONDARY STATS FEED.
//
// RULING sun-6 item 1 (Derik): "Any BDL 4xx/5xx inside a run marks the run
// FAILED (ok=false) and alerts - per-game errors may never hide inside an
// ok=true. Apply to every BDL overlay (cfb, nfl, mlb, nba)."
//
// THE RECEIPT, 3 Oct: from 16:01Z the feed answered 401 on /ncaaf/v1/games (the
// key lost paid NCAAF). For 66 runs syncCfbLiveLines caught each game's error
// into summary.perGame[].error - per-game containment, exactly as designed - and
// the run it sat inside (cfb-live-lines) stayed ok=true. maybeAlert keys on a
// failed run, so it never fired, and the live box went blank with nobody told.
//
// THE MECHANISM, ONE PLACE INSTEAD OF N CATCH SITES. Every request to the feed
// goes through bdlFetch(). A 4xx/5xx is RECORDED into the enclosing run's scope
// (AsyncLocalStorage) at the moment it happens, and THEN thrown as a
// BdlHttpError. Whatever catches it - a per-game try, a .catch(() => []), a
// fallback that returns null - the record is already made. recordRun
// (lib/pollers/runRecorder.js) and the live poller (services/live-poller)
// open the scope around a run, read it at the end, and mark the run failed if
// it holds anything. Containment is untouched: the sibling games still write;
// the run is only marked at the end.
//
// THE CENSUS GUARD (lib/bdl/census.test.mjs) is what keeps this the only door:
// no other file under lib/, services/ or app/ may name the feed's host.

import { AsyncLocalStorage } from 'node:async_hooks';

const BASE = 'https://api.balldontlie.io';

/** The run scope: an array of error records, or undefined outside any run. */
const scope = new AsyncLocalStorage();

export class BdlHttpError extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.name = 'BdlHttpError';
    this.status = status;
    this.path = path;
  }
}

export const isBdlHttpError = (e) => e instanceof BdlHttpError || e?.name === 'BdlHttpError';

/**
 * The endpoint with its query and its ids stripped, so the same failure on two
 * different games reads as ONE failure. That is what lets an alert body stay
 * identical tick after tick and be deduped by maybeAlert's fingerprint (mailed
 * once, then counted) instead of re-mailed per game.
 */
export function bdlEndpoint(path) {
  return String(path ?? '').split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');
}

/**
 * Create, RECORD and return a BdlHttpError. The record lands in the innermost
 * open run scope; outside any run (a page render, a script) it is a plain throw
 * and nothing else.
 */
export function bdlError(status, path, message) {
  const err = new BdlHttpError(message ?? `BDL ${status} on ${bdlEndpoint(path)}`, { status, path });
  scope.getStore()?.push({ status, endpoint: bdlEndpoint(path), message: err.message.slice(0, 200) });
  return err;
}

/**
 * One request to the feed. Returns the Response when it is ok (or its status is
 * in `allow` - a 404 that MEANS "gone", a 429 the caller retries itself).
 * Otherwise records and throws a BdlHttpError whose message is
 * `describe(status, bodyText)` - each caller keeps the wording its logs and
 * tests already know.
 */
export async function bdlFetch(path, { key, fetchImpl = fetch, base = BASE, allow = [], describe = null } = {}) {
  const k = key ?? process.env.BDL_API_KEY;
  if (!k) throw new Error('BDL_API_KEY missing in env');
  const res = await fetchImpl(`${base}${path}`, { headers: { Authorization: k } });
  if (res.ok || allow.includes(res.status)) return res;
  let text = '';
  if (describe && typeof res.text === 'function') text = await res.text().catch(() => '');
  throw bdlError(res.status, path, describe ? describe(res.status, text) : undefined);
}

/**
 * Run `fn` inside a fresh scope. Resolves { value, bdlErrors }; if `fn` throws,
 * the error is rethrown carrying `.bdlErrors`. Scopes nest: a run opened inside
 * another run (cfb-live-lines inside cfb-games) keeps its own records, so the
 * overlay's failure is the overlay's and never fails the games sync around it.
 */
export async function withBdlErrors(fn) {
  const errors = [];
  try {
    const value = await scope.run(errors, fn);
    return { value, bdlErrors: errors };
  } catch (e) {
    if (e && typeof e === 'object') e.bdlErrors = errors;
    throw e;
  }
}

/** Collapse records into one row per (status, endpoint), counted, sorted. */
export function bdlErrorSummary(errors = []) {
  const m = new Map();
  for (const e of errors) {
    const k = `${e.status} ${e.endpoint}`;
    const cur = m.get(k) ?? { status: e.status, endpoint: e.endpoint, count: 0, sample: e.message };
    cur.count += 1;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => (a.status - b.status) || a.endpoint.localeCompare(b.endpoint));
}

/**
 * The run's error line. DETERMINISTIC ON PURPOSE: statuses and endpoints only,
 * no counts, no ids, no timestamps - the same outage on the next tick must
 * produce the same text, so the alert built from it fingerprints the same and
 * maybeAlert counts the repeat instead of mailing it. Counts live in the run's
 * summary (summary.bdlErrors).
 */
export function bdlFailureMessage(errors = []) {
  const rows = bdlErrorSummary(errors);
  if (!rows.length) return null;
  return `BDL HTTP error(s) inside the run - run marked FAILED (ruling sun-6): ${rows.map((r) => `${r.status} ${r.endpoint}`).join(', ')}`;
}
