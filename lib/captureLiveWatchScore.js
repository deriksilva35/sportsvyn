// lib/captureLiveWatchScore.js — single-tick history capture for the
// Live Watch Score. Called by /api/cron/poll-live's per-match loop
// AFTER syncFixture, inside its own try/catch so a capture failure
// can't break score-polling.
//
// What this function does (read-only on the source tables, single write
// to match_watch_score_history):
//   1. Skip unless status IN ('live','final').
//   2. In parallel, fetch:
//      - is_current=true match_events for the fixture (same filter as
//        KeyMoments and aiBrief's DB-read path, so phantom events
//        cancelled by VAR never count).
//      - latest match_statistics snapshot for both sides (v3 attacking
//        inputs: Total Shots, Shots on Goal).
//      - per-team Sportsvyn power score from ranking_entries on the
//        team-power list's current edition (v4 stakes input).
//      - devigged pre-match win prob from odds_markets WHERE
//        market_type='match_winner' AND is_current=true (v4
//        expectation-gap input).
//   3. accumulateState(events) -> state, then merge in shots / SOG /
//      power / win-prob inputs into the state object passed to
//      computeLiveWatchScore.
//   4. computeLiveWatchScore(state + minute) -> composite + components.
//   5. INSERT into match_watch_score_history with ON CONFLICT DO NOTHING
//      against the terminal partial unique (migration 025) — one FT/AET/PEN
//      row per match; live ticks append.
//
// Cost: a handful of SELECTs in parallel (~30-150ms total) + 1 INSERT.
// Wall time stays well within poll-live's 60s deadline even at multiple
// simultaneous live matches.
//
// Failure: throws are caught by poll-live's wrapper. Worst case is a
// missed tick; next minute's tick will land just fine. Any v4-input
// source missing (e.g. odds not yet fetched) degrades the affected term
// to 0 inside computeLiveWatchScore — no exception leaks.

import { sql } from './db.js';
import {
  computeLiveWatchScore,
  accumulateState,
  computeStarBump,
  FORMULA_VERSION,
} from './liveWatchScore.js';

// Per-match cache for the FIXED v4 inputs (team power scores + pre-match
// devigged win probability). These do not change tick-to-tick during a
// match. Ranking editions update weekly; pre-match odds are by definition
// frozen at kickoff. Caching in-process drops the per-tick query count
// from 3 to 2 after the first tick of a match. Cache lives for the
// process lifetime (cron functions on Vercel Fluid re-pool but the
// hit/miss ratio favors caching: a live match is polled ~once per minute
// from a hot worker for the duration of the match, then the worker may
// recycle).
//
// Cache invalidation is intentionally absent: if a power-ranking edition
// is republished mid-tournament or an odds book updates the pre-match
// row, the cached value stays. That is the correct semantic for the
// expectation-gap term, which keys on the PRE-MATCH expectation, not
// live odds drift.
const matchMetaCache = new Map();

async function fetchMatchMetaCached(matchDbId) {
  if (matchMetaCache.has(matchDbId)) {
    return matchMetaCache.get(matchDbId);
  }
  const rows = await sql`
    WITH
      m AS (
        SELECT id, home_team_id, away_team_id FROM matches WHERE id = ${matchDbId}
      ),
      current_team_power AS (
        SELECT re.team_id, re.score AS power_score
          FROM ranking_entries re
          JOIN ranking_editions ed ON ed.id = re.ranking_edition_id AND ed.is_current = true
          JOIN ranking_lists rl ON rl.id = ed.ranking_list_id AND rl.slug = 'team-power'
         WHERE re.entity_type = 'team'
      ),
      winp AS (
        SELECT
          MAX(implied_probability) FILTER (WHERE selection_label = 'home') AS home_win_pct,
          MAX(implied_probability) FILTER (WHERE selection_label = 'away') AS away_win_pct
        FROM odds_markets
        WHERE match_id = ${matchDbId}
          AND market_type = 'match_winner'
          AND is_current = true
      )
    SELECT
      (SELECT power_score FROM current_team_power, m WHERE current_team_power.team_id = m.home_team_id)::float AS home_power_score,
      (SELECT power_score FROM current_team_power, m WHERE current_team_power.team_id = m.away_team_id)::float AS away_power_score,
      (SELECT home_win_pct FROM winp)::float AS home_win_pct,
      (SELECT away_win_pct FROM winp)::float AS away_win_pct
  `;
  const meta = rows[0] ?? {};
  matchMetaCache.set(matchDbId, meta);
  return meta;
}

export async function captureLiveWatchScoreTick(matchDbId, syncResult) {
  // Eligibility gate: only capture for live or final matches. Belt-and-
  // suspenders against the caller — getMatchesToPoll already filters
  // scheduled-near-kickoff matches in, and syncFixture may return one
  // of those with status='scheduled' if API-Sports hasn't flipped yet.
  // Skipping those keeps the history table clean of pre-kickoff rows.
  if (syncResult?.status !== 'live' && syncResult?.status !== 'final') {
    return { skipped: 'not-live-or-final' };
  }

  // Parallel fetch of the two PER-TICK queries (events + latest stats).
  // The fixed-per-match metadata (power scores + pre-match win prob) is
  // pulled from an in-process cache via fetchMatchMetaCached so the
  // per-tick query count is 2 (not 3) once a match's first tick has
  // populated the cache. First tick of a match pays the third query;
  // every subsequent tick on the same match reads from memory.
  const [events, statsRows, meta] = await Promise.all([
    sql`
      SELECT minute, minute_extra, event_type, detail, team_side,
             player_api_id, player_name
        FROM match_events
       WHERE match_id = ${matchDbId} AND is_current = true
       ORDER BY minute ASC, minute_extra ASC NULLS LAST, id ASC
    `,
    sql`
      SELECT team_side, stats
        FROM match_statistics
       WHERE match_id = ${matchDbId} AND is_current = true
    `,
    fetchMatchMetaCached(matchDbId),
  ]);

  const state = accumulateState(events);

  // v5 star bump: derived per tick from the match's cumulative goal
  // events. Match-level constant (same value for every tick once the
  // qualifying scorer's nth goal lands). Pure aggregation in
  // computeStarBump; no DB hit, no external dependency. When no
  // multi-goal scorer exists yet, bump=0 and computeLiveWatchScore
  // falls into its v4-identical dormant path (validated in
  // /tmp/v5-validation.mjs check E).
  const starInfo = computeStarBump(events);
  const minute = syncResult.minute ?? null;
  const minuteExtra = null;                            // syncFixture doesn't expose minute_extra; live ticks tag end-of-minute
  const statusShort = syncResult.status_short ?? null;

  // Pull v3 attacking inputs out of the latest stats snapshot rows.
  // Stats jsonb values come back as raw API-Sports strings or numbers
  // depending on the type; coerce numerically. Either side missing
  // (early ticks before stats are first fetched) degrades attacking_pts
  // to 0 inside computeLiveWatchScore.
  const homeStatsRow = statsRows.find((r) => r.team_side === 'home');
  const awayStatsRow = statsRows.find((r) => r.team_side === 'away');
  const num = (v) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const home_total_shots   = num(homeStatsRow?.stats?.['Total Shots']);
  const away_total_shots   = num(awayStatsRow?.stats?.['Total Shots']);
  const home_shots_on_goal = num(homeStatsRow?.stats?.['Shots on Goal']);
  const away_shots_on_goal = num(awayStatsRow?.stats?.['Shots on Goal']);

  const { composite, components } = computeLiveWatchScore({
    home_score:   state.home_score,
    away_score:   state.away_score,
    goals_count:  state.goals_count,
    lead_changes: state.lead_changes,
    yellow_cards: state.yellow_cards,
    red_cards:    state.red_cards,
    minute:       minute ?? 0,
    // v3 attacking inputs
    home_total_shots,
    away_total_shots,
    home_shots_on_goal,
    away_shots_on_goal,
    // v4 stakes input
    home_power_score: meta.home_power_score ?? null,
    away_power_score: meta.away_power_score ?? null,
    // v4 expectation gap input
    home_win_pct: meta.home_win_pct ?? null,
    away_win_pct: meta.away_win_pct ?? null,
    // v5 star term (match-level)
    star_bump:   starInfo.bump,
    star_detail: starInfo.detail,
  });

  // Terminal-state idempotency: the partial unique index from migration
  // 025 enforces one FT/AET/PEN row per match. Live ticks (status_short
  // NOT IN the terminal set) don't match the partial predicate and
  // insert freely. INSERT...DO NOTHING short-circuits cleanly when a
  // terminal duplicate races in.
  const inserted = await sql`
    INSERT INTO match_watch_score_history (
      match_id,
      minute, minute_extra, status_short,
      home_score, away_score,
      goals_count, lead_changes,
      yellow_cards, red_cards,
      composite_score, formula_version, components
    ) VALUES (
      ${matchDbId},
      ${minute}, ${minuteExtra}, ${statusShort},
      ${state.home_score}, ${state.away_score},
      ${state.goals_count}, ${state.lead_changes},
      ${state.yellow_cards}, ${state.red_cards},
      ${composite}, ${FORMULA_VERSION},
      ${JSON.stringify(components)}::jsonb
    )
    ON CONFLICT (match_id) WHERE status_short IN ('FT', 'AET', 'PEN') DO NOTHING
    RETURNING id, composite_score, status_short
  `;

  if (!inserted[0]) {
    return { skipped: 'terminal-conflict', status_short: statusShort };
  }
  return {
    inserted: true,
    id: inserted[0].id,
    composite: Number(inserted[0].composite_score),
    status_short: inserted[0].status_short,
  };
}
