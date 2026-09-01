// lib/fantrax/api.js — thin fetchers over Fantrax's fxea endpoints.
//
// THIN ON PURPOSE. Nothing here reshapes, joins or interprets; every one of
// these returns what the provider said, so the import module below it is the
// only place a Fantrax fact turns into ours. Two layers doing that would give
// two answers to "what position is this player".
//
// THE SECRET NEVER LEAVES THIS FILE'S ARGUMENT LIST. It is read from the
// environment, encoded into one URL, and never logged - not in an error, not
// in a summary. Errors carry the endpoint and the status, never the query.

const BASE = 'https://www.fantrax.com/fxea/general';

async function get(path, { label }) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Fantrax ${res.status} on ${label}`);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Fantrax ${label} returned non-JSON (${text.length} bytes)`); }
}

export function secretFromEnv(env = process.env) {
  const s = env.FANTRAX_SECRET_ID;
  if (!s) throw new Error('FANTRAX_SECRET_ID missing in env');
  return s;
}

export async function getLeagues({ secret = null, env = process.env } = {}) {
  const s = secret ?? secretFromEnv(env);
  const j = await get(`/getLeagues?userSecretId=${encodeURIComponent(s)}`, { label: 'getLeagues' });
  return j?.leagues ?? [];
}

// excludePlayerInfo BY DEFAULT: the full response is 401KB against 25KB, and
// the 375KB difference is playerInfo, which carries no names - only
// eligiblePos and a roster status we already have from getTeamRosters. A
// caller that wants multi-position eligibility asks for it explicitly.
export async function getLeagueInfo(leagueId, { excludePlayerInfo = true } = {}) {
  const q = excludePlayerInfo ? '&excludePlayerInfo=true' : '';
  return get(`/getLeagueInfo?leagueId=${encodeURIComponent(leagueId)}${q}`, { label: 'getLeagueInfo' });
}

export async function getDraftResults(leagueId) {
  return get(`/getDraftResults?leagueId=${encodeURIComponent(leagueId)}`, { label: 'getDraftResults' });
}

/** The whole NFL id table: ~8,000 rows, keyed by fantraxId. Slow-moving. */
export async function getPlayerIds(sport = 'NFL') {
  return get(`/getPlayerIds?sport=${encodeURIComponent(sport)}`, { label: 'getPlayerIds' });
}

export async function getAdp(sport = 'NFL') {
  const j = await get(`/getAdp?sport=${encodeURIComponent(sport)}`, { label: 'getAdp' });
  return Array.isArray(j) ? j : [];
}

/**
 * Every team's roster as Fantrax holds it today: { period, rosters: { teamId:
 * { teamName, rosterItems: [{ id, position, status }] } } }. status is one of
 * ACTIVE / INJURED_RESERVE / RESERVE / MINORS - and MINORS is the devy shelf,
 * which the draft results never mention because nobody drafted it this year.
 */
export async function getTeamRosters(leagueId) {
  return get(`/getTeamRosters?leagueId=${encodeURIComponent(leagueId)}`, { label: 'getTeamRosters' });
}
