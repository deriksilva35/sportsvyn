// lib/gridiron/gameStatsSync.js - ONE GAME'S PLAYER LINES, LIVE AND AT FINAL.
//
// The Tuesday sweep (nflStatsSync.js syncNflSeason) fills nfl_player_game_stats
// for the whole season from /nfl/v1/stats?seasons[]=. This is the same row,
// the same key (match_id, nfl_player_id) and the same field mapping, fetched
// for ONE game with /nfl/v1/stats?game_ids[]=<bdl_game_id> - so the box score
// exists while the game is on and the moment it ends, and the Weekly settles
// from the table it always did. No new table.
//
// Idempotent: a rerun on a final game changes 0 rows. `changed` counts rows
// whose stat fields differ from what the table held (or are new).
import { sql } from '../db.js';
import { toIdentity, upsertPlayers, nflTeamByBdl } from './nflStatsSync.js';

const BDL_BASE = 'https://api.balldontlie.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v) => (v == null || v === '' ? null : Number(v));

export const STAT_FIELDS = ['team_id', 'pass_cmp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td',
  'tgt', 'rec', 'rec_yds', 'rec_td', 'fumbles_lost', 'fgm', 'fga', 'fg_long', 'xp', 'sacks', 'def_int', 'fr', 'def_td'];

/** The sweep's mapping of a BDL stat row onto the table's columns - kept identical. */
export function statFieldsFromBdl(s, teamId = null) {
  return {
    team_id: teamId,
    pass_cmp: n(s.passing_completions), pass_att: n(s.passing_attempts), pass_yds: n(s.passing_yards),
    pass_td: n(s.passing_touchdowns), pass_int: n(s.passing_interceptions),
    rush_att: n(s.rushing_attempts), rush_yds: n(s.rushing_yards), rush_td: n(s.rushing_touchdowns),
    tgt: n(s.receiving_targets), rec: n(s.receptions), rec_yds: n(s.receiving_yards), rec_td: n(s.receiving_touchdowns),
    fumbles_lost: n(s.fumbles_lost),
    fgm: n(s.field_goals_made), fga: n(s.field_goal_attempts), fg_long: n(s.long_field_goal_made), xp: n(s.extra_points_made),
    sacks: n(s.defensive_sacks), def_int: n(s.defensive_interceptions), fr: n(s.fumbles_recovered),
    def_td: ((s.interception_touchdowns || 0) + (s.fumbles_touchdowns || 0)) || null,
  };
}

async function bdlGet(pathAndQuery) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BDL_BASE}${pathAndQuery}`, { headers: { Authorization: key } });
    if (res.status === 429) { await sleep(15000); continue; }
    if (!res.ok) throw new Error(`BDL ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 150)}`);
    return res.json();
  }
  throw new Error(`BDL rate-limited (429) after retries on ${pathAndQuery}`);
}

/** All pages of /nfl/v1/stats for one game. Returns { rows, calls }. */
export async function fetchGameStats(bdlGameId, { get = bdlGet } = {}) {
  const rows = []; let cursor = null; let calls = 0;
  do {
    const j = await get(`/nfl/v1/stats?game_ids[]=${bdlGameId}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`);
    calls += 1;
    rows.push(...(j.data ?? []));
    cursor = j.meta?.next_cursor ?? null;
  } while (cursor && calls < 20);
  return { rows, calls };
}

const same = (a, b) => STAT_FIELDS.every((f) => String(a?.[f] ?? '') === String(b?.[f] ?? ''));

/**
 * Fetch and upsert one game's lines. Returns { matchId, bdlGameId, rows,
 * players, changed, calls }. `fetcher` is injectable for tests.
 */
export async function syncGameStats(matchId, { fetcher = fetchGameStats, log = () => {} } = {}) {
  const m = (await sql`
    SELECT m.id, m.slug, m.status, m.external_ids->>'bdl_game_id' AS bdl, l.slug AS league
      FROM matches m JOIN leagues l ON l.id = m.league_id WHERE m.id = ${matchId}`)[0];
  if (!m) throw new Error(`no match ${matchId}`);
  if (m.league !== 'nfl') throw new Error(`match ${matchId} is ${m.league}, not nfl`);
  if (!m.bdl) throw new Error(`match ${matchId} has no bdl_game_id`);

  const { rows: raw, calls } = await fetcher(m.bdl);
  const teamByBdl = await nflTeamByBdl();
  const players = new Map();
  const stats = [];
  for (const s of raw) {
    const p = s.player;
    if (p?.id == null) continue;
    if (!players.has(p.id)) players.set(p.id, toIdentity(p, teamByBdl));
    stats.push({ bdlPlayerId: p.id, ...statFieldsFromBdl(s, s.team ? (teamByBdl.get(String(s.team.id)) ?? null) : null) });
  }
  if (players.size) await upsertPlayers([...players.values()]);
  const ids = [...players.keys()];
  const idRows = ids.length ? await sql`SELECT id, bdl_player_id FROM nfl_players WHERE bdl_player_id = ANY(${ids}::int[])` : [];
  const idByBdl = new Map(idRows.map((r) => [r.bdl_player_id, r.id]));
  const existing = new Map((await sql`SELECT * FROM nfl_player_game_stats WHERE match_id = ${m.id}`).map((r) => [r.nfl_player_id, r]));

  let changed = 0; let written = 0;
  for (const s of stats) {
    const pid = idByBdl.get(s.bdlPlayerId);
    if (!pid) continue;
    const before = existing.get(pid);
    if (before && same(before, s)) { written += 1; continue; }
    changed += 1; written += 1;
    await sql`
      INSERT INTO nfl_player_game_stats (
        match_id, nfl_player_id, team_id,
        pass_cmp, pass_att, pass_yds, pass_td, pass_int,
        rush_att, rush_yds, rush_td, tgt, rec, rec_yds, rec_td, fumbles_lost,
        fgm, fga, fg_long, xp, sacks, def_int, fr, def_td)
      VALUES (${m.id}, ${pid}, ${s.team_id},
        ${s.pass_cmp}, ${s.pass_att}, ${s.pass_yds}, ${s.pass_td}, ${s.pass_int},
        ${s.rush_att}, ${s.rush_yds}, ${s.rush_td}, ${s.tgt}, ${s.rec}, ${s.rec_yds}, ${s.rec_td}, ${s.fumbles_lost},
        ${s.fgm}, ${s.fga}, ${s.fg_long}, ${s.xp}, ${s.sacks}, ${s.def_int}, ${s.fr}, ${s.def_td})
      ON CONFLICT (match_id, nfl_player_id) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        pass_cmp = EXCLUDED.pass_cmp, pass_att = EXCLUDED.pass_att, pass_yds = EXCLUDED.pass_yds, pass_td = EXCLUDED.pass_td, pass_int = EXCLUDED.pass_int,
        rush_att = EXCLUDED.rush_att, rush_yds = EXCLUDED.rush_yds, rush_td = EXCLUDED.rush_td,
        tgt = EXCLUDED.tgt, rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds, rec_td = EXCLUDED.rec_td, fumbles_lost = EXCLUDED.fumbles_lost,
        fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fg_long = EXCLUDED.fg_long, xp = EXCLUDED.xp,
        sacks = EXCLUDED.sacks, def_int = EXCLUDED.def_int, fr = EXCLUDED.fr, def_td = EXCLUDED.def_td`;
  }
  const out = { matchId: m.id, slug: m.slug, bdlGameId: m.bdl, status: m.status, rows: written, apiRows: raw.length, players: players.size, changed, calls };
  log(`[game-stats] ${m.slug} rows=${out.rows} changed=${out.changed} calls=${out.calls}`);
  return out;
}

/**
 * THE POST-FINAL SWEEP: every final NFL match of (season, week) that still
 * has no stats rows gets one syncGameStats. Rides beside the Tuesday sweep,
 * never instead of it. Returns { week, candidates, synced: [...] }.
 */
export async function sweepGameStats(week, { season, log = () => {}, fetcher } = {}) {
  const rows = await sql`
    SELECT m.id, m.slug
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.week = ${week} AND m.season_phase = 'REG'
       AND m.status = 'final' AND m.external_ids ? 'bdl_game_id'
       AND NOT EXISTS (SELECT 1 FROM nfl_player_game_stats s WHERE s.match_id = m.id)
     ORDER BY m.kickoff_at`;
  const synced = [];
  for (const r of rows) {
    try { synced.push(await syncGameStats(r.id, { log, fetcher })); } catch (e) { synced.push({ matchId: r.id, slug: r.slug, error: String(e?.message ?? e).slice(0, 160) }); }
  }
  return { season, week, candidates: rows.length, synced };
}
