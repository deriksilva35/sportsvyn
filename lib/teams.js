/**
 * lib/teams.js — Team page data access.
 *
 * Each function takes the neon `sql` helper from lib/db.js and returns plain
 * objects (Server Components consume them directly). Single-statement queries
 * only — interactive transactions are deferred per lib/db.js Phase-0 scope.
 *
 * Column names match the schema in migrations/004,005,006,009,011,012,013,
 * 014,017. Joins are explicit; no SELECT *.
 */

import { sql } from '@/lib/db';

export async function getTeamBySlug(slug) {
  // PROD's teams table has 47 slugs duplicated across leagues — legacy
  // friendlies / CONCACAF Gold Cup / AFCON imports shadow the WC row for
  // the same country. LIMIT 1 with no ORDER BY returned an arbitrary row,
  // which masked the team_outlook blurb on most WC team pages. The
  // duplicate-team-row cleanup is tracked separately; this SELECT
  // disambiguates deterministically:
  //   1) prefer the row that ALREADY has a current_outlook_blurb_id set,
  //   2) then prefer the WC-league row,
  //   3) then tiebreak by id ASC (stable).
  // For non-duplicated slugs all three terms collapse and behavior is
  // identical to the prior LIMIT 1.
  const rows = await sql`
    SELECT
      t.id, t.slug, t.name, t.short_name, t.abbreviation,
      t.confederation, t.coach_name, t.fifa_rank, t.group_code,
      t.current_power_rank, t.current_power_score, t.current_rank_movement,
      t.tournament_wins, t.tournament_draws, t.tournament_losses,
      t.tournament_goals_for, t.tournament_goals_against,
      t.flag_color_primary, t.flag_svg_path,
      b.id                    AS blurb_id,
      b.body                  AS blurb_body,
      b.generation_tier       AS blurb_tier,
      b.voice_model_version   AS blurb_voice_version,
      b.published_at          AS blurb_published_at,
      b.auto_published        AS blurb_auto_published,
      b.status                AS blurb_status
    FROM teams t
    LEFT JOIN editorial_blurbs b ON b.id = t.current_outlook_blurb_id
    LEFT JOIN leagues         lg ON lg.id = t.league_id
    WHERE t.slug = ${slug}
    ORDER BY
      (t.current_outlook_blurb_id IS NOT NULL) DESC,
      (lg.slug = 'fifa-wc-2026')                DESC,
      t.id ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getTeamStats(teamId) {
  const rows = await sql`
    SELECT
      matches_played, wins, draws, losses,
      goals_for, goals_against, goal_differential, clean_sheets,
      xg, xga, xgd,
      possession_pct, pass_completion_pct,
      shots, shots_on_target,
      rank_goals_for, rank_goals_against, rank_goal_differential,
      rank_xg, rank_xga, rank_possession, rank_pass_completion
    FROM team_tournament_stats
    WHERE team_id = ${teamId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getTeamMatches(teamId) {
  const rows = await sql`
    SELECT
      m.id, m.slug, m.kickoff_at, m.status, m.stage, m.group_code,
      m.home_team_id, m.away_team_id, m.home_score, m.away_score, m.venue,
      h.name              AS home_name,
      h.short_name        AS home_short_name,
      h.abbreviation      AS home_abbreviation,
      h.slug              AS home_slug,
      h.flag_color_primary AS home_flag_color,
      a.name              AS away_name,
      a.short_name        AS away_short_name,
      a.abbreviation      AS away_abbreviation,
      a.slug              AS away_slug,
      a.flag_color_primary AS away_flag_color
    FROM matches m
    LEFT JOIN teams h ON h.id = m.home_team_id
    LEFT JOIN teams a ON a.id = m.away_team_id
    WHERE m.home_team_id = ${teamId} OR m.away_team_id = ${teamId}
    ORDER BY m.kickoff_at
  `;
  return rows;
}

export async function getTopPlayers(teamId) {
  const rows = await sql`
    SELECT
      p.id, p.slug, p.full_name, p.known_as, p.position, p.nationality,
      p.current_team_jersey_number, p.height_cm, p.preferred_foot,
      p.club_name, p.international_caps, p.international_goals,
      p.photo_url_treated, p.tournament_goals, p.tournament_assists,
      p.birthdate,
      EXTRACT(YEAR FROM age(p.birthdate))::int AS age,
      pts.matches_played, pts.starts, pts.minutes_played,
      pts.goals, pts.assists, pts.goal_contributions,
      pts.xg, pts.xa, pts.xg_plus_xa,
      pts.shots, pts.shots_on_target,
      pts.composite_score, pts.rank_composite,
      pts.saves, pts.save_pct, pts.clean_sheets
    FROM players p
    JOIN player_tournament_stats pts ON pts.player_id = p.id
    WHERE p.current_team_id = ${teamId}
    ORDER BY pts.composite_score DESC NULLS LAST
    LIMIT 3
  `;
  return rows;
}

export async function getTeamTrajectory(teamId) {
  const rows = await sql`
    SELECT
      re.id              AS entry_id,
      re.rank,
      re.score,
      re.previous_rank,
      re.rank_movement,
      re.movement_label,
      e.edition_number,
      e.edition_label,
      e.is_current,
      e.published_at
    FROM ranking_entries re
    JOIN ranking_editions e ON e.id = re.ranking_edition_id
    JOIN ranking_lists rl   ON rl.id = e.ranking_list_id
    WHERE re.team_id = ${teamId}
      AND rl.slug = 'team-power'
      AND e.status = 'published'
    ORDER BY e.edition_number
  `;
  return rows;
}

export async function getTeamOdds(teamId, nextMatchId) {
  if (!nextMatchId) {
    const rows = await sql`
      SELECT
        id, market_scope, market_type, selection_label,
        american_odds, implied_probability, decimal_odds,
        source_books, num_books, consensus_method,
        previous_american_odds, previous_implied_prob,
        movement_24h_odds, movement_24h_prob,
        is_current, fetched_at
      FROM odds_markets
      WHERE team_id = ${teamId}
        AND is_current = true
        AND market_scope = 'futures'
        AND market_type = 'tournament_winner'
      LIMIT 1
    `;
    return { tournamentWinner: rows[0] ?? null, matchWinner: null };
  }

  const rows = await sql`
    SELECT
      id, market_scope, market_type, selection_label,
      american_odds, implied_probability, decimal_odds,
      source_books, num_books, consensus_method,
      previous_american_odds, previous_implied_prob,
      movement_24h_odds, movement_24h_prob,
      is_current, fetched_at, match_id
    FROM odds_markets
    WHERE team_id = ${teamId}
      AND is_current = true
      AND (
        (market_scope = 'futures' AND market_type = 'tournament_winner')
        OR
        (market_scope = 'match' AND market_type = 'match_winner' AND match_id = ${nextMatchId})
      )
  `;

  return {
    tournamentWinner: rows.find((r) => r.market_scope === 'futures') ?? null,
    matchWinner: rows.find((r) => r.market_scope === 'match') ?? null,
  };
}

export async function getNextMatchBroadcasters(matchId) {
  if (!matchId) return [];
  const rows = await sql`
    SELECT
      broadcaster_name, broadcaster_type, is_primary,
      display_order, channel_url, language_code, country_code
    FROM match_broadcasters
    WHERE match_id = ${matchId}
    ORDER BY display_order
  `;
  return rows;
}
