// lib/today/daySlate.js - the league's DAY of games.
//
// WHY NOT weekSlate(). That reader groups on `matches.week`, and baseball has
// no weeks: every MLB row carries week NULL, so its WHERE m.week IS NOT NULL
// returns nothing and weekSlate('mlb') is null on every day of the season. It
// is not a bug in that reader - a 162-game schedule has no week to be the
// slate, and "this week" for baseball would be a bucket of sixty games that no
// reader thinks of as a unit.
//
// THE DAY IS THE AMERICAN CALENDAR DAY, not the UTC one. A 01:45Z first pitch
// is the previous evening's game in every sense a reader has, and a UTC day
// would file the west coast under tomorrow and leave the band empty at 6pm PT.
//
// TODAY, OR THE NEXT DAY THAT HAS GAMES. An off day is a real thing in this
// sport - the All-Star break, a travel day, the gap between the LDS and the
// LCS - and a band that renders nothing on those days is a chip that toggles
// an empty space. The same three-step choice weekSlate makes, one day wide.

import { sql } from '../db.js';

const ET = 'America/New_York';

export async function daySlate(leagueSlug, { now = new Date(), limit = 24 } = {}) {
  const iso = new Date(now).toISOString();
  const rows = await sql`
    WITH days AS (
      SELECT (m.kickoff_at AT TIME ZONE ${ET})::date AS d, min(m.kickoff_at) AS lo
        FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = ${leagueSlug}
       GROUP BY 1
    ), chosen AS (
      SELECT d, CASE
                  WHEN d = (${iso}::timestamptz AT TIME ZONE ${ET})::date THEN 0  -- today
                  WHEN d >  (${iso}::timestamptz AT TIME ZONE ${ET})::date THEN 1  -- next day with games
                  ELSE 2                                                            -- else the last played
                END AS rank
        FROM days
       -- AN OUTPUT ALIAS MAY BE ORDERED BY, BUT NOT USED INSIDE AN EXPRESSION
       -- THERE. CASE WHEN rank = 1 ... is a column reference Postgres will
       -- not resolve; the condition is restated instead of aliased.
       ORDER BY rank ASC,
                CASE WHEN d > (${iso}::timestamptz AT TIME ZONE ${ET})::date THEN d END ASC NULLS LAST,
                d DESC
       LIMIT 1
    )
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score,
           m.season_year, m.season_phase, m.week, l.slug AS league_slug,
           to_char(c.d, 'YYYY-MM-DD') AS et_day,   -- a string, so a reader never String()s a Date
           h.name AS home_name, h.abbreviation AS home_abbr,
           a.name AS away_name, a.abbreviation AS away_abbr
      FROM chosen c
      JOIN leagues l ON l.slug = ${leagueSlug}
      JOIN matches m ON m.league_id = l.id
                    AND (m.kickoff_at AT TIME ZONE ${ET})::date = c.d
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     ORDER BY m.kickoff_at ASC, m.id ASC
     LIMIT ${limit}`;

  if (!rows.length) return null;
  const first = rows[0];
  return {
    season: first.season_year,
    phase: first.season_phase,
    // NO WEEK, AND THAT IS THE POINT. WeekSlate prints a week label only when
    // there is one, so the module's context line is the date instead.
    week: null,
    day: first.et_day,
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
