// lib/nba/statsSync.js - one game's box score into nba_player_game_stats, and
// its newest play into metadata.detail.last_play.
//
// THE GRIDIRON'S syncGameStats SHAPE, as MLB's is: one match id in,
// { matchId, rows, changed, calls } out, so the poller's StatsTracker drives it
// with no new cadence logic and its calls count against the same quota.
//
// /nba/v1/stats?game_ids[]= pages at 100; a game is ~26 lines, so one call.
// /nba/v1/plays?game_id= returns the whole game in one response (506 rows for
// 18447989, no cursor) - measured 1 Oct 2026.

import { sql as defaultSql } from '../db.js';
import { writeNbaDetail } from './detail.js';

const BDL = 'https://api.balldontlie.io';
const int = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

async function get(path, { fetchImpl = fetch, key = process.env.BDL_API_KEY } = {}) {
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetchImpl(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on ${path.split('?')[0]}`);
  return res.json();
}

/** PURE. The provider's `min` -> seconds. "29" -> 1740, "29:14" -> 1754, "" / null -> null. */
export function minutesToSeconds(min) {
  const s = String(min ?? '').trim();
  if (!s) return null;
  let m = /^(\d{1,2})$/.exec(s);
  if (m) return Number(m[1]) * 60;
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m && Number(m[2]) <= 59) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

/** PURE. A /nba/v1/stats row -> the columns the table holds, or null. */
export function shapeNbaStatLine(row) {
  const p = row?.player;
  if (p?.id == null) return null;
  const name = `${String(p.first_name ?? '').trim()} ${String(p.last_name ?? '').trim()}`.trim();
  if (!name) return null;
  const seconds = minutesToSeconds(row?.min);
  const line = {
    bdlPlayerId: String(p.id),
    bdlTeamId: row?.team?.id == null ? null : String(row.team.id),
    playerName: name,
    position: String(p.position ?? '').trim() || null,
    seconds,
    pts: int(row.pts), fgm: int(row.fgm), fga: int(row.fga), fg3m: int(row.fg3m), fg3a: int(row.fg3a),
    ftm: int(row.ftm), fta: int(row.fta), oreb: int(row.oreb), dreb: int(row.dreb), reb: int(row.reb),
    ast: int(row.ast), stl: int(row.stl), blk: int(row.blk), turnovers: int(row.turnover), pf: int(row.pf),
    plusMinus: int(row.plus_minus),
  };
  // DID NOT PLAY: no minutes and nothing on the line. A player with 0:00 and a
  // foul (technical from the bench) did not "play" either, but has a line;
  // the flag is about minutes only.
  line.dnp = !seconds;
  return line;
}

export async function fetchNbaStats(gameId, opts = {}) {
  const out = []; let cursor = null; let calls = 0;
  do {
    const j = await get(`/nba/v1/stats?game_ids[]=${encodeURIComponent(gameId)}&per_page=100${cursor ? `&cursor=${cursor}` : ''}`, opts);
    calls += 1;
    out.push(...(j?.data ?? []));
    cursor = j?.meta?.next_cursor ?? null;
  } while (cursor && calls < 5);
  return { rows: out, calls };
}

export async function writeNbaStats(sql, matchId, rows, teamIdByBdl = new Map()) {
  let written = 0; const unresolvedTeams = new Set();
  for (const raw of rows ?? []) {
    const s = shapeNbaStatLine(raw);
    if (!s) continue;
    const teamId = s.bdlTeamId == null ? null : (teamIdByBdl.get(s.bdlTeamId) ?? null);
    if (s.bdlTeamId != null && teamId == null) unresolvedTeams.add(s.bdlTeamId);
    await sql`
      INSERT INTO nba_player_game_stats (
        match_id, team_id, bdl_player_id, player_name, position, seconds, dnp,
        pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, reb, ast, stl, blk, turnovers, pf, plus_minus,
        created_at, updated_at)
      VALUES (${matchId}, ${teamId}, ${s.bdlPlayerId}, ${s.playerName}, ${s.position}, ${s.seconds}, ${s.dnp},
        ${s.pts}, ${s.fgm}, ${s.fga}, ${s.fg3m}, ${s.fg3a}, ${s.ftm}, ${s.fta}, ${s.oreb}, ${s.dreb}, ${s.reb},
        ${s.ast}, ${s.stl}, ${s.blk}, ${s.turnovers}, ${s.pf}, ${s.plusMinus}, now(), now())
      ON CONFLICT (match_id, bdl_player_id) DO UPDATE SET
        team_id = COALESCE(EXCLUDED.team_id, nba_player_game_stats.team_id),
        player_name = EXCLUDED.player_name, position = EXCLUDED.position,
        seconds = EXCLUDED.seconds, dnp = EXCLUDED.dnp, pts = EXCLUDED.pts,
        fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fg3m = EXCLUDED.fg3m, fg3a = EXCLUDED.fg3a,
        ftm = EXCLUDED.ftm, fta = EXCLUDED.fta, oreb = EXCLUDED.oreb, dreb = EXCLUDED.dreb,
        reb = EXCLUDED.reb, ast = EXCLUDED.ast, stl = EXCLUDED.stl, blk = EXCLUDED.blk,
        turnovers = EXCLUDED.turnovers, pf = EXCLUDED.pf, plus_minus = EXCLUDED.plus_minus,
        updated_at = now()
      WHERE (nba_player_game_stats.seconds, nba_player_game_stats.pts, nba_player_game_stats.reb,
             nba_player_game_stats.ast, nba_player_game_stats.stl, nba_player_game_stats.blk,
             nba_player_game_stats.turnovers, nba_player_game_stats.fg3m, nba_player_game_stats.pf,
             nba_player_game_stats.plus_minus, nba_player_game_stats.fga, nba_player_game_stats.fta)
        IS DISTINCT FROM (EXCLUDED.seconds, EXCLUDED.pts, EXCLUDED.reb, EXCLUDED.ast, EXCLUDED.stl,
             EXCLUDED.blk, EXCLUDED.turnovers, EXCLUDED.fg3m, EXCLUDED.pf, EXCLUDED.plus_minus,
             EXCLUDED.fga, EXCLUDED.fta)
      RETURNING id`.then((r) => { written += r.length; });
  }
  return { written, unresolvedTeams: [...unresolvedTeams] };
}

/**
 * One game's box. { fetchImpl } lets the replay harness feed recorded rows.
 * @returns { matchId, rows, changed, calls }
 */
export async function syncNbaGameStats(matchId, { sql = defaultSql, fetchImpl = fetch, key } = {}) {
  const [m] = await sql`
    SELECT m.id, m.league_id, m.external_ids->>'bdl_game_id' AS pid FROM matches m WHERE m.id = ${matchId}`;
  if (!m?.pid) return { matchId, rows: 0, changed: 0, calls: 0, skipped: 'no provider id' };
  const { rows, calls } = await fetchNbaStats(m.pid, { fetchImpl, key });
  const teams = await sql`
    SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
     WHERE league_id = ${m.league_id} AND jsonb_exists(external_ids, 'bdl_team_id')`;
  const res = await writeNbaStats(sql, matchId, rows, new Map(teams.map((t) => [t.pid, t.id])));
  return { matchId, rows: rows.length, changed: res.written, calls };
}

/** PURE. The newest play of a /plays payload, as the card's last-play line holds it. */
export function lastPlayOf(plays = []) {
  let best = null;
  for (const p of plays ?? []) if (p?.order != null && (best == null || Number(p.order) > Number(best.order))) best = p;
  if (!best) return null;
  return {
    order: Number(best.order),
    text: String(best.text ?? '').trim() || null,
    type: best.type ?? null,
    period: int(best.period),
    clock: best.clock == null ? null : String(best.clock),
    home_score: int(best.home_score),
    away_score: int(best.away_score),
    scoring: best.scoring_play === true,
    team: best.team?.abbreviation ?? null,
  };
}

/**
 * The newest play into metadata.detail.last_play (nested merge - see
 * lib/nba/detail.js). Rides the StatsTracker cadence, not every poll: one
 * call per due game, the same throttle the box score has.
 */
export async function syncNbaLastPlay(matchId, { sql = defaultSql, fetchImpl = fetch, key } = {}) {
  const [m] = await sql`SELECT external_ids->>'bdl_game_id' AS pid FROM matches WHERE id = ${matchId}`;
  if (!m?.pid) return { matchId, rows: 0, changed: 0, calls: 0, skipped: 'no provider id' };
  const j = await get(`/nba/v1/plays?game_id=${encodeURIComponent(m.pid)}`, { fetchImpl, key });
  const plays = j?.data ?? [];
  const last = lastPlayOf(plays);
  const changed = last ? await writeNbaDetail(sql, matchId, { last_play: last }) : false;
  return { matchId, rows: plays.length, changed: changed ? 1 : 0, calls: 1 };
}
