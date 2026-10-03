// lib/six/pool.js - who is pickable tonight, and what they are worth.
//
// THREE BDL READS, all measured 1 Oct 2026 against the live key:
//   /nba/v1/players/active?team_ids[]=..   the current rosters (4 clubs -> 81
//                                          rows, two-way contracts included)
//   /nba/v1/season_averages/general        per-game averages + dd2/td3 counts,
//     ?season=&season_type=regular&type=base&player_ids[]=..  (80 ids, one call)
//   /nba/v1/player_injuries?team_ids[]=..  status 'Out' | 'Out For Season' |
//                                          'Questionable' | 'Probable' | ...
//
// FP/G IS THE SEASON THROUGH THE SCORING TABLE - lib/nba/fantasyPoints.js, the
// same table that settles the card - so the number a reader sorts by and the
// number on the board are one table's. THE CURRENT SEASON WHEN HE HAS PLAYED
// IN IT, LAST SEASON OTHERWISE: on opening night nobody has a 2026-27 line,
// and a pool of dashes would rank nothing. The row says which (`fppgSeason`).
//
// THE POOL IS BUILT ONCE AND CACHED ONTO THE NIGHT (meta.pool); rosters and
// season averages do not move inside an evening. INJURIES DO, so they are not
// in the pool: they live in meta.injuries, refreshed by the hourly tick, and
// applied to the rows at READ time (withInjuries). A player listed Out is in
// the pool, dimmed and tagged, and the save door refuses him (rules.js
// player_out) - a reader can see who is missing and why.

import { sql as defaultSql } from '../db.js';
import { seasonFppg } from '../nba/fantasyPoints.js';
import { bdlFetch } from '../bdl/http.js';

/** Statuses that take a player out of the pool tonight. */
export const OUT_STATUSES = Object.freeze(['Out', 'Out For Season']);
export const isOutStatus = (s) => OUT_STATUSES.includes(String(s ?? '').trim());

async function page(path, { fetchImpl = fetch, key = process.env.BDL_API_KEY } = {}) {
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await bdlFetch(path, { key, fetchImpl, describe: (s) => `BDL ${s} on ${path.split('?')[0]}` });
  const j = await res.json();
  return { rows: j?.data ?? [], next: j?.meta?.next_cursor ?? null };
}

async function walk(path, opts = {}, maxCalls = 12) {
  const out = []; let cursor = null; let calls = 0;
  do {
    const p = await page(`${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, opts);
    calls += 1;
    out.push(...p.rows);
    cursor = p.next;
  } while (cursor && calls < maxCalls);
  return { rows: out, calls };
}

const teamQs = (ids) => ids.map((id) => `team_ids[]=${encodeURIComponent(id)}`).join('&');

export function fetchActive(bdlTeamIds, opts = {}) {
  return walk(`/nba/v1/players/active?${teamQs(bdlTeamIds)}&per_page=100`, opts);
}

export function fetchInjuries(bdlTeamIds, opts = {}) {
  return walk(`/nba/v1/player_injuries?${teamQs(bdlTeamIds)}&per_page=100`, opts);
}

/** Season averages for many players, 80 ids a call. */
export async function fetchAverages(season, playerIds, opts = {}) {
  const out = []; let calls = 0;
  for (let i = 0; i < playerIds.length; i += 80) {
    const ids = playerIds.slice(i, i + 80).map((id) => `player_ids[]=${encodeURIComponent(id)}`).join('&');
    const r = await walk(`/nba/v1/season_averages/general?season=${encodeURIComponent(season)}&season_type=regular&type=base&per_page=100&${ids}`, opts, 4);
    out.push(...r.rows); calls += r.calls;
  }
  return { rows: out, calls };
}

const fullName = (p) => `${String(p?.first_name ?? '').trim()} ${String(p?.last_name ?? '').trim()}`.trim();
export function shortName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/**
 * PURE. Rosters + averages -> pool rows, keyed by game.
 *
 * @param board     the night's board snapshot
 * @param teams     Map(our team id -> { pid: bdl team id, abbr })
 * @param roster    /players/active rows
 * @param current   Map(bdl player id -> season stats) for this season
 * @param previous  Map(bdl player id -> season stats) for last season
 * @param season    this season's year (for the label)
 */
export function poolRows({ board = [], teams = new Map(), roster = [], current = new Map(), previous = new Map(), season = null }) {
  const gameOfTeam = new Map(); // our team id -> { g, side }
  for (const g of board) {
    gameOfTeam.set(String(g.home_team_id), { g, side: 'home' });
    gameOfTeam.set(String(g.away_team_id), { g, side: 'away' });
  }
  const ourByPid = new Map([...teams].map(([id, t]) => [String(t.pid), { id, ...t }]));
  const byGame = {};
  for (const p of roster) {
    const t = ourByPid.get(String(p?.team?.id ?? p?.team_id ?? ''));
    if (!t) continue;
    const at = gameOfTeam.get(String(t.id));
    if (!at) continue;
    const { g, side } = at;
    const opp = side === 'home' ? g.away : g.home;
    const cur = current.get(String(p.id));
    const prev = previous.get(String(p.id));
    const curF = seasonFppg(cur);
    const fppg = curF ?? seasonFppg(prev);
    const name = fullName(p);
    const row = {
      playerId: String(p.id),
      name,
      short: shortName(name),
      position: String(p.position ?? '').trim(),
      team: t.abbr,
      teamId: Number(t.id),
      matchId: Number(g.match_id),
      opp: opp?.abbr ?? null,
      home: side === 'home',
      fppg,
      // WHICH SEASON THE NUMBER IS FROM - null when he has none at all.
      fppgSeason: curF != null ? season : (fppg != null && season != null ? season - 1 : null),
    };
    (byGame[String(g.match_id)] ??= []).push(row);
  }
  for (const k of Object.keys(byGame)) {
    byGame[k].sort((a, b) => (b.fppg ?? -Infinity) - (a.fppg ?? -Infinity) || a.name.localeCompare(b.name));
  }
  return byGame;
}

/** PURE. /player_injuries rows -> { [bdl player id]: status }. */
export function injuryMap(rows = []) {
  const out = {};
  for (const r of rows ?? []) {
    const id = r?.player?.id;
    if (id == null) continue;
    const s = String(r?.status ?? '').trim();
    if (s) out[String(id)] = s;
  }
  return out;
}

/** PURE. The provider ids listed Out, as the rules want them. */
export function outIdsOf(injuries) {
  return new Set(Object.entries(injuries?.byPlayer ?? {}).filter(([, s]) => isOutStatus(s)).map(([id]) => id));
}

/**
 * PURE. The pool with tonight's injuries laid over it: every row gets
 * `injury` (the status, or null) and `out`. OUT ROWS SINK to the bottom of
 * their game, still visible; nobody is removed.
 */
export function withInjuries(pool, injuries) {
  if (!pool?.byGame) return pool;
  const by = injuries?.byPlayer ?? {};
  const byGame = {};
  for (const [k, rows] of Object.entries(pool.byGame)) {
    byGame[k] = rows.map((r) => ({ ...r, injury: by[r.playerId] ?? null, out: isOutStatus(by[r.playerId]) }))
      .sort((a, b) => (a.out === b.out ? 0 : a.out ? 1 : -1));
  }
  return { ...pool, byGame };
}

/** Our team ids on the board -> { pid, abbr }. */
async function teamsOf(sql, board) {
  const ids = [...new Set(board.flatMap((g) => [g.home_team_id, g.away_team_id]).filter((x) => x != null))];
  const rows = ids.length ? await sql`
    SELECT id, abbreviation, external_ids->>'bdl_team_id' AS pid FROM teams WHERE id = ANY(${ids})` : [];
  return new Map(rows.filter((t) => t.pid).map((t) => [String(t.id), { pid: t.pid, abbr: t.abbreviation }]));
}

/**
 * Build the night's pool (and cache it onto the contest). An incomplete build -
 * a club with no roster - is returned but NOT cached, so the next read retries
 * rather than serving a dead panel all night.
 */
export async function buildSixPool(contest, { sql = defaultSql, fetchImpl = fetch, key = process.env.BDL_API_KEY, cache = true } = {}) {
  const board = contest?.board ?? [];
  const teams = await teamsOf(sql, board);
  const pids = [...teams.values()].map((t) => t.pid);
  if (!pids.length) return { builtAt: new Date().toISOString(), byGame: {}, incomplete: true };
  const opts = { fetchImpl, key };
  const roster = (await fetchActive(pids, opts)).rows;
  const season = Number(contest.season_year);
  const ids = roster.map((p) => String(p.id));
  const cur = await fetchAverages(season, ids, opts).catch(() => ({ rows: [] }));
  const have = new Set(cur.rows.filter((r) => Number(r?.stats?.gp) > 0).map((r) => String(r.player?.id)));
  const missing = ids.filter((id) => !have.has(id));
  const prev = missing.length ? await fetchAverages(season - 1, missing, opts).catch(() => ({ rows: [] })) : { rows: [] };
  const toMap = (rows) => new Map(rows.map((r) => [String(r?.player?.id), r?.stats ?? null]));
  const byGame = poolRows({ board, teams, roster, current: toMap(cur.rows), previous: toMap(prev.rows), season });
  const clubsWithRows = new Set(Object.values(byGame).flat().map((r) => String(r.teamId)));
  const incomplete = [...teams.keys()].some((id) => !clubsWithRows.has(id));
  const pool = { builtAt: new Date().toISOString(), byGame, incomplete };
  if (cache && !incomplete && contest?.id != null) {
    // A TOP-LEVEL KEY, so the shallow || is the right depth.
    await sql`UPDATE contests SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ pool })}::jsonb
               WHERE id = ${contest.id}`;
  }
  return pool;
}

/** The cached pool, or a fresh build. */
export async function sixPool(contest, opts = {}) {
  if (contest?.meta?.pool?.byGame && !opts.rebuild) return contest.meta.pool;
  return buildSixPool(contest, opts);
}

/** Refresh tonight's injuries onto the contest (meta.injuries). One or two calls. */
export async function refreshSixInjuries(contest, { sql = defaultSql, fetchImpl = fetch, key = process.env.BDL_API_KEY, now = new Date() } = {}) {
  const teams = await teamsOf(sql, contest?.board ?? []);
  const pids = [...teams.values()].map((t) => t.pid);
  if (!pids.length) return null;
  const { rows } = await fetchInjuries(pids, { fetchImpl, key });
  const injuries = { at: new Date(now).toISOString(), byPlayer: injuryMap(rows) };
  await sql`UPDATE contests SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ injuries })}::jsonb
             WHERE id = ${contest.id}`;
  return injuries;
}
