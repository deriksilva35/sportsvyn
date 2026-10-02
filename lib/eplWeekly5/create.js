// lib/eplWeekly5/create.js - one EPL Weekly 5 contest per Premier League round.
//
// WEEK-KEYED: contests (game_type 'epl_weekly_5', sport 'epl', season_year,
// week = the round) and idx_contests_week makes "one per gameweek" a database
// fact. The round is matches.week, written by the epl-fixtures ingest from the
// provider's "Regular Season - N".
//
// THE BOARD IS THE ROUND'S FIXTURES, its window is whatever they span (a Fri-Mon
// round is Fri-Mon; a midweek round is one evening). The board freezes WHICH
// fixtures belong to the gameweek; it does NOT freeze when they kick off - every
// lock reads the live matches.kickoff_at (lib/eplWeekly5/rules.js).
//
// A GAMEWEEK OPENS WHEN THE ONE BEFORE IT IS DONE: the lowest round that still
// has a fixture to play is the one being picked, so MW6 opened the moment MW5's
// last whistle had gone (picks were open by Wed 7 Oct with days to spare).

import { sql } from '../db.js';
import { GAME_KEY, SPORT } from './rules.js';

/** PURE. A round's rows -> the board snapshot. */
export function boardFor(rows = []) {
  return rows.map((r) => ({
    match_id: r.match_id,
    slug: r.slug,
    kickoff_at: new Date(r.kickoff_at).toISOString(),
    home: { id: r.home_team_id, abbr: r.home_abbr, name: r.home_name },
    away: { id: r.away_team_id, abbr: r.away_abbr, name: r.away_name },
  }));
}

/** The round's fixtures, in kickoff order. */
export async function roundRows(season, week) {
  return sql`
    SELECT m.id AS match_id, m.slug, m.kickoff_at, m.status, m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, COALESCE(h.short_name, h.name) AS home_name,
           a.abbreviation AS away_abbr, COALESCE(a.short_name, a.name) AS away_name
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'epl'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.season_year = ${season} AND m.week = ${week}
       AND m.status NOT IN ('cancelled', 'not_needed')
     ORDER BY m.kickoff_at ASC, m.id ASC`;
}

/** The round to open: the lowest with a fixture not yet final. */
export async function nextRound({ season = null } = {}) {
  const [r] = await sql`
    SELECT m.season_year AS season, m.week
      FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'epl'
     WHERE m.week IS NOT NULL AND m.status IN ('scheduled', 'live', 'postponed')
       AND (${season}::int IS NULL OR m.season_year = ${season}::int)
     ORDER BY m.season_year ASC, m.week ASC
     LIMIT 1`;
  return r ? { season: Number(r.season), week: Number(r.week) } : null;
}

/** Create the gameweek if it is not there. IDEMPOTENT on idx_contests_week. */
export async function ensureGameweek({ season, week, now = new Date() }) {
  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND season_year = ${season} AND week = ${week}
       AND puzzle_date IS NULL`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };
  const rows = await roundRows(season, week);
  if (!rows.length) return { created: false, reason: 'no-fixtures' };
  const board = boardFor(rows);
  const first = new Date(board[0].kickoff_at);
  const last = new Date(board[board.length - 1].kickoff_at);
  const meta = { games: board.length, first_kickoff: first.toISOString(), last_kickoff: last.toISOString() };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES (${GAME_KEY}, ${SPORT}, ${season}, ${week}, ${JSON.stringify(board)}::jsonb,
            ${new Date(now).toISOString()}, ${last.toISOString()},
            ${new Date(last.getTime() + 26 * 3_600_000).toISOString()},
            ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = ${GAME_KEY} AND sport = ${SPORT}
         AND season_year = ${season} AND week = ${week} AND puzzle_date IS NULL`;
    return { id: again[0]?.id, created: false, reason: 'raced' };
  }
  return { id: r[0].id, created: true, season, week, games: board.length, firstKickoff: first.toISOString() };
}

/** Open the next gameweek. The cron calls this. */
export async function ensureNextGameweek({ now = new Date() } = {}) {
  const next = await nextRound();
  if (!next) return { created: false, reason: 'no-round' };
  return { ...next, ...await ensureGameweek({ ...next, now }) };
}

/** One gameweek by number. */
export async function gameweek(season, week) {
  const [c] = await sql`
    SELECT id, season_year, week, board, meta, opens_at, locks_at, settles_at, settled, settled_at, perfect FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND season_year = ${season} AND week = ${week}
       AND puzzle_date IS NULL`;
  return c ?? null;
}

/**
 * The gameweek a reader is looking at: one with a fixture LIVE, else the
 * earliest unsettled one with a fixture still ahead (open for picks - a round
 * half played is still this one), else the most recent. A finished GW 5 never
 * hides an open GW 6; its final is a tap away (?gw=5).
 */
export async function currentGameweek({ now = new Date() } = {}) {
  const iso = new Date(now).toISOString();
  const rows = await sql`
    SELECT id, season_year, week, board, meta, opens_at, locks_at, settles_at, settled, settled_at, perfect
      FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND puzzle_date IS NULL AND opens_at <= ${iso}
     ORDER BY season_year DESC, week DESC
     LIMIT 6`;
  if (!rows.length) return null;
  const ids = [...new Set(rows.flatMap((c) => (c.board ?? []).map((g) => g.match_id)))];
  const live = ids.length ? await sql`SELECT id, status, kickoff_at FROM matches WHERE id = ANY(${ids})` : [];
  const by = new Map(live.map((m) => [String(m.id), m]));
  const t = new Date(now).getTime();
  const has = (c, test) => (c.board ?? []).some((g) => { const m = by.get(String(g.match_id)); return m && test(m); });
  const asc = [...rows].reverse();
  return asc.find((c) => !c.settled && has(c, (m) => m.status === 'live'))
    ?? asc.find((c) => !c.settled && has(c, (m) => m.status === 'scheduled' && new Date(m.kickoff_at).getTime() > t))
    ?? rows[0];
}
