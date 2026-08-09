/**
 * lib/apiSportsFootball.js - API-Sports AMERICAN FOOTBALL (v1) client.
 *
 * Sibling of lib/apiSports.js, which talks to the SOCCER product
 * (v3.football.api-sports.io). Same account, same x-apisports-key header,
 * SEPARATE SUBSCRIPTION and a different host and response envelope - which is
 * exactly why this is a second file rather than a host parameter on the first.
 * The soccer client's method surface (fixtures, lineups, events, predictions)
 * does not exist here, and this product's `games` shape is not a `fixture`.
 *
 * Read-only HTTP. NO DATE PARSING AND NO DATABASE. Provider datetimes, statuses
 * and season phases are the business of lib/gridiron/ingest.js and nowhere else
 * (CLAUDE.md, enforced by review): a client that quietly called new Date() on a
 * provider string would be the second place that boundary lives.
 *
 * SUBSCRIPTION NOTE. The Free tier serves seasons 2022-2024 only and refuses
 * 2025/2026 with a `plan` error, NOT an empty result - so a season the plan
 * does not cover fails loudly rather than looking like a quiet off-season.
 * Verified on the paid tier: /games?league=1&season=2026 returns 328 games
 * (272 REG, 49 PRE, 7 POST).
 */

const HOST = 'https://v1.american-football.api-sports.io';
const KEY = process.env.API_SPORTS_KEY;

// The NFL is league 1, NCAA is 2. Stable ids on this product (confirmed against
// /leagues), so they are named here rather than resolved on every call.
export const NFL_LEAGUE_ID = 1;
export const NCAA_LEAGUE_ID = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The daily cap arrives as HTTP 200 with an error body, exactly as it does on
 * the soccer product - so the 429 retry path never fires for it. Mirrors
 * lib/apiSports.js's DailyCapError so a caller can catch one shape for both.
 */
export class FootballDailyCapError extends Error {
  constructor(path, body) {
    super(`API-Sports (american-football) daily cap reached on ${path}`);
    this.name = 'FootballDailyCapError';
    this.path = path;
    this.body = body;
  }
}

/**
 * A season the current plan does not cover. Distinct from the daily cap and
 * from a generic error because the remedy is different and human: upgrade, or
 * ask for a season the plan serves. Message verbatim from the provider:
 *   {"plan":"Free plans do not have access to this season, try from 2022 to 2024."}
 */
export class FootballPlanError extends Error {
  constructor(path, body) {
    super(`API-Sports (american-football) plan does not cover ${path}: ${body?.plan ?? ''}`);
    this.name = 'FootballPlanError';
    this.path = path;
    this.body = body;
  }
}

// Both are exported as pure predicates so they can be tested with synthetic
// bodies - no fetch mocking, same pattern as isDailyCapError.
export function isDailyCapError(errorsBody) {
  if (!errorsBody || typeof errorsBody !== 'object') return false;
  const r = errorsBody.requests;
  return typeof r === 'string' && /reached the request limit for the day/i.test(r);
}

export function isPlanError(errorsBody) {
  if (!errorsBody || typeof errorsBody !== 'object') return false;
  return typeof errorsBody.plan === 'string' && errorsBody.plan.length > 0;
}

// This product returns `errors` as an ARRAY when there are none and an OBJECT
// when there are - the same quirk the soccer client handles. Normalising here
// keeps every caller from re-deriving it.
export function hasErrors(errorsBody) {
  if (!errorsBody) return false;
  return Array.isArray(errorsBody) ? errorsBody.length > 0 : Object.keys(errorsBody).length > 0;
}

async function get(path, { retries = 3 } = {}) {
  if (!KEY) throw new Error('API_SPORTS_KEY missing from env');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HOST}${path}`, { headers: { 'x-apisports-key': KEY } });
    if (res.status === 429 && attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
    const json = await res.json();
    if (hasErrors(json.errors)) {
      if (isDailyCapError(json.errors)) throw new FootballDailyCapError(path, json.errors);
      if (isPlanError(json.errors)) throw new FootballPlanError(path, json.errors);
      throw new Error(`API-Sports (american-football) error on ${path}: ${JSON.stringify(json.errors)}`);
    }
    return json.response;
  }
}

export const apiSportsFootball = {
  // Plan, quota and requests-used. Cheap, and the only way to know the daily
  // budget before a polling evening rather than after.
  status: () => get('/status'),

  leagues: (id) => get(`/leagues${id ? `?id=${id}` : ''}`),

  // The full team list for a league/season. Carries `code` (LV, JAX, NE...),
  // city, coach and stadium - none of which the game object includes.
  teams: (league, season) => get(`/teams?league=${league}&season=${season}`),

  /**
   * Games. Season alone returns the whole year (328 rows for NFL 2026), which
   * is the right call for a schedule import. `date` (YYYY-MM-DD) narrows to one
   * slate and is the right call for live polling: ONE request covers every game
   * that evening, where per-game polling would multiply the budget by the slate
   * size for no extra information.
   */
  games: ({ league, season, date, team } = {}) => {
    const q = new URLSearchParams();
    if (league !== undefined) q.set('league', String(league));
    if (season !== undefined) q.set('season', String(season));
    if (date !== undefined) q.set('date', String(date));
    if (team !== undefined) q.set('team', String(team));
    return get(`/games?${q.toString()}`);
  },

  game: (id) => get(`/games?id=${id}`),
};
