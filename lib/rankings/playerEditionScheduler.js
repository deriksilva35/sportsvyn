// lib/rankings/playerEditionScheduler.js -- Phase 3 daily orchestrator.
//
// publishPlayerEditionDaily({ sql, leagueSlug, listSlug, dryRun }) runs the
// 6-step matchday-edition pipeline:
//
//   1. LIVE CHECK     -- HOLD if any match is live or settled in last 5 min.
//   2. IDEMPOTENCY    -- no-op if current final count <= prior edition's
//                        scored_at_finals_count.
//   3. DRIFT-COLLAPSE -- rollup production, reuse cached impact, score
//                        fresh impact for new candidates only, rank with
//                        deterministic tiebreak, retry up to 3 times on
//                        finals-count drift. HOLD if still unstable.
//   4. PUBLISH BOARD  -- atomic via publishPlayerEdition with blurbs=[]
//                        (board + entries; ZERO inline blurb writes).
//   5. QUEUE DRAFTS   -- top 10 -> draftRankingRowBlurb (pending_review).
//   6. RETURN JSON    -- structured result for the cron handler to log.
//
// HOLD-not-force discipline throughout: every safety gate returns a HOLD
// result, never forces a write. A no-op or hold is the correct outcome,
// not a failure.
//
// dryRun=true short-circuits at steps 4 and 5: the board is computed and
// returned but not written; the draft list is identified but not inserted.

import {
  DEFAULT_PARAMS,
  rollupProductionForLeague,
  computeComposite,
  assemblePlayerEnvelope,
  scoreImpact,
} from './playerPowerScorer.js';
import {
  publishPlayerEdition,
  rankAndAssignMovement,
  loadPriorByPlayerId,
} from './playerEditionRunner.js';
import { draftRankingRowBlurb } from './blurbDrafter.js';

const MAX_DRIFT_ITERATIONS = 3;
const CANDIDATE_POOL       = 50;
const TOP_N_BLURBS         = 10;

// Date label fallback when no matchday derivation is available.
function isoDateUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

// Edition label derivation. WC structure:
//   group stage: 12 groups * 6 matches per group / 2 teams = 72 group matches
//   MD1 = 24 matches, MD2 = 48 cumulative, MD3 = 72 cumulative.
//   knockout: R16 = +8, QF = +4, SF = +2, F = +1 (+3rd place).
function deriveMatchdayLabel(finalsCount) {
  if (finalsCount <= 24) return 'After Matchday 1';
  if (finalsCount <= 48) return 'After Matchday 2';
  if (finalsCount <= 72) return 'After Group Stage';
  if (finalsCount <= 80) return 'After Round of 16';
  if (finalsCount <= 84) return 'After Quarterfinals';
  if (finalsCount <= 86) return 'After Semifinals';
  return `Update ${isoDateUTC()}`;
}

// Read-only drift snapshot. Used at both ends of step 3 to detect data
// shifting under us during the score/rank pass.
async function driftSnapshot({ sql, leagueSlug }) {
  const r = await sql`
    SELECT
      (SELECT count(*)::int FROM matches m JOIN leagues lg ON lg.id=m.league_id
        WHERE lg.slug=${leagueSlug} AND m.status='final')                     AS finals,
      (SELECT count(*)::int FROM match_events me
        JOIN matches m ON m.id = me.match_id
        JOIN leagues lg ON lg.id = m.league_id
        WHERE lg.slug=${leagueSlug} AND me.is_current=true)                   AS events,
      (SELECT count(*)::int FROM match_events me
        JOIN matches m ON m.id = me.match_id
        JOIN leagues lg ON lg.id = m.league_id
        WHERE lg.slug=${leagueSlug} AND me.is_current=true
          AND me.event_type='Goal')                                           AS goal_events
  `;
  return r[0];
}

// Read-only live check. Returns { holdReason } if not safe to publish.
async function liveCheck({ sql, leagueSlug }) {
  const r = await sql`
    SELECT
      (SELECT count(*)::int FROM matches m JOIN leagues lg ON lg.id=m.league_id
        WHERE lg.slug=${leagueSlug} AND m.status='live')                            AS live_now,
      (SELECT count(*)::int FROM matches m JOIN leagues lg ON lg.id=m.league_id
        WHERE lg.slug=${leagueSlug} AND m.status='final'
          AND m.updated_at > now() - interval '5 minutes')                          AS settled_5min
  `;
  if (r[0].live_now > 0)     return { holdReason: 'live_match',    snapshot: r[0] };
  if (r[0].settled_5min > 0) return { holdReason: 'cooldown_5min', snapshot: r[0] };
  return { holdReason: null, snapshot: r[0] };
}

// Bulk player-fingerprint compute. One SQL query returns Map<player_id,
// fingerprint> for the given candidate set. Used by the impact-cache
// freshness check (Phase 3 fix).
//
// Fingerprint shape mirrors the Phase 1 blurb fingerprint exactly:
// count of match_events rows where (player_api_id = X OR assist_api_id = X)
// AND is_current = true AND match_id is in the league. The IMPACT cache
// is invalidated when this count moves -- meaning the player has new
// events since their impact was last scored.
async function loadCurrentFingerprintsByPlayerId({ sql, leagueSlug, playerIds }) {
  if (playerIds.length === 0) return new Map();
  const rows = await sql`
    SELECT p.id AS player_id,
           (SELECT count(*)::int
              FROM match_events me
              JOIN matches m ON m.id = me.match_id
              JOIN leagues lg ON lg.id = m.league_id
             WHERE lg.slug = ${leagueSlug}
               AND me.is_current = true
               AND (
                 me.player_api_id  = (p.external_ids->>'api_sports')::int
                 OR me.assist_api_id = (p.external_ids->>'api_sports')::int
               )
           ) AS fingerprint
      FROM players p
     WHERE p.id = ANY(${playerIds}::int[])
  `;
  const map = new Map();
  for (const r of rows) map.set(r.player_id, r.fingerprint);
  return map;
}

// Read-only idempotency check.
async function idempotencyCheck({ sql, listSlug, leagueSlug, currentFinals }) {
  const r = await sql`
    SELECT ed.id, ed.edition_number, ed.notes
      FROM ranking_editions ed
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      JOIN leagues lg       ON lg.id = rl.league_id
     WHERE rl.slug = ${listSlug}
       AND lg.slug = ${leagueSlug}
       AND ed.is_current = true
       AND ed.status     = 'published'
  `;
  if (r.length === 0) {
    return { priorEditionId: null, priorEditionNumber: null, priorFinalsCount: null, shouldProceed: true };
  }
  const prior = r[0];
  let priorFinals = null;
  try {
    const notes = JSON.parse(prior.notes ?? '{}');
    priorFinals = notes.scored_at_finals_count ?? null;
  } catch { /* legacy/no notes */ }
  const shouldProceed = priorFinals == null || currentFinals > priorFinals;
  return {
    priorEditionId:     prior.id,
    priorEditionNumber: prior.edition_number,
    priorFinalsCount:   priorFinals,
    shouldProceed,
  };
}

// =============================================================================
// Top-level orchestrator.
// =============================================================================
export async function publishPlayerEditionDaily({
  sql,
  leagueSlug = 'fifa-wc-2026',
  listSlug   = 'player-power',
  dryRun     = false,
  params     = DEFAULT_PARAMS,
}) {
  const startedAt = Date.now();

  // STEP 1: live check ------------------------------------------------------
  const live = await liveCheck({ sql, leagueSlug });
  if (live.holdReason) {
    return {
      action: 'hold',
      reason: live.holdReason,
      live_snapshot: live.snapshot,
      timing_ms: Date.now() - startedAt,
      dryRun,
    };
  }

  // STEP 2: idempotency -----------------------------------------------------
  const snapBefore = await driftSnapshot({ sql, leagueSlug });
  const idem = await idempotencyCheck({
    sql, listSlug, leagueSlug, currentFinals: snapBefore.finals,
  });
  if (!idem.shouldProceed) {
    return {
      action: 'no_op',
      reason: 'no_new_finals',
      current_finals: snapBefore.finals,
      prior_edition_id: idem.priorEditionId,
      prior_finals_count: idem.priorFinalsCount,
      timing_ms: Date.now() - startedAt,
      dryRun,
    };
  }

  // STEP 3: drift-collapse --------------------------------------------------
  let priorMap = null;
  let scored, ranked, snapAfter;
  let newImpactCalls = 0;
  let reusedImpactCalls = 0;
  const reuseDecisions = []; // [{player_id, full_name, decision, cached_fp, current_fp}]
  let attempt = 0;
  while (attempt < MAX_DRIFT_ITERATIONS) {
    attempt++;
    priorMap = await loadPriorByPlayerId({ sql, listSlug, leagueSlug });
    const candidates = await rollupProductionForLeague({
      sql, leagueSlug, candidatePool: CANDIDATE_POOL, params,
    });

    // Phase 3 fix: per-candidate current fingerprint. Reuse cached impact
    // IFF cached_fp == current_fp AND both are non-null. NULL cached_fp =
    // legacy/unstamped = force re-score (safe direction).
    const candidateIds = candidates.map((c) => c.player_id);
    const currentFpByPlayerId = await loadCurrentFingerprintsByPlayerId({
      sql, leagueSlug, playerIds: candidateIds,
    });
    // Reset per-iteration counters so the final attempt's tallies are accurate
    // if we loop on drift.
    newImpactCalls = 0;
    reusedImpactCalls = 0;
    reuseDecisions.length = 0;

    const players = [];
    for (const c of candidates) {
      const prior = priorMap.get(c.player_id);
      const cachedFp = prior?.impact_scored_against_fingerprint ?? null;
      const currentFp = currentFpByPlayerId.get(c.player_id) ?? null;
      let impact;
      let decision;
      if (prior?.impact_score != null && cachedFp != null && cachedFp === currentFp) {
        impact = prior.impact_score;
        decision = 'reused';
        reusedImpactCalls++;
      } else {
        const env = await assemblePlayerEnvelope({
          sql, playerId: c.player_id, leagueSlug,
        });
        const r = await scoreImpact(env);
        if (!r.ok) throw new Error(`scoreImpact failed for player_id=${c.player_id}: ${r.error}`);
        impact = r.impact;
        decision = prior?.impact_score == null ? 'fresh_no_prior'
                : cachedFp == null              ? 'fresh_unstamped_prior'
                                                : 'fresh_stale_fingerprint';
        newImpactCalls++;
      }
      reuseDecisions.push({
        player_id: c.player_id, full_name: c.full_name,
        decision, cached_fp: cachedFp, current_fp: currentFp,
        prior_impact: prior?.impact_score ?? null, used_impact: impact,
      });
      const composite = computeComposite(c.production_score, impact, params);
      players.push({
        player_id:        c.player_id,
        full_name:        c.full_name,
        team_name:        c.team_name,
        position:         c.position,
        open_play_goals:  c.open_play_goals,
        penalty_goals:    c.penalty_goals,
        assists:          c.assists,
        yellows:          c.yellows,
        reds:             c.reds,
        own_goals:        c.own_goals,
        production_raw:   c.production_raw,
        production_score: c.production_score,
        impact_score:     impact,
        impact_scored_against_fingerprint: currentFp,  // <-- Phase 3 stamp
        composite,
      });
    }
    ranked = rankAndAssignMovement({ players, priorByPlayerId: priorMap });
    scored = { candidates_count: candidates.length };
    snapAfter = await driftSnapshot({ sql, leagueSlug });

    if (
      snapAfter.finals      === snapBefore.finals &&
      snapAfter.events      === snapBefore.events &&
      snapAfter.goal_events === snapBefore.goal_events
    ) {
      // Stable; break out of collapse loop.
      break;
    }
    // Drift detected; update the baseline and retry.
    snapBefore.finals      = snapAfter.finals;
    snapBefore.events      = snapAfter.events;
    snapBefore.goal_events = snapAfter.goal_events;
  }

  const stable =
    snapAfter.finals      === snapBefore.finals &&
    snapAfter.events      === snapBefore.events &&
    snapAfter.goal_events === snapBefore.goal_events;
  if (!stable) {
    return {
      action: 'unstable_hold',
      reason: 'finals_count_drifted_after_max_iterations',
      attempts: attempt,
      snap_before: snapBefore,
      snap_after: snapAfter,
      timing_ms: Date.now() - startedAt,
      dryRun,
    };
  }

  // STEP 4: publish board ---------------------------------------------------
  const editionLabel = deriveMatchdayLabel(snapAfter.finals);
  const editionNumber = (idem.priorEditionNumber ?? 0) + 1;

  // Identify which top 10 entries would be drafted (idempotency-aware: skip
  // entries that already have a current approved blurb OR a pending draft).
  // For dryRun we still want this report; the actual draft INSERTs happen
  // post-publish using the new ranking_entry_ids returned by publishPlayerEdition.
  const top10 = ranked.slice(0, TOP_N_BLURBS);
  const draftPlan = top10.map((p) => ({
    rank: p.rank,
    player_id: p.player_id,
    full_name: p.full_name,
    team_name: p.team_name,
    movement_label: p.movement_label,
    composite: p.composite,
  }));

  if (dryRun) {
    return {
      action: 'dry_run',
      would_publish: {
        edition_label: editionLabel,
        edition_number: editionNumber,
        entry_count: ranked.length,
        top_15_board: ranked.slice(0, 15).map((p) => ({
          rank: p.rank,
          player: p.full_name,
          team:   p.team_name,
          position: p.position,
          composite: p.composite,
          production: p.production_score,
          impact: p.impact_score,
          impact_fp_stamped: p.impact_scored_against_fingerprint,
          movement_label: p.movement_label,
          rank_movement: p.rank_movement,
          prev_rank: p.prev_rank,
        })),
        would_draft: draftPlan,
      },
      drift_iterations: attempt,
      new_impact_calls: newImpactCalls,
      reused_impact_calls: reusedImpactCalls,
      reuse_decisions_summary: {
        reused:                  reuseDecisions.filter((d) => d.decision === 'reused').length,
        fresh_no_prior:          reuseDecisions.filter((d) => d.decision === 'fresh_no_prior').length,
        fresh_unstamped_prior:   reuseDecisions.filter((d) => d.decision === 'fresh_unstamped_prior').length,
        fresh_stale_fingerprint: reuseDecisions.filter((d) => d.decision === 'fresh_stale_fingerprint').length,
      },
      candidates_scored: scored.candidates_count,
      prior_edition_id: idem.priorEditionId,
      prior_edition_number: idem.priorEditionNumber,
      prior_finals_count: idem.priorFinalsCount,
      snap_before: snapBefore,
      snap_after: snapAfter,
      timing_ms: Date.now() - startedAt,
      dryRun: true,
    };
  }

  const publishResult = await publishPlayerEdition({
    sql,
    leagueSlug,
    listSlug,
    editionLabel,
    editionNumber,
    methodologyVersion: '1.0',
    params,
    notes: {
      scored_at_finals_count: snapAfter.finals,
      scored_at_event_count:  snapAfter.events,
      drift_iterations:       attempt,
      new_impact_calls:       newImpactCalls,
      auto_published_by:      'cron:publish-player-edition',
    },
    editorActionSummary: `Auto-publish via daily cron; ${snapAfter.finals} finals; ${newImpactCalls} new impact calls; ${attempt} drift iteration(s).`,
    entries: ranked,
    blurbs: [],                                  // <-- board only; no inline blurb writes
    voiceModelVersion: 'claude-sonnet-4-6-pp-mvp-v1',
  });

  // STEP 5: queue drafts (after entries exist, we need their new ids) -------
  const newEntries = await sql`
    SELECT id, player_id, rank
      FROM ranking_entries
     WHERE ranking_edition_id = ${publishResult.new_ed_id}
       AND rank <= ${TOP_N_BLURBS}
     ORDER BY rank
  `;
  const draftResults = [];
  for (const e of newEntries) {
    try {
      const r = await draftRankingRowBlurb({ rankingEntryId: e.id });
      draftResults.push({
        entry_id: e.id,
        rank:     e.rank,
        action:   r.ok ? 'drafted' : (r.skipped ? 'skipped' : 'error'),
        blurb_id: r.blurb_id ?? null,
        reason:   r.reason ?? null,
      });
    } catch (err) {
      draftResults.push({
        entry_id: e.id, rank: e.rank, action: 'error', error: String(err.message ?? err),
      });
    }
  }

  return {
    action: 'published',
    new_ed_id: publishResult.new_ed_id,
    edition_label: editionLabel,
    edition_number: editionNumber,
    entry_count: publishResult.entry_count,
    drafts_queued: draftResults.filter((r) => r.action === 'drafted').length,
    drafts_skipped: draftResults.filter((r) => r.action === 'skipped').length,
    drafts_errored: draftResults.filter((r) => r.action === 'error').length,
    draft_details: draftResults,
    new_impact_calls: newImpactCalls,
    drift_iterations: attempt,
    snap_before: snapBefore,
    snap_after: snapAfter,
    prior_edition_id: idem.priorEditionId,
    prior_edition_number: idem.priorEditionNumber,
    prior_finals_count: idem.priorFinalsCount,
    timing_ms: Date.now() - startedAt,
    dryRun: false,
  };
}
