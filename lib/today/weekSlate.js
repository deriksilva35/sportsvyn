// lib/today/weekSlate.js - the league's WEEK of games, derived.
//
// NEVER A CALENDAR WEEK. CFB week 1 of 2026 opens Saturday Aug 29 and does not
// finish until Monday Sep 7 - 99 games across ten days - so "this week" is the
// span of a week GROUP in `matches`, not seven days from today. A module keyed
// on the calendar would split that slate in half on Sep 1 and show a reader
// three games while the week was still being played.
//
// THE WINDOW IS CHOSEN, NOT COMPUTED FROM A DATE. In priority:
//   1. the week currently IN PROGRESS - now falls between its first and last
//      kickoff, which is the Aug 29 - Sep 7 case
//   2. else the NEXT week to start
//   3. else the LAST week played, so an offseason page shows the season's end
//      rather than nothing
//
// PRESEASON IS INCLUDED HERE ON PURPOSE, and that is not a contradiction of the
// ranker's exclusion. The exclusion law governs ORDERING and landmarks - an
// exhibition must not float the NFL band above CFB, and must not move the
// season countdown. It says nothing about visibility: /scores lists preseason,
// badged, and so does this. A reader looking at the NFL's week this Thursday
// should see the games that are actually on.
//
// All three leagues carry `week`: CFB 1-16 over two phases, NFL 0-18 over
// three, EPL 1-38 with a NULL phase throughout. IS NOT DISTINCT FROM is what
// groups the EPL rows - `=` on a NULL phase matches nothing.

import { sql } from '../db.js';

/**
 * One query: rank the week groups, take the winner, return its games.
 *
 * Done as a single statement rather than "find the week, then fetch it"
 * because the two halves must agree about which week they mean, and two
 * round trips a few milliseconds apart across a kickoff boundary can
 * disagree.
 */
export async function weekSlate(leagueSlug, { now = new Date(), limit = 40 } = {}) {
  const iso = new Date(now).toISOString();
  const rows = await sql`
    WITH weeks AS (
      SELECT m.season_year, m.season_phase, m.week,
             min(m.kickoff_at) AS lo, max(m.kickoff_at) AS hi
        FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = ${leagueSlug} AND m.week IS NOT NULL
       GROUP BY m.season_year, m.season_phase, m.week
    ), chosen AS (
      SELECT *, CASE
                  WHEN lo <= ${iso} AND hi >= ${iso} THEN 0   -- in progress
                  WHEN lo > ${iso}                    THEN 1   -- next to start
                  ELSE 2                                        -- already played
                END AS rank
        FROM weeks
       ORDER BY rank ASC,
                CASE WHEN lo > ${iso} THEN lo END ASC NULLS LAST,
                hi DESC
       LIMIT 1
    )
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score,
           m.season_year, m.season_phase, m.week, l.slug AS league_slug,
           h.name AS home_name, h.abbreviation AS home_abbr,
           a.name AS away_name, a.abbreviation AS away_abbr,
           c.lo AS week_from, c.hi AS week_to
      FROM chosen c
      JOIN leagues l ON l.slug = ${leagueSlug}
      JOIN matches m ON m.league_id = l.id
                    AND m.season_year = c.season_year
                    AND m.season_phase IS NOT DISTINCT FROM c.season_phase
                    AND m.week = c.week
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     ORDER BY m.kickoff_at ASC, m.id ASC
     LIMIT ${limit}`;

  if (!rows.length) return null;
  const first = rows[0];
  return {
    season: first.season_year,
    phase: first.season_phase,
    week: first.week,
    from: first.week_from,
    to: first.week_to,
    games: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      status: r.status,
      kickoffAt: r.kickoff_at,
      homeScore: r.home_score,
      awayScore: r.away_score,
      seasonPhase: r.season_phase,
      week: r.week,
      leagueSlug: r.league_slug,
      home: { name: r.home_name, abbreviation: r.home_abbr },
      away: { name: r.away_name, abbreviation: r.away_abbr },
    })),
  };
}
