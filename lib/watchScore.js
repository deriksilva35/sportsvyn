// lib/watchScore.js — read helpers for match_watch_score_history.
//
// The per-match watch score table carries one row per poll-live tick.
// "Current" or "peak" semantics depend on the caller — these helpers
// pick the SINGLE peak (max composite_score) per match for display
// rails, NOT the live-tick value (which would jitter every minute).
//
// All helpers return [] on no-data. No throws on absence.

import { sql } from './db.js';

// =============================================================================
// getWatchScoresForDate(ptDay)
//
// Returns matches whose kickoff (in America/Los_Angeles) lands on ptDay,
// joined with each match's PEAK match_watch_score_history row, ordered
// by peak composite DESC.
//
// Each row shaped:
//   { match_id, slug, home_name, home_abbr, home_flag_svg,
//     away_name, away_abbr, away_flag_svg,
//     home_score, away_score, status, composite }
//
// composite is the match's PEAK (MAX composite_score across the series).
// =============================================================================
export async function getWatchScoresForDate(ptDay) {
  if (!ptDay) return [];
  const rows = await sql`
    SELECT
      m.id AS match_id,
      m.slug,
      m.home_score,
      m.away_score,
      m.status,
      ht.name AS home_name,
      ht.abbreviation AS home_abbr,
      ht.flag_svg_path AS home_flag_svg,
      at.name AS away_name,
      at.abbreviation AS away_abbr,
      at.flag_svg_path AS away_flag_svg,
      h.composite::float AS composite
    FROM matches m
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    JOIN LATERAL (
      SELECT MAX(composite_score)::float AS composite
        FROM match_watch_score_history h
       WHERE h.match_id = m.id
    ) h ON h.composite IS NOT NULL
    WHERE (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date = ${ptDay}::date
    ORDER BY h.composite DESC
  `;
  return rows;
}

// =============================================================================
// getTopWatchScores({ limit })
//
// Convenience wrapper: today's (PT) top watch-scored matches, capped at
// `limit` rows. The sidebar's "Watch Scores · Today" rail consumes this.
// =============================================================================
export async function getTopWatchScores({ limit = 3 } = {}) {
  const r = await sql`SELECT to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS d`;
  const ptDay = r[0].d;
  const rows = await getWatchScoresForDate(ptDay);
  return rows.slice(0, limit);
}
