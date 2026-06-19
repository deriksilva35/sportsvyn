// lib/stats.js: Stats Hub reader. Aggregates per-player tournament
// totals from match_events + players for the /stats page.
//
// Wave 1, reader-only: pure SELECTs against existing populated data
// (match_events with assist_api_id, players.position). No writes, no
// dependence on team_tournament_stats or player_match_stats (both 0
// rows on PROD; their populating pipelines are Wave 2).
//
// All exported functions take leagueSlug with a default of
// 'fifa-wc-2026' so future competitions are a param-pass, not a
// rewrite. Resolution is by slug; never by env-derived league id.
//
// One underlying aggregation runs per request, cached via React.cache
// so the page can call every leaderboard function in parallel without
// re-querying. Per-leaderboard exports slice and sort from that base.
//
// SV Points is a Sportsvyn-owned metric, not "fantasy" anywhere in
// the API or copy. See computeSvPoints for the v1 formula.

import { cache } from 'react';
import { sql } from './db.js';

// =============================================================================
// SV Points v1 (Sportsvyn metric)
// =============================================================================
// Goal:           +6 if position in (DEF, GK), else +5 (Normal Goal OR Penalty)
// Penalty bonus:  +2 additional points on top of the goal weight
// Assist:         +3
// Own goal:       -2 (attributed to the event's player_api_id)
// Yellow card:    -1
// Red card:       -3 (covers second-yellow dismissals, which arrive
//                     from the feed as 'Red Card' directly)
//
// Minutes-based bonuses and per-keeper save bonuses are NOT in v1;
// they require the player_match_stats pipeline (Wave 2).
// =============================================================================
export function computeSvPoints(player) {
  const pos = player.position;
  const isDefOrGk = pos === 'DEF' || pos === 'GK';
  const goalWeight = isDefOrGk ? 6 : 5;

  const goalsExclOwn   = Number(player.goals ?? 0);
  const penaltyGoals   = Number(player.penalty_goals ?? 0);
  const ownGoals       = Number(player.own_goals ?? 0);
  const assists        = Number(player.assists ?? 0);
  const yellows        = Number(player.yellow_cards ?? 0);
  const reds           = Number(player.red_cards ?? 0);

  const goalsPts       = goalsExclOwn * goalWeight;
  const penaltyBonus   = penaltyGoals * 2;
  const assistPts      = assists * 3;
  const ownGoalPts     = ownGoals * -2;
  const yellowPts      = yellows * -1;
  const redPts         = reds * -3;

  return goalsPts + penaltyBonus + assistPts + ownGoalPts + yellowPts + redPts;
}

// =============================================================================
// Internal: one query per request, cached. Returns one row per
// player who scored, assisted, or got carded in the league's matches.
// =============================================================================
const _aggregateAllPlayerStats = cache(async (leagueSlug) => {
  // Wide aggregation: every player who scored, assisted, or was
  // carded in the league's final/live matches. The FULL OUTER JOIN
  // unifies scorer-side and assister-side rows (a player who only
  // assists still gets a row, and vice versa). LEFT JOIN players
  // brings position + team. Players who never joined the players
  // table fall through with NULL position; their SV Points use the
  // ATT default (5).
  const rows = await sql`
    WITH lg_matches AS (
      SELECT m.id FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
      WHERE lg.slug = ${leagueSlug}
    ),
    scorer_stats AS (
      SELECT me.player_api_id,
             MAX(me.player_name) AS player_name,
             COUNT(*) FILTER (WHERE me.event_type = 'Goal'
                              AND me.detail != 'Own Goal'
                              AND me.detail != 'Goal cancelled'
                              AND me.detail != 'Missed Penalty')::int      AS goals,
             COUNT(*) FILTER (WHERE me.event_type = 'Goal'
                              AND me.detail = 'Penalty')::int               AS penalty_goals,
             COUNT(*) FILTER (WHERE me.event_type = 'Goal'
                              AND me.detail = 'Own Goal')::int              AS own_goals,
             COUNT(*) FILTER (WHERE me.event_type = 'Card'
                              AND me.detail = 'Yellow Card')::int           AS yellow_cards,
             COUNT(*) FILTER (WHERE me.event_type = 'Card'
                              AND me.detail = 'Red Card')::int              AS red_cards
      FROM match_events me
      WHERE me.is_current = true
        AND me.player_api_id IS NOT NULL
        AND me.match_id IN (SELECT id FROM lg_matches)
      GROUP BY me.player_api_id
    ),
    assist_stats AS (
      SELECT me.assist_api_id AS player_api_id,
             MAX(me.assist_name) AS assist_name,
             COUNT(*)::int AS assists
      FROM match_events me
      WHERE me.is_current = true
        AND me.event_type = 'Goal'
        AND me.detail != 'Own Goal'
        AND me.detail != 'Goal cancelled'
        AND me.detail != 'Missed Penalty'
        AND me.assist_api_id IS NOT NULL
        AND me.match_id IN (SELECT id FROM lg_matches)
      GROUP BY me.assist_api_id
    ),
    unified AS (
      SELECT
        COALESCE(s.player_api_id, a.player_api_id)              AS player_api_id,
        COALESCE(s.player_name, a.assist_name)                  AS event_name,
        COALESCE(s.goals, 0)                                    AS goals,
        COALESCE(s.penalty_goals, 0)                            AS penalty_goals,
        COALESCE(s.own_goals, 0)                                AS own_goals,
        COALESCE(a.assists, 0)                                  AS assists,
        COALESCE(s.yellow_cards, 0)                             AS yellow_cards,
        COALESCE(s.red_cards, 0)                                AS red_cards
      FROM scorer_stats s
      FULL OUTER JOIN assist_stats a ON a.player_api_id = s.player_api_id
    )
    SELECT
      u.player_api_id,
      COALESCE(p.full_name, u.event_name)              AS player_name,
      p.id                                              AS player_row_id,
      p.slug                                            AS player_slug,
      p.position                                        AS position,
      t.name                                            AS team_name,
      t.slug                                            AS team_slug,
      t.abbreviation                                    AS team_abbr,
      u.goals, u.penalty_goals, u.own_goals,
      u.assists, u.yellow_cards, u.red_cards,
      (u.goals + u.assists)::int                        AS goal_contributions
    FROM unified u
    LEFT JOIN players p ON (p.external_ids->>'api_sports')::int = u.player_api_id
    LEFT JOIN teams   t ON t.id = p.current_team_id
  `;

  // Compute SV Points per row.
  return rows.map((r) => ({
    ...r,
    sv_points: computeSvPoints(r),
  }));
});

// =============================================================================
// Tournament totals (for Overview tile)
// =============================================================================
export const getTournamentTotals = cache(async (leagueSlug = 'fifa-wc-2026') => {
  const [matchCounts] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE m.status = 'final')::int           AS finals,
      COUNT(*) FILTER (WHERE m.status = 'live')::int            AS live_matches,
      COUNT(*) FILTER (WHERE m.status IN ('final', 'live'))::int AS played_or_live
    FROM matches m
    JOIN leagues lg ON lg.id = m.league_id
    WHERE lg.slug = ${leagueSlug}
  `;
  const [eventCounts] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE me.event_type = 'Goal'
                       AND me.detail != 'Own Goal'
                       AND me.detail != 'Goal cancelled'
                       AND me.detail != 'Missed Penalty')::int  AS goals,
      COUNT(*) FILTER (WHERE me.event_type = 'Goal'
                       AND me.detail = 'Own Goal')::int          AS own_goals,
      COUNT(*) FILTER (WHERE me.event_type = 'Goal'
                       AND me.detail != 'Own Goal'
                       AND me.detail != 'Goal cancelled'
                       AND me.detail != 'Missed Penalty'
                       AND me.assist_api_id IS NOT NULL)::int    AS assists_recorded,
      COUNT(*) FILTER (WHERE me.event_type = 'Card'
                       AND me.detail = 'Yellow Card')::int       AS yellow_cards,
      COUNT(*) FILTER (WHERE me.event_type = 'Card'
                       AND me.detail = 'Red Card')::int          AS red_cards
    FROM match_events me
    JOIN matches m  ON m.id = me.match_id
    JOIN leagues lg ON lg.id = m.league_id
    WHERE lg.slug = ${leagueSlug}
      AND me.is_current = true
  `;

  const totalGoals = (eventCounts.goals ?? 0) + (eventCounts.own_goals ?? 0);
  const matchesPlayed = matchCounts.played_or_live ?? 0;
  const avgGoalsPerMatch = matchesPlayed > 0
    ? Math.round((totalGoals / matchesPlayed) * 10) / 10
    : 0;

  return {
    matches_played:       matchesPlayed,
    finals:               matchCounts.finals ?? 0,
    live_matches:         matchCounts.live_matches ?? 0,
    goals:                eventCounts.goals ?? 0,
    own_goals:            eventCounts.own_goals ?? 0,
    total_goals_incl_og:  totalGoals,
    avg_goals_per_match:  avgGoalsPerMatch,
    assists_recorded:     eventCounts.assists_recorded ?? 0,
    yellow_cards:         eventCounts.yellow_cards ?? 0,
    red_cards:            eventCounts.red_cards ?? 0,
  };
});

// =============================================================================
// Sorting helpers (deterministic ties)
// =============================================================================
function descBy(key, ...tiebreakers) {
  return (a, b) => {
    const d = (b[key] ?? 0) - (a[key] ?? 0);
    if (d !== 0) return d;
    for (const tk of tiebreakers) {
      const td = (b[tk] ?? 0) - (a[tk] ?? 0);
      if (td !== 0) return td;
    }
    return String(a.player_name ?? '').localeCompare(String(b.player_name ?? ''));
  };
}

// =============================================================================
// Leaderboard exports. Each takes leagueSlug + optional limit. Pure
// slices over the cached aggregation.
// =============================================================================

export async function getScorers(leagueSlug = 'fifa-wc-2026', limit = null) {
  const all = await _aggregateAllPlayerStats(leagueSlug);
  const sorted = all
    .filter((p) => p.goals > 0)
    .sort(descBy('goals', 'assists'));
  return limit ? sorted.slice(0, limit) : sorted;
}

export async function getAssists(leagueSlug = 'fifa-wc-2026', limit = null) {
  const all = await _aggregateAllPlayerStats(leagueSlug);
  const sorted = all
    .filter((p) => p.assists > 0)
    .sort(descBy('assists', 'goals'));
  return limit ? sorted.slice(0, limit) : sorted;
}

export async function getGoalContributions(leagueSlug = 'fifa-wc-2026', limit = null) {
  const all = await _aggregateAllPlayerStats(leagueSlug);
  const sorted = all
    .filter((p) => p.goal_contributions > 0)
    .sort(descBy('goal_contributions', 'goals'));
  return limit ? sorted.slice(0, limit) : sorted;
}

export async function getDiscipline(leagueSlug = 'fifa-wc-2026', limit = null) {
  // Rank by red cards first (the heavier offense), then yellow.
  const all = await _aggregateAllPlayerStats(leagueSlug);
  const sorted = all
    .filter((p) => (p.yellow_cards + p.red_cards) > 0)
    .sort((a, b) => {
      const dr = (b.red_cards ?? 0) - (a.red_cards ?? 0);
      if (dr !== 0) return dr;
      const dy = (b.yellow_cards ?? 0) - (a.yellow_cards ?? 0);
      if (dy !== 0) return dy;
      return String(a.player_name ?? '').localeCompare(String(b.player_name ?? ''));
    });
  return limit ? sorted.slice(0, limit) : sorted;
}

export async function getSvPoints(leagueSlug = 'fifa-wc-2026', limit = null) {
  const all = await _aggregateAllPlayerStats(leagueSlug);
  const sorted = all
    .filter((p) => p.sv_points > 0)
    .sort(descBy('sv_points', 'goals', 'assists'));
  return limit ? sorted.slice(0, limit) : sorted;
}

// All players who appeared in events. Used by the All Stats table.
// Returns every player row with goals/assists/cards/sv; the client
// component handles sort state.
export async function getAllStatsPlayers(leagueSlug = 'fifa-wc-2026') {
  const all = await _aggregateAllPlayerStats(leagueSlug);
  // Default sort: SV Points desc. Client can re-sort.
  return [...all].sort(descBy('sv_points', 'goals', 'assists'));
}

// Overview bundle: tournament totals + top 5 of each leaderboard.
// One function for the Overview tile grid.
export async function getOverview(leagueSlug = 'fifa-wc-2026') {
  const [totals, scorers, assists, goalContributions, svPoints, discipline] =
    await Promise.all([
      getTournamentTotals(leagueSlug),
      getScorers(leagueSlug, 5),
      getAssists(leagueSlug, 5),
      getGoalContributions(leagueSlug, 5),
      getSvPoints(leagueSlug, 5),
      getDiscipline(leagueSlug, 5),
    ]);
  return { totals, scorers, assists, goalContributions, svPoints, discipline };
}
