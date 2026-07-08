// lib/apiSports.js — API-Sports (api-football v3) client. Read-only HTTP. No DB.
const HOST = 'https://v3.football.api-sports.io';
const KEY = process.env.API_SPORTS_KEY;
if (!KEY) throw new Error('API_SPORTS_KEY missing from env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// Daily-cap detection.
//
// API-Sports's per-minute rate-limit returns HTTP 429 (handled below via the
// retry loop). The DAILY cap is different: API-Sports returns HTTP 200 with
// an error body — `{ "errors": { "requests": "You have reached the request
// limit for the day, ..." } }`. The 429 retry path never fires for this case
// because the response code is 200. We surface it as a distinct error class
// so callers (poll-live's catch) can recognize it and trip the circuit
// breaker without parsing the message string at every call site.
//
// isDailyCapError is exported as a pure function so it can be tested with
// synthetic error bodies (no fetch mocking required).
// ============================================================================

export class DailyCapError extends Error {
  constructor(path, body) {
    super(`API-Sports daily cap reached on ${path}`);
    this.name = 'DailyCapError';
    this.path = path;
    this.body = body;
  }
}

export function isDailyCapError(errorsBody) {
  if (!errorsBody || typeof errorsBody !== 'object') return false;
  const r = errorsBody.requests;
  return typeof r === 'string' && /reached the request limit for the day/i.test(r);
}

async function get(path, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HOST}${path}`, { headers: { 'x-apisports-key': KEY } });
    if (res.status === 429 && attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
    const json = await res.json();
    const e = json.errors;
    const hasErr = Array.isArray(e) ? e.length : e && Object.keys(e).length;
    if (hasErr) {
      // Distinguish daily-cap from other API errors so callers can trip the
      // circuit breaker. Other errors still throw as plain Error and propagate.
      if (isDailyCapError(e)) throw new DailyCapError(path, e);
      throw new Error(`API-Sports error on ${path}: ${JSON.stringify(e)}`);
    }
    return json.response;
  }
}

export const apiSports = {
  leagues: (search) => get(`/leagues${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  teams: (league, season) => get(`/teams?league=${league}&season=${season}`),
  // Single-team lookup. /teams?id=X carries the team.code field that
  // /fixtures does NOT — this is the live-acquisition path for
  // upsertTeam when the cross-league sibling lookup misses (the bulk of
  // first-seen friendlies are not in any /teams import we've run).
  // Returns the standard /teams envelope: an array with 0 or 1 entries,
  // each shaped { team: { id, name, code, country, founded, national,
  // logo }, venue: {...} }.
  teamById: (id) => get(`/teams?id=${id}`),
  squad: (team) => get(`/players/squads?team=${team}`),
  fixtures: (league, season, range = {}) => {
    const q = new URLSearchParams({ league: String(league), season: String(season) });
    if (range.from) q.set('from', range.from);
    if (range.to) q.set('to', range.to);
    return get(`/fixtures?${q.toString()}`);
  },
  fixturesByTeam: ({ team, last, season } = {}) => {
    const q = new URLSearchParams();
    if (team !== undefined)   q.set('team',   String(team));
    if (last !== undefined)   q.set('last',   String(last));
    if (season !== undefined) q.set('season', String(season));
    return get(`/fixtures?${q.toString()}`);
  },
  fixture: (id) => get(`/fixtures?id=${id}`),
  lineups: (id) => get(`/fixtures/lineups?fixture=${id}`),
  statistics: (id) => get(`/fixtures/statistics?fixture=${id}`),
  events: (id) => get(`/fixtures/events?fixture=${id}`),
  // Per-player match stats for both squads (minutes, goals, assists, position,
  // rating, substitute flag). One call returns both teams' full matchday
  // squads; unused subs appear with games.minutes = null.
  fixturePlayers: (id) => get(`/fixtures/players?fixture=${id}`),
  // /predictions returns a pairwise strength comparison block among
  // other fields. Used by lib/aiPrematch.js's DRAMA computation: the
  // comparison.total split is the closeness signal that maps to DRAMA.
  // Returns the standard envelope: an array with one entry containing
  // predictions / league / teams / comparison / h2h.
  predictions: (id) => get(`/predictions?fixture=${id}`),
  odds: ({ fixture, league, season, bet, bookmaker } = {}) => {
    const q = new URLSearchParams();
    if (fixture !== undefined)   q.set('fixture',   String(fixture));
    if (league !== undefined)    q.set('league',    String(league));
    if (season !== undefined)    q.set('season',    String(season));
    if (bet !== undefined)       q.set('bet',       String(bet));
    if (bookmaker !== undefined) q.set('bookmaker', String(bookmaker));
    return get(`/odds?${q.toString()}`);
  },
};
