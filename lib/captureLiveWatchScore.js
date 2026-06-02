// lib/captureLiveWatchScore.js — single-tick history capture for the
// Live Watch Score. Called by /api/cron/poll-live's per-match loop
// AFTER syncFixture, inside its own try/catch so a capture failure
// can't break score-polling.
//
// What this function does (read-only on match_events, single write to
// match_watch_score_history):
//   1. Skip unless status IN ('live','final').
//   2. SELECT is_current=true match_events for the fixture — same filter
//      as KeyMoments and aiBrief's DB-read path, so phantom events
//      cancelled by VAR never count toward goals/lead_changes.
//   3. accumulateState(events) → derive home/away_score + goals_count +
//      lead_changes + yellow_cards + red_cards. This is also the
//      score-of-truth for the formula (consistent with is_current).
//   4. computeLiveWatchScore(state + minute) → composite + components.
//   5. INSERT into match_watch_score_history with ON CONFLICT DO NOTHING
//      against the terminal partial unique (migration 025) — one FT/AET/PEN
//      row per match; live ticks append.
//
// Cost: 1 SELECT on match_events (~1-30 rows for a live match) + 1
// INSERT. Wall time ~30-80ms per match per tick. Well within poll-live's
// 60s deadline even at 5 simultaneous live matches.
//
// Failure: throws are caught by poll-live's wrapper. Worst case is a
// missed tick; next minute's tick will land just fine.

import { sql } from './db.js';
import {
  computeLiveWatchScore,
  accumulateState,
  FORMULA_VERSION,
} from './liveWatchScore.js';

const TERMINAL_STATUS_SHORTS = new Set(['FT', 'AET', 'PEN']);

export async function captureLiveWatchScoreTick(matchDbId, syncResult) {
  // Eligibility gate: only capture for live or final matches. Belt-and-
  // suspenders against the caller — getMatchesToPoll already filters
  // scheduled-near-kickoff matches in, and syncFixture may return one
  // of those with status='scheduled' if API-Sports hasn't flipped yet.
  // Skipping those keeps the history table clean of pre-kickoff rows.
  if (syncResult?.status !== 'live' && syncResult?.status !== 'final') {
    return { skipped: 'not-live-or-final' };
  }

  // Read current event state. is_current=true is the same filter the
  // page-side reads use; a VAR-cancelled goal is is_current=false and
  // therefore excluded from the score the formula sees.
  const events = await sql`
    SELECT minute, minute_extra, event_type, detail, team_side
      FROM match_events
     WHERE match_id = ${matchDbId} AND is_current = true
     ORDER BY minute ASC, minute_extra ASC NULLS LAST, id ASC
  `;

  const state = accumulateState(events);
  const minute = syncResult.minute ?? null;
  const minuteExtra = null;                            // syncFixture doesn't expose minute_extra; live ticks tag end-of-minute
  const statusShort = syncResult.status_short ?? null;

  const { composite, components } = computeLiveWatchScore({
    home_score:   state.home_score,
    away_score:   state.away_score,
    goals_count:  state.goals_count,
    lead_changes: state.lead_changes,
    yellow_cards: state.yellow_cards,
    red_cards:    state.red_cards,
    minute:       minute ?? 0,
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
