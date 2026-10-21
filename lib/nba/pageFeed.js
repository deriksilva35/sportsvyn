// lib/nba/pageFeed.js - the NBA game page's reads of the secondary stats feed
// (thu1-nba-page): injuries, lineups, rosters, season averages, odds,
// standings and a team's games.
//
// A PAGE READ ON A PUBLIC ROUTE, so none of it is uncached and none of it can
// hold the page: every call goes through bdlFetch (the one door,
// lib/bdl/http.js) with Next's fetch cache (`next.revalidate`, seconds) and a
// hard timeout. A failure, a timeout or an empty answer THROWS or returns
// empty, and the caller (lib/nba/gamePageView.js) catches it: a module whose
// read fails is a module not drawn. Nothing here guesses.
//
// TTLs (seconds): injuries / odds / pre-game lineups 10 min, season averages /
// standings / rosters / a team's games 1 h, a live game's lineups 1 min, a
// final's 1 h.

import { bdlFetch } from '../bdl/http.js';

export const TTL = { short: 600, long: 3600, live: 60 };
export const TIMEOUT_MS = 4000;

/**
 * One cached GET. Resolves { json, fetchedAt } - fetchedAt is the answer's own
 * Date header (so a cached answer says when IT was fetched), else now.
 * `fetchImpl` is the test seam; the Next cache option rides on the call.
 */
export async function bdlPageRead(path, { revalidate = TTL.short, fetchImpl = fetch, key, timeoutMs = TIMEOUT_MS } = {}) {
  const cached = (url, init) => fetchImpl(url, { ...init, next: { revalidate } });
  const res = await bdlFetch(path, { key, fetchImpl: cached, signal: AbortSignal.timeout(timeoutMs) });
  const json = await res.json();
  const d = res.headers?.get?.('date');
  const at = d ? new Date(d) : null;
  return { json, fetchedAt: at && Number.isFinite(at.getTime()) ? at : new Date() };
}

const ids = (name, list) => list.map((i) => `${name}[]=${encodeURIComponent(i)}`).join('&');
const pick = (r) => r?.json?.data ?? [];

/** /nba/v1/player_injuries for these provider team ids. { rows, fetchedAt }. */
export async function readInjuries(teamIds, opts = {}) {
  const r = await bdlPageRead(`/nba/v1/player_injuries?${ids('team_ids', teamIds)}&per_page=100`, { revalidate: TTL.short, ...opts });
  return { rows: pick(r), fetchedAt: r.fetchedAt };
}

/** /nba/v1/lineups for one game - empty before tip. `live` shortens the cache. */
export async function readLineups(gameId, { live = false, ...opts } = {}) {
  const r = await bdlPageRead(`/nba/v1/lineups?game_ids[]=${encodeURIComponent(gameId)}&per_page=100`, { revalidate: live ? TTL.live : TTL.short, ...opts });
  return pick(r);
}

/** One team's active roster (player rows), paged. */
export async function readRoster(teamId, opts = {}) {
  const out = []; let cursor = null;
  for (let i = 0; i < 3; i += 1) {
    const r = await bdlPageRead(`/nba/v1/players/active?team_ids[]=${encodeURIComponent(teamId)}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, { revalidate: TTL.long, ...opts });
    out.push(...pick(r));
    cursor = r.json?.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

/** Season averages (base, regular season) for provider player ids; `season` is the start year. */
export async function readSeasonAverages(season, playerIds, opts = {}) {
  const out = [];
  for (let i = 0; i < playerIds.length; i += 60) {
    const chunk = playerIds.slice(i, i + 60);
    const r = await bdlPageRead(`/nba/v1/season_averages/general?season=${encodeURIComponent(season)}&season_type=regular&type=base&per_page=100&${ids('player_ids', chunk)}`, { revalidate: TTL.long, ...opts });
    out.push(...pick(r));
  }
  return out;
}

/** The odds rows for one game, every vendor. */
export async function readOdds(gameId, opts = {}) {
  const r = await bdlPageRead(`/v2/odds?game_ids[]=${encodeURIComponent(gameId)}`, { revalidate: TTL.short, ...opts });
  return pick(r);
}

/** The league's standings rows for a season. */
export async function readStandings(season, opts = {}) {
  const r = await bdlPageRead(`/nba/v1/standings?season=${encodeURIComponent(season)}`, { revalidate: TTL.long, ...opts });
  return pick(r);
}

/** One team's games in a season (the fallback for a team our own matches hold no finals for). */
export async function readTeamGames(teamId, season, opts = {}) {
  const out = []; let cursor = null;
  for (let i = 0; i < 3; i += 1) {
    const r = await bdlPageRead(`/nba/v1/games?team_ids[]=${encodeURIComponent(teamId)}&seasons[]=${encodeURIComponent(season)}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, { revalidate: TTL.long, ...opts });
    out.push(...pick(r));
    cursor = r.json?.meta?.next_cursor ?? null;
    if (!cursor) break;
  }
  return out;
}
