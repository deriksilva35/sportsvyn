// crew/lib/bdlProbe.mjs - provider-health's live probe of the BDL endpoints the product uses.
// ONE cheap GET per endpoint (per_page=1), READ ONLY, key from the crew secrets dir (bdl.token,
// optional: without it the probe is skipped and provider-health falls back to the database reads).
// WHAT WE LOOK AT: the status code and the x-ratelimit-* headers. Never a body, never the key.
//
// SOURCE OF TRUTH for the endpoint list: the paths the poller and the page feeds name (services/
// live-poller via lib/*/ingest, lib/nba/statsSync.js, lib/gridiron/*, lib/mlb/*, lib/cfb/*; the
// grep is `grep -rhoE "/(nfl|mlb|ncaaf|nba)/v1/[a-z_/]+" lib services`). It cannot be imported:
// those modules reach the DB at load, and crew/ runs standalone on the crew droplet. The id
// params below are placeholders, there so a route that needs one gets past argument validation to
// the auth check; the response body is ignored.
import { HTTP_TIMEOUT_MS } from './common.mjs';

const BASE = 'https://api.balldontlie.io';

export const BDL_ENDPOINTS = Object.freeze([
  { sport: 'nba', endpoint: 'nba/v1/games', query: 'per_page=1' },
  { sport: 'nba', endpoint: 'nba/v1/box_scores/live', query: '' },
  { sport: 'nba', endpoint: 'nba/v1/plays', query: 'game_id=1' },
  { sport: 'nba', endpoint: 'nba/v1/stats', query: 'per_page=1' },
  { sport: 'nfl', endpoint: 'nfl/v1/games', query: 'per_page=1' },
  { sport: 'nfl', endpoint: 'nfl/v1/stats', query: 'per_page=1' },
  { sport: 'nfl', endpoint: 'nfl/v1/plays', query: 'game_id=1' },
  { sport: 'ncaaf', endpoint: 'ncaaf/v1/games', query: 'per_page=1' },
  { sport: 'ncaaf', endpoint: 'ncaaf/v1/player_stats', query: 'per_page=1' },
  { sport: 'mlb', endpoint: 'mlb/v1/games', query: 'per_page=1' },
  { sport: 'mlb', endpoint: 'mlb/v1/plays', query: 'game_id=1' },
  { sport: 'mlb', endpoint: 'mlb/v1/lineups', query: 'per_page=1' },
]);

/** The statuses that make an endpoint count as stale: auth lost or throttled. */
export const BAD_STATUSES = Object.freeze([401, 403, 429]);
export const LOW_FRACTION = 0.1;

const intHeader = (res, name) => {
  const v = res?.headers?.get?.(name);
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One GET. -> { sport, endpoint, status (0 = no answer), remaining, limit }. */
export async function probeOne(e, key, { fetchImpl = fetch, timeoutMs = Math.min(HTTP_TIMEOUT_MS, 4_500) } = {}) {
  const url = `${BASE}/${e.endpoint}${e.query ? `?${e.query}` : ''}`;
  try {
    const res = await fetchImpl(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(timeoutMs) });
    try { await res.body?.cancel?.(); } catch { /* body is never read */ }
    return { sport: e.sport, endpoint: e.endpoint, status: res.status,
      remaining: intHeader(res, 'x-ratelimit-remaining'), limit: intHeader(res, 'x-ratelimit-limit') };
  } catch {
    return { sport: e.sport, endpoint: e.endpoint, status: 0, remaining: null, limit: null };
  }
}

export const probeAll = (key, opts) => Promise.all(BDL_ENDPOINTS.map((e) => probeOne(e, key, opts)));

/**
 * PURE. results -> { bad: [{ sport, endpoint, status }], low: [{ sport, remaining, limit }], silent: n }.
 * `low` is one row per sport, the LOWEST remaining seen, only when it is under 10% of its limit.
 * `silent` counts endpoints that gave no answer (timeout / network): informational, never stale.
 */
export function judgeProbe(results) {
  const bad = results.filter((r) => BAD_STATUSES.includes(r.status))
    .map((r) => ({ sport: r.sport, endpoint: r.endpoint, status: r.status }));
  const bySport = new Map();
  for (const r of results) {
    if (r.remaining == null || r.limit == null || !(r.limit > 0)) continue;
    const cur = bySport.get(r.sport);
    if (!cur || r.remaining < cur.remaining) bySport.set(r.sport, { sport: r.sport, remaining: r.remaining, limit: r.limit });
  }
  const low = [...bySport.values()].filter((s) => s.remaining < s.limit * LOW_FRACTION);
  return { bad, low, silent: results.filter((r) => r.status === 0).length };
}
