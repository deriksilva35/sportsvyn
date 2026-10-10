// lib/draftGame/nbaPool.js - one NBA game's draft pool (mon-1 S3).
//
// THE SAME RULE AS FOOTBALL, READ FROM NBA'S SOURCES. There is no NBA players
// table, so the roster comes from BDL's /players/active for the two clubs, and
// the projection is FP/G through the scoring table (lib/nba/fantasyPoints.js
// seasonFppg) from BDL's season averages - this season's line once he has one,
// last season's before. Both are lib/six/pool.js's reads, so Tonight's Six and
// the per-game Draft rank players from the same numbers.
//
// WHO IS IN IT:
//   - on either club's active roster,
//   - NOT listed Out / Out For Season in BDL's injuries (NBA has a structured
//     injury feed; football does not - see lib/draftGame/pool.js),
//   - has a season line (this season or last): a body with no games is not a pick,
//   - and PLAYED (dnp = false) in one of his club's last 3 games that have a box
//     in nba_player_game_stats - THE LAST-3 RULE, as for football - but only once
//     the club HAS a boxed game this season. On opening nights nobody has one,
//     and a rule that excluded everybody would refuse every board; until then
//     the roster, the injuries and the season line decide.
//
// Board rows are the football shape, with `id` the BDL player id as a number
// (nba_player_game_stats keys on it as text): { id, name, pos, team, team_id,
// proj, games }.

import { sql as defaultSql } from '../db.js';
import { seasonFppg } from '../nba/fantasyPoints.js';
import { fetchActive, fetchAverages, fetchInjuries, injuryMap, isOutStatus } from '../six/pool.js';
import { byProjection } from './rules.js';
import { POOL_MAX, PROJ_FLOOR, RECENT_TEAM_GAMES } from './pool.js';

const fullName = (p) => `${String(p?.first_name ?? '').trim()} ${String(p?.last_name ?? '').trim()}`.trim();

/**
 * PURE. Rosters, averages, injuries and recent activity -> board rows, best first.
 * @param teams    Map(bdl team id (string) -> { id: our team id, abbr })
 * @param roster   /players/active rows
 * @param current  Map(bdl player id -> season stats) this season
 * @param previous Map(bdl player id -> season stats) last season
 * @param injuries { [bdl player id]: status }
 * @param active   Map(our team id -> Set(bdl player id)) for clubs WITH a boxed game
 *                 this season; a club not in the map is not filtered on activity.
 */
export function shapeNbaPool({ teams, roster = [], current = new Map(), previous = new Map(), injuries = {}, active = new Map() }, { max = POOL_MAX } = {}) {
  const rows = [];
  for (const p of roster) {
    const t = teams.get(String(p?.team?.id ?? p?.team_id ?? ''));
    if (!t) continue;
    const pid = String(p.id);
    if (isOutStatus(injuries[pid])) continue;
    const recent = active.get(Number(t.id));
    if (recent && !recent.has(pid)) continue;
    const cur = current.get(pid);
    const s = seasonFppg(cur) != null ? cur : previous.get(pid);
    const proj = seasonFppg(s);
    if (proj == null || proj < PROJ_FLOOR) continue;
    rows.push({
      id: Number(pid), name: fullName(p), pos: String(p.position ?? '').trim() || 'F',
      team: t.abbr, team_id: Number(t.id), proj: Math.round(proj * 10) / 10, games: Number(s?.gp ?? 0),
    });
  }
  return byProjection(rows).slice(0, max);
}

/**
 * The last-3 rule for NBA: per club that has a boxed game THIS season, the BDL
 * ids who played (dnp = false) in one of its last RECENT_TEAM_GAMES boxed games
 * before `kickoff`. Map(our team id -> Set(bdl id as string)).
 */
export async function recentNbaActive(teamIds, kickoff, seasonYear, sql = defaultSql) {
  const recent = await sql`
    SELECT m.id, m.home_team_id, m.away_team_id
      FROM matches m
     WHERE m.status = 'final' AND m.kickoff_at < ${kickoff} AND m.season_year = ${seasonYear}
       AND (m.home_team_id = ANY(${teamIds}) OR m.away_team_id = ANY(${teamIds}))
       AND EXISTS (SELECT 1 FROM nba_player_game_stats s WHERE s.match_id = m.id)
     ORDER BY m.kickoff_at DESC
     LIMIT ${RECENT_TEAM_GAMES * 4}`;
  const lastFor = new Map();
  for (const m of recent) {
    for (const t of [Number(m.home_team_id), Number(m.away_team_id)]) {
      if (!teamIds.includes(t)) continue;
      const arr = lastFor.get(t) ?? [];
      if (arr.length < RECENT_TEAM_GAMES) arr.push(Number(m.id));
      lastFor.set(t, arr);
    }
  }
  const out = new Map();
  for (const [t, games] of lastFor) {
    const rows = await sql`
      SELECT DISTINCT bdl_player_id FROM nba_player_game_stats
       WHERE match_id = ANY(${games}) AND team_id = ${t} AND NOT dnp`;
    out.set(t, new Set(rows.map((r) => String(r.bdl_player_id))));
  }
  return out;
}

/** Build one NBA match's pool. `match` needs id, kickoff_at, season_year, home_team_id, away_team_id. */
export async function buildNbaPool(match, { sql = defaultSql, fetchImpl = fetch, key = process.env.BDL_API_KEY } = {}) {
  const teamIds = [Number(match.home_team_id), Number(match.away_team_id)];
  const trows = await sql`
    SELECT id, abbreviation, external_ids->>'bdl_team_id' AS pid FROM teams WHERE id = ANY(${teamIds})`;
  const teams = new Map(trows.filter((t) => t.pid).map((t) => [String(t.pid), { id: Number(t.id), abbr: t.abbreviation }]));
  if (teams.size < 2) return [];
  const pids = [...teams.keys()];
  const opts = { fetchImpl, key };
  const roster = (await fetchActive(pids, opts)).rows;
  const season = Number(match.season_year);
  const ids = roster.map((p) => String(p.id));
  const cur = await fetchAverages(season, ids, opts).catch(() => ({ rows: [] }));
  const have = new Set(cur.rows.filter((r) => Number(r?.stats?.gp) > 0).map((r) => String(r.player?.id)));
  const missing = ids.filter((id) => !have.has(id));
  const prev = missing.length ? await fetchAverages(season - 1, missing, opts).catch(() => ({ rows: [] })) : { rows: [] };
  const toMap = (rows) => new Map(rows.map((r) => [String(r?.player?.id), r?.stats ?? null]));
  const injuries = injuryMap((await fetchInjuries(pids, opts).catch(() => ({ rows: [] }))).rows);
  const active = await recentNbaActive(teamIds, new Date(match.kickoff_at).toISOString(), season, sql);
  return shapeNbaPool({ teams, roster, current: toMap(cur.rows), previous: toMap(prev.rows), injuries, active });
}
