// lib/gridiron/nflStatsSync.js - ingest NFL player identities + 2025 per-game
// stats from balldontlie into nfl_players / nfl_player_game_stats, and create the
// 32 synthetic team-defense identities.
//
// Source: GET /nfl/v1/stats?seasons[]=2025 (cursor-paginated). Each row carries
// {player, team, game, <stat fields>}, so nfl_players is upserted from the stat
// stream itself (no separate /players sweep). Column mapping + the xpAtt/DST
// decisions are documented in migrations/049_nfl_players_and_stats.sql.
//
// No provider datetime is parsed here (stats attach to already-ingested matches),
// so the ingest.js toUtc/timezone boundary does not apply to this path.

import { sql } from '../db.js';
import { normalizeName, ffcPosition } from './nameMatch.js';

const BDL_BASE = 'https://api.balldontlie.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (v) => (v == null ? null : Number(v));

async function bdlGet(pathAndQuery) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${BDL_BASE}${pathAndQuery}`, { headers: { Authorization: key } });
    if (res.status === 429) { await sleep(15000); continue; } // self-throttle
    if (!res.ok) throw new Error(`BDL ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 150)}`);
    return res.json();
  }
  throw new Error(`BDL rate-limited (429) after retries on ${pathAndQuery}`);
}

const chunk = (arr, size) => { const o = []; for (let i = 0; i < arr.length; i += size) o.push(arr.slice(i, i + size)); return o; };

// player identity from a BDL player object (shared by the stats sweep + roster sweep)
function toIdentity(p, teamByBdl) {
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return {
    bdl: p.id, first: p.first_name ?? null, last: p.last_name ?? null, full,
    norm: normalizeName(full), pos: ffcPosition(p.position_abbreviation),
    bdlPos: p.position_abbreviation ?? null,
    teamId: p.team ? (teamByBdl.get(String(p.team.id)) ?? null) : null,
    jersey: p.jersey_number ?? null,
  };
}
async function upsertPlayers(rows) {
  for (const c of chunk(rows, 500)) {
    await sql`
      INSERT INTO nfl_players (bdl_player_id, first_name, last_name, full_name, normalized_name, position, bdl_position, team_id, jersey_number)
      SELECT * FROM unnest(
        ${c.map((x) => x.bdl)}::int[], ${c.map((x) => x.first)}::text[], ${c.map((x) => x.last)}::text[],
        ${c.map((x) => x.full)}::text[], ${c.map((x) => x.norm)}::text[], ${c.map((x) => x.pos)}::text[],
        ${c.map((x) => x.bdlPos)}::text[], ${c.map((x) => x.teamId)}::int[], ${c.map((x) => x.jersey)}::text[])
      ON CONFLICT (bdl_player_id) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, full_name = EXCLUDED.full_name,
        normalized_name = EXCLUDED.normalized_name, position = EXCLUDED.position,
        bdl_position = EXCLUDED.bdl_position, team_id = COALESCE(EXCLUDED.team_id, nfl_players.team_id),
        jersey_number = EXCLUDED.jersey_number, updated_at = now()`;
  }
}

async function nflTeamByBdl() {
  const rows = await sql`SELECT t.id, t.external_ids->>'bdl_team_id' AS bdl FROM teams t JOIN leagues l ON t.league_id = l.id WHERE l.slug = 'nfl'`;
  return new Map(rows.filter((r) => r.bdl).map((r) => [String(r.bdl), r.id]));
}

// Full active-roster sweep (GET /nfl/v1/players). Gives identities to players with
// no 2025 stat line (rookies, injured-all-season) so the pool can still match them;
// they simply have zero stat rows. Additive upsert - safe to run after syncNfl2025.
export async function ingestAllPlayers({ log = () => {} } = {}) {
  const teamByBdl = await nflTeamByBdl();
  const players = new Map();
  let cursor = null, page = 0;
  do {
    const j = await bdlGet(`/nfl/v1/players?per_page=100${cursor ? `&cursor=${cursor}` : ''}`);
    page += 1;
    for (const p of j.data) if (p?.id != null) players.set(p.id, toIdentity(p, teamByBdl));
    cursor = j.meta?.next_cursor ?? null;
    await sleep(350);
  } while (cursor && page < 200);
  await upsertPlayers([...players.values()]);
  log(`roster sweep: ${page} pages, upserted ${players.size} players`);
  return { pages: page, rosterPlayers: players.size };
}

export async function syncNfl2025({ season = 2025, log = () => {} } = {}) {
  const summary = { season, pages: 0, apiStatRows: 0, distinctPlayers: 0, statRowsWritten: 0, skippedNoMatchGame: 0, skippedNoPlayer: 0 };

  // ---- DB maps: BDL team id -> team_id, BDL game id -> match_id -------------
  const teamByBdl = await nflTeamByBdl();
  const matchRows = await sql`
    SELECT m.id, m.external_ids->>'bdl_game_id' AS bdl
    FROM matches m JOIN leagues l ON m.league_id = l.id
    WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.external_ids ? 'bdl_game_id'`;
  const matchByBdl = new Map(matchRows.map((r) => [String(r.bdl), r.id]));
  log(`maps: ${teamByBdl.size} teams, ${matchByBdl.size} NFL-${season} matches`);

  // ---- sweep /nfl/v1/stats (cursor paginated) ------------------------------
  const players = new Map(); // bdl_player_id -> identity
  const stats = [];          // raw stat rows (keyed by bdl ids, resolved after upsert)
  let cursor = null, page = 0;
  do {
    const j = await bdlGet(`/nfl/v1/stats?seasons[]=${season}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`);
    page += 1;
    for (const s of j.data) {
      summary.apiStatRows += 1;
      const p = s.player, tm = s.team, g = s.game;
      const teamId = tm ? (teamByBdl.get(String(tm.id)) ?? null) : null;
      if (p?.id != null && !players.has(p.id)) players.set(p.id, toIdentity(p, teamByBdl));
      stats.push({
        bdlPlayerId: p?.id ?? null, bdlGameId: g?.id ?? null, teamId,
        pass_cmp: n(s.passing_completions), pass_att: n(s.passing_attempts), pass_yds: n(s.passing_yards),
        pass_td: n(s.passing_touchdowns), pass_int: n(s.passing_interceptions),
        rush_att: n(s.rushing_attempts), rush_yds: n(s.rushing_yards), rush_td: n(s.rushing_touchdowns),
        tgt: n(s.receiving_targets), rec: n(s.receptions), rec_yds: n(s.receiving_yards), rec_td: n(s.receiving_touchdowns),
        fumbles_lost: n(s.fumbles_lost),
        fgm: n(s.field_goals_made), fga: n(s.field_goal_attempts), fg_long: n(s.long_field_goal_made), xp: n(s.extra_points_made),
        sacks: n(s.defensive_sacks), def_int: n(s.defensive_interceptions), fr: n(s.fumbles_recovered),
        def_td: ((s.interception_touchdowns || 0) + (s.fumbles_touchdowns || 0)) || null,
      });
    }
    cursor = j.meta?.next_cursor ?? null;
    if (page % 10 === 0) log(`  swept ${page} pages, ${summary.apiStatRows} rows...`);
    await sleep(350);
  } while (cursor && page < 600);
  summary.pages = page;
  summary.distinctPlayers = players.size;
  log(`swept ${page} pages: ${summary.apiStatRows} stat rows, ${players.size} distinct players`);

  // ---- upsert nfl_players --------------------------------------------------
  await upsertPlayers([...players.values()]);
  log(`upserted ${players.size} nfl_players`);

  // ---- synthetic per-team DST identities (32) ------------------------------
  const dstTeams = await sql`
    SELECT t.id, t.name FROM teams t JOIN leagues l ON t.league_id = l.id WHERE l.slug = 'nfl'`;
  const dstRows = dstTeams.map((t) => ({ id: t.id, full: `${t.name} Defense`, norm: normalizeName(`${t.name} Defense`) }));
  await sql`
    INSERT INTO nfl_players (full_name, normalized_name, position, team_id, is_team_defense)
    SELECT * FROM unnest(${dstRows.map((x) => x.full)}::text[], ${dstRows.map((x) => x.norm)}::text[],
      ${dstRows.map(() => 'DEF')}::text[], ${dstRows.map((x) => x.id)}::int[], ${dstRows.map(() => true)}::boolean[])
    ON CONFLICT (team_id) WHERE is_team_defense DO NOTHING`;
  const dstCount = await sql`SELECT count(*)::int n FROM nfl_players WHERE is_team_defense`;
  log(`DST identities: ${dstCount[0].n}`);

  // ---- resolve + insert nfl_player_game_stats ------------------------------
  const idRows = await sql`SELECT id, bdl_player_id FROM nfl_players WHERE bdl_player_id IS NOT NULL`;
  const idByBdl = new Map(idRows.map((r) => [r.bdl_player_id, r.id]));
  const resolved = [];
  for (const s of stats) {
    const pid = s.bdlPlayerId != null ? idByBdl.get(s.bdlPlayerId) : null;
    const mid = s.bdlGameId != null ? matchByBdl.get(String(s.bdlGameId)) : null;
    if (!pid) { summary.skippedNoPlayer += 1; continue; }
    if (!mid) { summary.skippedNoMatchGame += 1; continue; }
    resolved.push({ ...s, pid, mid });
  }
  for (const c of chunk(resolved, 500)) {
    await sql`
      INSERT INTO nfl_player_game_stats (
        match_id, nfl_player_id, team_id,
        pass_cmp, pass_att, pass_yds, pass_td, pass_int,
        rush_att, rush_yds, rush_td, tgt, rec, rec_yds, rec_td, fumbles_lost,
        fgm, fga, fg_long, xp, sacks, def_int, fr, def_td)
      SELECT * FROM unnest(
        ${c.map((x) => x.mid)}::int[], ${c.map((x) => x.pid)}::int[], ${c.map((x) => x.teamId)}::int[],
        ${c.map((x) => x.pass_cmp)}::int[], ${c.map((x) => x.pass_att)}::int[], ${c.map((x) => x.pass_yds)}::int[], ${c.map((x) => x.pass_td)}::int[], ${c.map((x) => x.pass_int)}::int[],
        ${c.map((x) => x.rush_att)}::int[], ${c.map((x) => x.rush_yds)}::int[], ${c.map((x) => x.rush_td)}::int[],
        ${c.map((x) => x.tgt)}::int[], ${c.map((x) => x.rec)}::int[], ${c.map((x) => x.rec_yds)}::int[], ${c.map((x) => x.rec_td)}::int[], ${c.map((x) => x.fumbles_lost)}::int[],
        ${c.map((x) => x.fgm)}::int[], ${c.map((x) => x.fga)}::int[], ${c.map((x) => x.fg_long)}::int[], ${c.map((x) => x.xp)}::int[],
        ${c.map((x) => x.sacks)}::numeric[], ${c.map((x) => x.def_int)}::int[], ${c.map((x) => x.fr)}::int[], ${c.map((x) => x.def_td)}::int[])
      ON CONFLICT (match_id, nfl_player_id) DO UPDATE SET
        team_id = EXCLUDED.team_id,
        pass_cmp = EXCLUDED.pass_cmp, pass_att = EXCLUDED.pass_att, pass_yds = EXCLUDED.pass_yds, pass_td = EXCLUDED.pass_td, pass_int = EXCLUDED.pass_int,
        rush_att = EXCLUDED.rush_att, rush_yds = EXCLUDED.rush_yds, rush_td = EXCLUDED.rush_td,
        tgt = EXCLUDED.tgt, rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds, rec_td = EXCLUDED.rec_td, fumbles_lost = EXCLUDED.fumbles_lost,
        fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fg_long = EXCLUDED.fg_long, xp = EXCLUDED.xp,
        sacks = EXCLUDED.sacks, def_int = EXCLUDED.def_int, fr = EXCLUDED.fr, def_td = EXCLUDED.def_td`;
  }
  const wrote = await sql`SELECT count(*)::int n FROM nfl_player_game_stats`;
  summary.statRowsWritten = wrote[0].n;
  log(`stat rows in table: ${summary.statRowsWritten} (skipped: ${summary.skippedNoMatchGame} no-match-game, ${summary.skippedNoPlayer} no-player)`);
  return summary;
}
