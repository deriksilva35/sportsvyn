// lib/apiSports.js — API-Sports (api-football v3) client. Read-only HTTP. No DB.
const HOST = 'https://v3.football.api-sports.io';
const KEY = process.env.API_SPORTS_KEY;
if (!KEY) throw new Error('API_SPORTS_KEY missing from env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${HOST}${path}`, { headers: { 'x-apisports-key': KEY } });
    if (res.status === 429 && attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
    const json = await res.json();
    const e = json.errors;
    const hasErr = Array.isArray(e) ? e.length : e && Object.keys(e).length;
    if (hasErr) throw new Error(`API-Sports error on ${path}: ${JSON.stringify(e)}`);
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
