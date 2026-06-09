// lib/rankings/editionRunner.js — produces one ranking_edition for a list.
//
// Composes the proven pieces:
//   · lib/rankings/teamPowerScorer.js  — 5-dim editorial scorer
//   · lib/rankings/sitesLayer.js       — power-curve rank → score + 50/50 blend
//
// Steps the runner takes for a single edition:
//   1. ensureRankingList({slug, ...})         — find or create the list row
//   2. ensureDraftEdition(list_id, weights)   — find existing DRAFT or create
//      new one. If a draft already exists, clear its entries and re-use the
//      same edition (idempotent — re-running the runner on a draft replaces
//      its entries rather than duplicating).
//   3. For each team in the list's league:
//        · sitesScores from buildPlaceholderSitesRanks(teams)
//        · editorial via runTeamPowerScorer({teamId, phase})
//        · outer score = editorialWeight * editorial + sitesWeight * sites
//   4. Rank by outer score DESC. Compute movement vs prior is_current
//      edition (if any); edition 1 → all rows get movement_label='new'.
//   5. Bulk insert ranking_entries with all dim columns + sites columns +
//      composite + movement.
//
// This runner does NOT publish. It writes status='draft', is_current=false
// regardless of whether a prior is_current exists. Publishing is a
// separate step (a future admin action) that flips status='published',
// sets is_current=true (transactionally swapping with the prior current).
//
// CALLERS must host-guard if they want to refuse PROD writes — this
// module does not guard, it just executes the runner against whatever
// DB the caller's environment points at.

import { sql } from '../db.js';
import { runTeamPowerScorer } from './teamPowerScorer.js';
import { normalizeRankToScore, sitesComposite, buildSitesRanksFromSeed } from './sitesLayer.js';

// =============================================================================
// Retry-then-review wrapper around runTeamPowerScorer.
//
// runTeamPowerScorer returns { ok, parsed, validation, ... }:
//   - ok=false  → Anthropic / JSON-parse failure (TRANSPORT error)
//   - ok=true + validation.ok=true   → genuine success
//   - ok=true + validation.ok=false  → CONTENT validation failure (the
//                                       silent gap defect we're closing)
//
// Contract per spec:
//   1. If first attempt fails validation, RETRY ONCE.
//   2. If retry passes → use retry, label 'passed_on_retry'.
//   3. If retry still fails → use retry's data, label 'routed_to_review'.
//      Write the entry (do NOT drop the team) and surface the failure to
//      the edition's notes JSON + flag the entry with movement_label.
//   4. Transport errors get retried once too, then surfaced as
//      'transport_error' (the entry is skipped — no parsed data to write).
// =============================================================================
export async function scoreTeamWithRetry({ teamId, team_name, phase, scorerFn = runTeamPowerScorer }) {
  const first = await scorerFn({ teamId, phase });

  // First-call transport error → retry once for transport, then either
  // pass through as transport_error or evaluate validation.
  if (!first.ok) {
    const retry = await scorerFn({ teamId, phase });
    if (!retry.ok) {
      return {
        attempts: 2,
        outcome: 'transport_error',
        result: retry,
        team_id: teamId,
        team_name,
      };
    }
    // Retry's transport succeeded — fall through to validation check.
    if (retry.validation.ok) {
      return {
        attempts: 2,
        outcome: 'passed_on_retry',
        result: retry,
        team_id: teamId,
        team_name,
      };
    }
    return {
      attempts: 2,
      outcome: 'routed_to_review',
      result: retry,
      first_result: { transport_error: first.error },
      team_id: teamId,
      team_name,
      failed_dims: identifyFailedDims(retry.validation.issues),
      issues: retry.validation.issues,
    };
  }

  // First-call transport succeeded — evaluate content validation.
  if (first.validation.ok) {
    return {
      attempts: 1,
      outcome: 'passed_first_try',
      result: first,
      team_id: teamId,
      team_name,
    };
  }

  // Content validation failed on first attempt — retry the scorer once.
  // Content gaps from Anthropic are often transient (whitespace, dropped
  // field, truncation) and a fresh call usually returns clean content.
  const retry = await scorerFn({ teamId, phase });
  if (!retry.ok) {
    // Retry transport failure — route to review with the FIRST result's
    // data (since it's the only thing parsed). Caller writes the entry
    // with the first attempt's scores and flags it.
    return {
      attempts: 2,
      outcome: 'routed_to_review',
      result: first,
      first_result: first,
      team_id: teamId,
      team_name,
      failed_dims: identifyFailedDims(first.validation.issues),
      issues: first.validation.issues,
      retry_transport_error: retry.error,
    };
  }
  if (retry.validation.ok) {
    return {
      attempts: 2,
      outcome: 'passed_on_retry',
      result: retry,
      first_failed_issues: first.validation.issues,
      team_id: teamId,
      team_name,
    };
  }
  // Both attempts failed content validation — route to review with the
  // retry's data (more recent) and record both attempts' failed dims.
  return {
    attempts: 2,
    outcome: 'routed_to_review',
    result: retry,
    first_result: first,
    team_id: teamId,
    team_name,
    failed_dims: identifyFailedDims(retry.validation.issues),
    failed_dims_first: identifyFailedDims(first.validation.issues),
    issues: retry.validation.issues,
    issues_first: first.validation.issues,
  };
}

// Extract dimension names from validator-issue strings. The validator
// emits issues like "coherence (scored) — justification missing or too
// short" or "result (held) — score must be null" — we scan the start
// of each issue for the canonical dim name.
function identifyFailedDims(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return [];
  const DIM_NAMES = ['result', 'process', 'squad', 'coherence', 'momentum'];
  const set = new Set();
  for (const issue of issues) {
    for (const d of DIM_NAMES) {
      // Match dim at start of issue OR in the leading clause before the em-dash.
      // Validator forms:
      //   "{d} (scored) — ..."
      //   "{d} (held) — ..."
      //   "{d} justification too long (...)"
      //   "pre_tournament — {d} must be ..."
      if (issue.startsWith(d + ' ') || issue.includes(`— ${d} must be `)) {
        set.add(d);
      }
    }
  }
  return Array.from(set);
}

// =============================================================================
// 1) ranking_list — idempotent ensure.
// =============================================================================
export async function ensureRankingList({
  slug = 'team-power',
  name = 'Team Power Rankings',
  league_slug = 'fifa-wc-2026',
  description = 'Editorial Team Power composite (5-dim editorial + FIFA/ESPN sites layer).',
}) {
  const leagueRows = await sql`SELECT id FROM leagues WHERE slug = ${league_slug} LIMIT 1`;
  if (leagueRows.length === 0) throw new Error(`league not found: ${league_slug}`);
  const league_id = leagueRows[0].id;

  const existing = await sql`SELECT id FROM ranking_lists WHERE slug = ${slug} AND league_id = ${league_id} LIMIT 1`;
  if (existing.length > 0) return { id: existing[0].id, created: false };

  const inserted = await sql`
    INSERT INTO ranking_lists (
      slug, name, description, league_id,
      entity_type, list_type, composite_type,
      sort_direction, display_limit, is_active, display_order
    ) VALUES (
      ${slug}, ${name}, ${description}, ${league_id},
      'team', 'composite', 'team_power',
      'desc', 48, true, 0
    )
    RETURNING id
  `;
  return { id: inserted[0].id, created: true };
}

// =============================================================================
// 2) ranking_edition — find existing DRAFT or create new (idempotent).
// =============================================================================
export async function ensureDraftEdition({
  ranking_list_id,
  edition_label = 'Pre-tournament',
  methodology_version = '1.0',
  editorial_weight = 0.70,
  sites_weight = 0.30,
}) {
  // If there's already an open draft for this list, re-use it (and clear
  // entries below). This keeps re-runs idempotent.
  const existingDraft = await sql`
    SELECT id, edition_number FROM ranking_editions
     WHERE ranking_list_id = ${ranking_list_id} AND status = 'draft'
     ORDER BY edition_number DESC
     LIMIT 1
  `;
  if (existingDraft.length > 0) {
    await sql`DELETE FROM ranking_entries WHERE ranking_edition_id = ${existingDraft[0].id}`;
    return { id: existingDraft[0].id, edition_number: existingDraft[0].edition_number, reused: true };
  }

  const maxRow = await sql`
    SELECT COALESCE(MAX(edition_number), 0) AS max_n
      FROM ranking_editions WHERE ranking_list_id = ${ranking_list_id}
  `;
  const next_n = Number(maxRow[0].max_n) + 1;

  const inserted = await sql`
    INSERT INTO ranking_editions (
      ranking_list_id, edition_number, edition_label,
      methodology_version, editorial_weight, sites_weight, user_weight,
      status, is_current
    ) VALUES (
      ${ranking_list_id}, ${next_n}, ${edition_label},
      ${methodology_version}, ${editorial_weight}, ${sites_weight}, 0.0,
      'draft', false
    )
    RETURNING id, edition_number
  `;
  return { id: inserted[0].id, edition_number: inserted[0].edition_number, reused: false };
}

// =============================================================================
// 3) Sites layer — placeholder ranks (DEV fallback).
//
// Returns a Map<team_id, { fifa_rank, fifa_score, espn_rank, espn_score,
// athletic_rank, athletic_score, sites_composite }>. Uses alphabetical rank
// as a CLEARLY-PLACEHOLDER signal across all three sources — replace with
// real seed via buildSitesRanksFromSeed before any publish.
// =============================================================================
export function buildPlaceholderSitesRanks(teams) {
  const sorted = teams.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  const N = sorted.length;
  const out = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const rank = i + 1;
    const fifa_score = normalizeRankToScore(rank, N);
    const espn_score = normalizeRankToScore(rank, N);
    const athletic_score = normalizeRankToScore(rank, N);
    out.set(sorted[i].id, {
      fifa_rank: rank,
      espn_rank: rank,
      athletic_rank: rank,
      fifa_score,
      espn_score,
      athletic_score,
      sites_composite: sitesComposite({ fifa_score, espn_score, athletic_score }),
    });
  }
  return out;
}

// =============================================================================
// 4) Compose outer score per entry.
//
// outer = editorialWeight * editorial_composite + sitesWeight * sites_composite
//
// Returns an array of composed entries sorted desc by outer score.
// =============================================================================
export function composeOuterScores({ scorerResults, sitesMap, editorial_weight, sites_weight }) {
  const composed = [];
  for (const r of scorerResults) {
    if (!r.ok || r.editorial_composite == null) continue;
    const sites = sitesMap.get(r.teamId);
    const editorial = r.editorial_composite;
    const sitesScore = sites?.sites_composite ?? null;

    // Outer formula. When sites is null (e.g., a team without a real
    // rank in either source), fall back to editorial-only (the cleanest
    // honest behavior — don't fabricate the sites layer).
    const outer = sitesScore != null
      ? editorial_weight * editorial + sites_weight * sitesScore
      : editorial;

    composed.push({
      teamId: r.teamId,
      team_name: r.team_name,
      editorial_composite: editorial,
      dims: r.parsed.dims,
      scored_dims: r.parsed.scored_dims,
      held_dims: r.parsed.held_dims,
      justifications: r.parsed.justifications,
      reasoning: r.parsed.reasoning,
      sites: sites ?? null,
      score: round2(outer),
    });
  }
  composed.sort((a, b) => b.score - a.score);
  return composed;
}

// =============================================================================
// 5) Movement vs prior is_current edition for the same ranking_list.
// =============================================================================
async function loadPriorRankMap(ranking_list_id) {
  const prior = await sql`
    SELECT e.id AS edition_id
      FROM ranking_editions e
     WHERE e.ranking_list_id = ${ranking_list_id} AND e.is_current = true
     LIMIT 1
  `;
  if (prior.length === 0) return null; // no prior edition → all 'new'

  const rows = await sql`
    SELECT team_id, rank, score FROM ranking_entries
     WHERE ranking_edition_id = ${prior[0].edition_id}
  `;
  const map = new Map();
  for (const r of rows) map.set(r.team_id, { rank: r.rank, score: Number(r.score) });
  return map;
}

function movementForEntry({ priorMap, teamId, newRank, newScore }) {
  if (!priorMap) {
    return {
      previous_rank: null,
      rank_movement: null,
      previous_score: null,
      score_movement: null,
      movement_label: 'new',
    };
  }
  const prior = priorMap.get(teamId);
  if (!prior) {
    return {
      previous_rank: null,
      rank_movement: null,
      previous_score: null,
      score_movement: null,
      movement_label: 'new',
    };
  }
  // rank_movement: positive = improved (#5 → #3 is +2)
  const rank_movement = prior.rank - newRank;
  const score_movement = round2(newScore - prior.score);
  let movement_label;
  if (rank_movement > 0) movement_label = 'up';
  else if (rank_movement < 0) movement_label = 'down';
  else movement_label = 'hold';
  return {
    previous_rank: prior.rank,
    rank_movement,
    previous_score: prior.score,
    score_movement,
    movement_label,
  };
}

// =============================================================================
// Top-level runner.
// =============================================================================
export async function runRankingEdition({
  list_slug = 'team-power',
  league_slug = 'fifa-wc-2026',
  edition_label = 'Pre-tournament',
  editorial_weight = 0.70,
  sites_weight = 0.30,
  phase = 'pre_tournament',
  list_name = 'Team Power Rankings',
  sitesSeed = null,  // [{ team_id, fifa_rank_global, espn_rank, athletic_rank }, ...] or null
} = {}) {
  // 1) list + edition
  const list = await ensureRankingList({ slug: list_slug, name: list_name, league_slug });
  const edition = await ensureDraftEdition({
    ranking_list_id: list.id,
    edition_label,
    editorial_weight,
    sites_weight,
  });

  // 2) load teams (one row per WC team)
  const teams = await sql`
    SELECT t.id, t.name, t.abbreviation, t.external_ids->>'api_sports' AS api_sports_id
      FROM teams t
      JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = ${league_slug}
     ORDER BY t.name
  `;
  if (teams.length === 0) throw new Error(`no teams found for league ${league_slug}`);

  // 3) Build sites ranks — real seed if provided, placeholder otherwise.
  const sitesMap = sitesSeed
    ? buildSitesRanksFromSeed(teams, sitesSeed, teams.length)
    : buildPlaceholderSitesRanks(teams);

  // 4) Score each team — retry-then-review contract.
  //    runTeamPowerScorer returns transport-ok results that may still fail
  //    content validation. The wrapper enforces validation by retrying once
  //    and, on persistent failure, routing the entry to a review queue
  //    (writes the entry but flags it via movement_label + edition notes).
  const counters = {
    passed_first_try: 0,
    passed_on_retry: 0,
    routed_to_review: 0,
    transport_error: 0,
  };
  const needsReview = [];          // captured for the edition's notes blob
  const transportErrors = [];      // teams skipped entirely
  const scorerResults = [];

  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    const w = await scoreTeamWithRetry({ teamId: t.id, team_name: t.name, phase });
    counters[w.outcome] += 1;

    if (w.outcome === 'transport_error') {
      transportErrors.push({ team_id: t.id, team_name: t.name, error: w.result?.error });
      // No parsed result — cannot write an entry for this team. Logged
      // and skipped. (Caller decides whether to backfill manually.)
      continue;
    }

    // For passed_first_try / passed_on_retry / routed_to_review we have
    // a parsed result and an editorial_composite — pass into composer.
    scorerResults.push({ ...w.result, teamId: t.id, team_name: t.name });

    if (w.outcome === 'routed_to_review') {
      // Capture the raw justification text (whatever the model returned —
      // empty string / whitespace / short / etc.) so the editor can see
      // exactly what failed and fix it in one place.
      const raw = w.result?.parsed?.justifications ?? {};
      const rawSnap = {};
      for (const d of w.failed_dims) {
        rawSnap[d] = raw[d] ?? null;
      }
      needsReview.push({
        team_id: t.id,
        team_name: t.name,
        attempts: w.attempts,
        failed_dims: w.failed_dims,
        failed_dims_first: w.failed_dims_first ?? null,
        issues: w.issues,
        issues_first: w.issues_first ?? null,
        raw_justifications_for_failed_dims: rawSnap,
      });
    }
  }

  // 5) Compose outer + sort desc. (Only scorerResults that survived the
  //    transport-error filter are passed through.)
  const composed = composeOuterScores({
    scorerResults,
    sitesMap,
    editorial_weight,
    sites_weight,
  });
  const needsReviewIds = new Set(needsReview.map((nr) => nr.team_id));

  // 6) Movement vs prior is_current edition (if any).
  const priorMap = await loadPriorRankMap(list.id);

  // 7) Write entries — fresh insert per row (entries were cleared on
  //    ensureDraftEdition when a draft was reused).
  //
  // movement_label overload for routed-to-review entries: the rank-
  // movement label is replaced with 'needs_review' so a future review
  // queue can find these via a simple WHERE filter:
  //     SELECT * FROM ranking_entries WHERE movement_label = 'needs_review'
  // The full detail (failed dims, raw justification text, all validator
  // issues) lives on ranking_editions.notes as a JSON blob so the queue
  // page can render per-entry context without re-running the scorer.
  const writtenEntries = [];
  for (let i = 0; i < composed.length; i++) {
    const c = composed[i];
    const newRank = i + 1;
    const mv = movementForEntry({
      priorMap,
      teamId: c.teamId,
      newRank,
      newScore: c.score,
    });
    const finalMovementLabel = needsReviewIds.has(c.teamId)
      ? 'needs_review'
      : mv.movement_label;
    const inserted = await sql`
      INSERT INTO ranking_entries (
        ranking_edition_id, entity_type, team_id,
        rank, score,
        previous_rank, rank_movement, previous_score, score_movement, movement_label,
        result_score, process_score, squad_score, coherence_score, momentum_score,
        fifa_rank, fifa_score, espn_rank, espn_score, sites_composite, editorial_composite,
        athletic_rank, athletic_score
      ) VALUES (
        ${edition.id}, 'team', ${c.teamId},
        ${newRank}, ${c.score},
        ${mv.previous_rank}, ${mv.rank_movement}, ${mv.previous_score}, ${mv.score_movement}, ${finalMovementLabel},
        ${c.dims?.result ?? null},
        ${c.dims?.process ?? null},
        ${c.dims?.squad ?? null},
        ${c.dims?.coherence ?? null},
        ${c.dims?.momentum ?? null},
        ${c.sites?.fifa_rank ?? null},
        ${c.sites?.fifa_score ?? null},
        ${c.sites?.espn_rank ?? null},
        ${c.sites?.espn_score ?? null},
        ${c.sites?.sites_composite ?? null},
        ${c.editorial_composite},
        ${c.sites?.athletic_rank ?? null},
        ${c.sites?.athletic_score ?? null}
      )
      RETURNING id
    `;
    writtenEntries.push({
      entry_id: inserted[0].id,
      team_id: c.teamId,
      team_name: c.team_name,
      rank: newRank,
      score: c.score,
      editorial_composite: c.editorial_composite,
      sites_composite: c.sites?.sites_composite ?? null,
      dims: c.dims,
      justifications: c.justifications,
      reasoning: c.reasoning,
      movement_label: finalMovementLabel,
      needs_review: needsReviewIds.has(c.teamId),
    });
  }

  // 8) Persist needs_review JSON + sites provenance to the edition's
  //    notes field. This is the queryable backend for the (deferred)
  //    review-queue UI and the audit trail for which sources fed the
  //    sites layer.
  const sitesProvenance = sitesSeed
    ? {
        source: 'three_source_blend',
        fifa_global_ranks: Object.fromEntries(
          [...sitesMap.entries()].map(([team_id, sites]) => [team_id, sites.fifa_rank_global ?? null]),
        ),
      }
    : { source: 'placeholder_alphabetical' };

  const notesBlob = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    counters: { ...counters, transport_errors: transportErrors.length, total_teams: teams.length },
    needs_review: needsReview,
    transport_errors: transportErrors,
    sites_provenance: sitesProvenance,
  };
  await sql`
    UPDATE ranking_editions
       SET notes = ${JSON.stringify(notesBlob)},
           updated_at = now()
     WHERE id = ${edition.id}
  `;

  return {
    ranking_list_id: list.id,
    edition_id: edition.id,
    edition_number: edition.edition_number,
    edition_reused_draft: edition.reused,
    entries_written: writtenEntries.length,
    entries: writtenEntries,
    counters,
    needs_review: needsReview,
    transport_errors: transportErrors,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}
