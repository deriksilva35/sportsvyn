// lib/rankings/playerEditionRunner.js — Player Power edition publisher.
//
// Sibling to lib/rankings/editionRunner.js. The team-power runner stays
// untouched so the in-flight ed3 (post-MD2) path is stable; this runner
// handles the player-power list (Tournament MVP) which has different
// envelope shape, scorer, and entry-row semantics.
//
// MVP scope:
//   - INSERT a ranking_editions row for the player-power list.
//   - INSERT ranking_entries with entity_type='player', player_id set,
//     team_id NULL, score/rank/dims populated.
//   - The team-rubric dim columns (result/process/squad/coherence/momentum)
//     stay NULL on player rows; the player-rubric dim columns we use are
//     output_score (production) and impact_score. The schema also has
//     efficiency_score / availability_score / context_score reserved for
//     future use; left NULL for v1.0.
//   - Editorial blurbs (top-N) inserted with ranking_entry_id as the SOLE
//     discriminator (back-pointer is what lib/rankings.js joins on; team_id
//     NULL satisfies editorial_blurbs_check). Applies the ed2 lesson.
//   - Atomic is_current flip across editions of THIS list only (does not
//     touch team-power's is_current state).
//
// Caller flow:
//   1. publishPlayerEdition({ sql, leagueSlug, listSlug, editionLabel,
//      methodologyVersion, params, entries, blurbs })
//      where `entries` is the fully-resolved vetted board (production +
//      cached impact + composite already computed, ranks assigned) and
//      `blurbs` is the editor-approved top-N (already drafted and reviewed).
//   2. Caller guards PROD writes (live window, dry-run, explicit go).

import {
  computeProductionRaw, computeProductionScore, computeComposite, DEFAULT_PARAMS,
} from './playerPowerScorer.js';

// ============================================================================
// Atomic publish. Single multi-statement CTE then a flip statement.
// Mirrors the ed2 team-power publish pattern.
// ============================================================================
export async function publishPlayerEdition({
  sql,
  leagueSlug,
  listSlug = 'player-power',
  editionLabel,
  editionNumber,
  methodologyVersion = '1.0',
  params = DEFAULT_PARAMS,
  notes = {},
  editorActionSummary = '',
  entries,             // [{ player_id, rank, score, production_score, impact_score, prev_rank, prev_score, ... }]
  blurbs = [],         // [{ player_id, body }] for top-N entries (back-pointer applied)
  voiceModelVersion = 'claude-sonnet-4-6',
}) {
  // 1. Resolve list_id + current edition (for movement + is_current flip)
  const meta = await sql`
    SELECT rl.id AS list_id, lg.id AS league_id,
           (SELECT id FROM ranking_editions
             WHERE ranking_list_id = rl.id AND is_current = true LIMIT 1) AS current_ed_id
      FROM ranking_lists rl
      JOIN leagues lg ON lg.id = rl.league_id
     WHERE rl.slug = ${listSlug} AND lg.slug = ${leagueSlug}
  `;
  if (meta.length === 0) throw new Error(`list ${listSlug} not found for league ${leagueSlug}`);
  const { list_id, league_id, current_ed_id } = meta[0];

  // 2. Prepare the JSONB payloads
  const entriesJson = JSON.stringify(entries.map((e) => ({
    player_id:        e.player_id,
    rank:             e.rank,
    score:            e.score,
    prev_rank:        e.prev_rank ?? null,
    rank_mv:          e.rank_movement ?? null,
    prev_score:       e.prev_score ?? null,
    score_mv:         e.score_movement ?? null,
    mv_label:         e.movement_label ?? 'new',
    output_score:     e.production_score, // production lives in output_score
    impact_score:     e.impact_score,
  })));

  const blurbsJson = JSON.stringify(blurbs.map((b) => ({
    player_id: b.player_id,
    body:      b.body,
  })));

  const notesText = JSON.stringify({
    edition_label: editionLabel,
    methodology_version: methodologyVersion,
    params,
    matches_used: 'rolling',
    generated_at: new Date().toISOString(),
    ...notes,
  });

  // 3. Single atomic CTE: insert edition, insert blurbs with back-pointer,
  //    insert entries. The blurbs need ranking_entry_id which depends on
  //    new_entries -- so order is: new_ed -> new_entries -> new_blurbs.
  //    Set entries.blurb_id in a separate UPDATE post-CTE (since PG cannot
  //    modify ranking_entries twice in one statement). This matches ed2 b
  //    ack-pointer fix; for the player publish we only set the back-pointer
  //    (load-bearing for the page), not the forward FK.
  const inserted = await sql`
    WITH new_ed AS (
      INSERT INTO ranking_editions (
        ranking_list_id, edition_number, edition_label, methodology_version,
        editorial_weight, sites_weight, status, is_current,
        published_at, notes, editor_action_summary
      )
      VALUES (
        ${list_id}::int, ${editionNumber}::int, ${editionLabel}, ${methodologyVersion},
        ${params.w_production}::numeric, ${params.w_impact}::numeric,
        'published', false,
        now(), ${notesText}::text, ${editorActionSummary}::text
      )
      RETURNING id
    ),
    new_entries AS (
      INSERT INTO ranking_entries (
        ranking_edition_id, entity_type, player_id, team_id, rank, score,
        previous_rank, rank_movement, previous_score, score_movement, movement_label,
        output_score, impact_score
      )
      SELECT (SELECT id FROM new_ed), 'player',
             (e->>'player_id')::int, NULL,
             (e->>'rank')::int, (e->>'score')::numeric,
             NULLIF(e->>'prev_rank',  'null')::int,
             NULLIF(e->>'rank_mv',    'null')::int,
             NULLIF(e->>'prev_score', 'null')::numeric,
             NULLIF(e->>'score_mv',   'null')::numeric,
             e->>'mv_label',
             (e->>'output_score')::numeric,
             (e->>'impact_score')::numeric
        FROM jsonb_array_elements(${entriesJson}::jsonb) AS e
      RETURNING id, player_id
    ),
    new_blurbs AS (
      INSERT INTO editorial_blurbs (
        blurb_type, ranking_entry_id, body, approved_against_fingerprint,
        voice_model_version, generated_at, generation_tier, status,
        reviewed_at, reviewed_by, published_at, is_current, auto_published
      )
      SELECT 'ranking_row_blurb', ne.id, b->>'body',
             (
               SELECT count(*)::int
                 FROM match_events me
                 JOIN matches m ON m.id = me.match_id
                WHERE m.league_id = ${league_id}::int
                  AND me.is_current = true
                  AND (
                    me.player_api_id  = (p.external_ids->>'api_sports')::int
                    OR me.assist_api_id = (p.external_ids->>'api_sports')::int
                  )
             ),
             ${voiceModelVersion}::text, now(), 'manual', 'editor_approved',
             now(), 'Derik Silva', now(), true, false
        FROM jsonb_array_elements(${blurbsJson}::jsonb) AS b
        JOIN new_entries ne ON ne.player_id = (b->>'player_id')::int
        JOIN players p ON p.id = ne.player_id
      RETURNING id
    )
    SELECT
      (SELECT id FROM new_ed)                  AS new_ed_id,
      (SELECT count(*)::int FROM new_entries)  AS entry_count,
      (SELECT count(*)::int FROM new_blurbs)   AS blurb_count
  `;
  const { new_ed_id, entry_count, blurb_count } = inserted[0];

  // 4. Atomic is_current flip (this list only). If there's no prior current,
  //    just set the new one. Otherwise CASE-flip both in one statement.
  if (current_ed_id == null) {
    await sql`UPDATE ranking_editions SET is_current = true WHERE id = ${new_ed_id}`;
  } else {
    await sql`
      UPDATE ranking_editions
         SET is_current = CASE id
                            WHEN ${current_ed_id}::int THEN false
                            WHEN ${new_ed_id}::int     THEN true
                          END,
             updated_at = now()
       WHERE id IN (${current_ed_id}::int, ${new_ed_id}::int)
    `;
  }

  return { new_ed_id, entry_count, blurb_count, prior_ed_id: current_ed_id };
}

// ============================================================================
// Helpers for the runner caller (composing the vetted board into the
// payload shape publishPlayerEdition expects).
// ============================================================================
// Deterministic tiebreak chain: composite -> production_score -> impact_score
// -> production_raw -> open-goal+pen+assist sum -> player_id ASC (final breaker).
// Required so the entry ranks and blurb attachments resolve to the same
// physical row across re-runs.
export function rankAndAssignMovement({ players, priorByPlayerId = new Map() }) {
  const goalLikeCount = (p) => (p.open_play_goals ?? 0) + (p.penalty_goals ?? 0) + (p.assists ?? 0);
  const sorted = players.slice().sort((a, b) =>
    (b.composite        - a.composite)        ||
    (b.production_score - a.production_score) ||
    (b.impact_score     - a.impact_score)     ||
    (b.production_raw   - a.production_raw)   ||
    (goalLikeCount(b)   - goalLikeCount(a))   ||
    (a.player_id        - b.player_id)
  );
  sorted.forEach((p, i) => { p.rank = i + 1; });
  for (const p of sorted) {
    const prior = priorByPlayerId.get(p.player_id);
    if (!prior) {
      p.prev_rank = null;
      p.prev_score = null;
      p.rank_movement = null;
      p.score_movement = null;
      p.movement_label = 'new';
    } else {
      p.prev_rank = prior.rank;
      p.prev_score = prior.score;
      p.rank_movement = prior.rank - p.rank;
      p.score_movement = Math.floor((p.composite - prior.score) * 100 + 0.5) / 100;
      p.movement_label = p.rank_movement > 0 ? 'up' : p.rank_movement < 0 ? 'down' : 'hold';
    }
    p.score = p.composite;
  }
  return sorted;
}
