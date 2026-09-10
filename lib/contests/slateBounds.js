// lib/contests/slateBounds.js - THE GAME LOCKS, NOT THE CONTEST (rolling lock,
// R1). A contest's slate has a first kickoff and a last one; every deadline
// derives from those two instants and nothing is hand-typed:
//   - contests.locks_at is the JOIN-WINDOW CLOSE = lastKickoff. After it,
//     nothing about the week can change.
//   - a Pick'em row locks at its own match's kickoff_at (lib/pickem/entry.js
//     savePick already does this); a Weekly slot locks at the kickoff of the
//     match its player's team plays this week (R3); a team with no match in
//     the slate locks at lastKickoff.
//   - reminders key on firstKickoff (R4).
// Weekly/draft slates are (league, season, week, REG) in matches; a Pick'em
// slate is the board's own match ids.
import { sql } from '../db.js';

export async function slateBounds(contestOrId) {
  const c = typeof contestOrId === 'object' && contestOrId
    ? contestOrId
    : (await sql`SELECT id, game_type, sport, season_year, week, board FROM contests WHERE id = ${Number(contestOrId)}`)[0];
  if (!c) return null;
  let r;
  if (c.game_type === 'pickem') {
    const ids = (Array.isArray(c.board) ? c.board : []).map((g) => Number(g.match_id)).filter(Number.isFinite);
    if (!ids.length) return { contestId: c.id, firstKickoff: null, lastKickoff: null, games: 0 };
    r = (await sql`SELECT min(kickoff_at) f, max(kickoff_at) l, count(*)::int n FROM matches WHERE id = ANY(${ids}::int[])`)[0];
  } else {
    r = (await sql`
      SELECT min(m.kickoff_at) f, max(m.kickoff_at) l, count(*)::int n
        FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = ${c.sport} AND m.season_year = ${c.season_year} AND m.week = ${c.week}
         AND m.season_phase = 'REG'`)[0];
  }
  return { contestId: c.id, firstKickoff: r?.f ?? null, lastKickoff: r?.l ?? null, games: r?.n ?? 0 };
}

/**
 * Team abbreviation -> that team's kickoff this week (R3). The pool rows
 * carry `team` as the abbreviation matches.teams uses (verified 1011 of
 * 1011 on Week 1); a team not on the slate is absent from the map and the
 * caller falls back to lastKickoff.
 */
export async function teamKickoffs({ sport, season_year, week }) {
  const rows = await sql`
    SELECT m.kickoff_at, h.abbreviation home, a.abbreviation away
      FROM matches m JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE l.slug = ${sport} AND m.season_year = ${season_year} AND m.week = ${week}
       AND m.season_phase = 'REG'`;
  const map = new Map();
  for (const m of rows) { map.set(m.home, m.kickoff_at); map.set(m.away, m.kickoff_at); }
  return map;
}

/** Pure: a pool row's lock instant. */
export function rowKickoff(row, kickoffs, lastKickoff) {
  return kickoffs?.get?.(row?.team) ?? lastKickoff ?? null;
}
