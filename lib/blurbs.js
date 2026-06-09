/**
 * lib/blurbs.js — editorial_blurbs table I/O.
 *
 * General across all blurb_type values (team_outlook, player_outlook,
 * ranking_row_blurb, stats_framing). The generator that fills the
 * queue is narrow per type (Piece 2+ adds team_outlook first); this
 * file is the reusable plumbing underneath.
 *
 * Editorial-gate contract:
 *   · Inserts land as status='pending_review', is_current=false.
 *   · publishBlurb is the ONLY path to is_current=true. It demotes
 *     any prior current row for the same entity+type to 'superseded'
 *     in the same transaction, so the partial UNIQUE index
 *     idx_editorial_blurbs_*_one_current is never violated.
 *   · Auto-publish (24h fallback per spec §18.1) is NOT implemented.
 *     Editor approval is mandatory — same call as the Daily Card.
 *
 * Reads degrade safely (null / [] on no-data, never throw) so the
 * Team page / homepage can render without a blurb.
 */

import { sql } from './db.js';

function pickEntity(row) {
  if (row.team_id != null)          return { kind: 'team',          col: 'team_id',          id: row.team_id };
  if (row.player_id != null)        return { kind: 'player',        col: 'player_id',        id: row.player_id };
  if (row.ranking_entry_id != null) return { kind: 'ranking_entry', col: 'ranking_entry_id', id: row.ranking_entry_id };
  if (row.league_id != null)        return { kind: 'league',        col: 'league_id',        id: row.league_id };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────────

/**
 * getPendingBlurbs({ blurbType }) — pending_review rows joined to whichever
 * entity owns them. Optional blurbType filter. Returns [] if empty.
 *
 * The polymorphic entity ref (team_id / player_id / ranking_entry_id /
 * league_id) is resolved via LEFT JOIN across all four targets; the table's
 * CHECK constraint guarantees exactly one is non-null, so COALESCE collapses
 * to a single name + slug.
 */
export async function getPendingBlurbs({ blurbType = null } = {}) {
  const rows = blurbType
    ? await sql`
        SELECT b.*,
               CASE
                 WHEN b.team_id          IS NOT NULL THEN 'team'
                 WHEN b.player_id        IS NOT NULL THEN 'player'
                 WHEN b.ranking_entry_id IS NOT NULL THEN 'ranking_entry'
                 WHEN b.league_id        IS NOT NULL THEN 'league'
               END AS entity_kind,
               COALESCE(t.name, p.full_name, re_t.name, re_p.full_name, l.name) AS entity_name,
               COALESCE(t.slug, p.slug,      re_t.slug, re_p.slug,      l.slug) AS entity_slug
          FROM editorial_blurbs b
          LEFT JOIN teams           t    ON t.id   = b.team_id
          LEFT JOIN players         p    ON p.id   = b.player_id
          LEFT JOIN ranking_entries re   ON re.id  = b.ranking_entry_id
          LEFT JOIN teams           re_t ON re_t.id = re.team_id
          LEFT JOIN players         re_p ON re_p.id = re.player_id
          LEFT JOIN leagues         l    ON l.id   = b.league_id
         WHERE b.status = 'pending_review' AND b.blurb_type = ${blurbType}
         ORDER BY b.generated_at DESC
      `
    : await sql`
        SELECT b.*,
               CASE
                 WHEN b.team_id          IS NOT NULL THEN 'team'
                 WHEN b.player_id        IS NOT NULL THEN 'player'
                 WHEN b.ranking_entry_id IS NOT NULL THEN 'ranking_entry'
                 WHEN b.league_id        IS NOT NULL THEN 'league'
               END AS entity_kind,
               COALESCE(t.name, p.full_name, re_t.name, re_p.full_name, l.name) AS entity_name,
               COALESCE(t.slug, p.slug,      re_t.slug, re_p.slug,      l.slug) AS entity_slug
          FROM editorial_blurbs b
          LEFT JOIN teams           t    ON t.id   = b.team_id
          LEFT JOIN players         p    ON p.id   = b.player_id
          LEFT JOIN ranking_entries re   ON re.id  = b.ranking_entry_id
          LEFT JOIN teams           re_t ON re_t.id = re.team_id
          LEFT JOIN players         re_p ON re_p.id = re.player_id
          LEFT JOIN leagues         l    ON l.id   = b.league_id
         WHERE b.status = 'pending_review'
         ORDER BY b.generated_at DESC
      `;
  return rows ?? [];
}

/**
 * getCurrentBlurb({ blurbType, teamId?, playerId?, rankingEntryId?, leagueId? })
 * Returns the single editor_approved + is_current=true row for the entity+type,
 * or null. Editor-gate-only: auto_published rows are NOT returned (spec §18.1
 * deferred — see file header).
 */
export async function getCurrentBlurb({ blurbType, teamId, playerId, rankingEntryId, leagueId } = {}) {
  if (!blurbType) return null;
  let rows;
  if (teamId != null) {
    rows = await sql`
      SELECT * FROM editorial_blurbs
       WHERE blurb_type = ${blurbType} AND team_id = ${teamId}
         AND is_current = true AND status = 'editor_approved'
       LIMIT 1
    `;
  } else if (playerId != null) {
    rows = await sql`
      SELECT * FROM editorial_blurbs
       WHERE blurb_type = ${blurbType} AND player_id = ${playerId}
         AND is_current = true AND status = 'editor_approved'
       LIMIT 1
    `;
  } else if (rankingEntryId != null) {
    rows = await sql`
      SELECT * FROM editorial_blurbs
       WHERE blurb_type = ${blurbType} AND ranking_entry_id = ${rankingEntryId}
         AND is_current = true AND status = 'editor_approved'
       LIMIT 1
    `;
  } else if (leagueId != null) {
    rows = await sql`
      SELECT * FROM editorial_blurbs
       WHERE blurb_type = ${blurbType} AND league_id = ${leagueId}
         AND is_current = true AND status = 'editor_approved'
       LIMIT 1
    `;
  } else {
    return null;
  }
  return rows?.[0] ?? null;
}

/**
 * getRecentlyReviewed({ limit }) — tail of recent decisions for the queue.
 */
export async function getRecentlyReviewed({ limit = 10 } = {}) {
  const rows = await sql`
    SELECT b.*,
           CASE
             WHEN b.team_id          IS NOT NULL THEN 'team'
             WHEN b.player_id        IS NOT NULL THEN 'player'
             WHEN b.ranking_entry_id IS NOT NULL THEN 'ranking_entry'
             WHEN b.league_id        IS NOT NULL THEN 'league'
           END AS entity_kind,
           COALESCE(t.name, p.full_name, re_t.name, re_p.full_name, l.name) AS entity_name,
           COALESCE(t.slug, p.slug,      re_t.slug, re_p.slug,      l.slug) AS entity_slug
      FROM editorial_blurbs b
      LEFT JOIN teams           t    ON t.id   = b.team_id
      LEFT JOIN players         p    ON p.id   = b.player_id
      LEFT JOIN ranking_entries re   ON re.id  = b.ranking_entry_id
      LEFT JOIN teams           re_t ON re_t.id = re.team_id
      LEFT JOIN players         re_p ON re_p.id = re.player_id
      LEFT JOIN leagues         l    ON l.id   = b.league_id
     WHERE b.status IN ('editor_approved','rejected','superseded')
     ORDER BY COALESCE(b.reviewed_at, b.published_at, b.generated_at) DESC
     LIMIT ${limit}
  `;
  return rows ?? [];
}

// ─────────────────────────────────────────────────────────────────────────
// WRITES
// ─────────────────────────────────────────────────────────────────────────

/**
 * insertPendingBlurb — Piece-2+ generator calls this. Lands at
 * status='pending_review', is_current=false. Caller passes the
 * polymorphic entity as { kind: 'team'|'player'|'ranking_entry'|'league', id }.
 * Returns the inserted row.
 */
export async function insertPendingBlurb({
  blurbType,
  entityRef,
  body,
  generationInput = null,
  voiceModelVersion = '1.0',
  generationTier = 'tier_2_draft',
  promptTemplateId = null,
}) {
  if (!blurbType) throw new Error('blurbType required');
  if (!entityRef || !entityRef.kind || entityRef.id == null) throw new Error('entityRef { kind, id } required');
  if (!body || !body.trim()) throw new Error('body required');

  const teamId          = entityRef.kind === 'team'          ? entityRef.id : null;
  const playerId        = entityRef.kind === 'player'        ? entityRef.id : null;
  const rankingEntryId  = entityRef.kind === 'ranking_entry' ? entityRef.id : null;
  const leagueId        = entityRef.kind === 'league'        ? entityRef.id : null;

  if (teamId == null && playerId == null && rankingEntryId == null && leagueId == null) {
    throw new Error('entityRef.kind must be one of: team, player, ranking_entry, league');
  }

  const inserted = await sql`
    INSERT INTO editorial_blurbs (
      blurb_type, team_id, player_id, ranking_entry_id, league_id,
      body, voice_model_version, generation_tier, prompt_template_id, generation_input,
      status, is_current, auto_published
    ) VALUES (
      ${blurbType}, ${teamId}, ${playerId}, ${rankingEntryId}, ${leagueId},
      ${body}, ${voiceModelVersion}, ${generationTier}, ${promptTemplateId},
      ${generationInput ? JSON.stringify(generationInput) : null}::jsonb,
      'pending_review', false, false
    )
    RETURNING *
  `;
  return inserted[0];
}

/**
 * publishBlurb({ id, reviewedBy }) — the editor gate. Demotes the existing
 * current row for the same entity+blurb_type (if any) to is_current=false +
 * status='superseded', then promotes the target row to is_current=true +
 * status='editor_approved' with supersedes_id pointing at the demoted one.
 *
 * Done in a single transaction (sql.transaction([])) so the partial UNIQUE
 * index `idx_editorial_blurbs_*_one_current` never sees two rows with
 * is_current=true at the same time.
 *
 * Returns the new current row, or null if the target wasn't in pending_review.
 */
export async function publishBlurb({ id, reviewedBy }) {
  if (id == null) throw new Error('id required');
  if (!reviewedBy) reviewedBy = 'admin';

  // Read the target so we know which entity column carries its identity.
  const targetRows = await sql`
    SELECT id, blurb_type, team_id, player_id, ranking_entry_id, league_id
      FROM editorial_blurbs
     WHERE id = ${id} AND status = 'pending_review'
  `;
  if (targetRows.length === 0) return null;
  const target = targetRows[0];
  const entity = pickEntity(target);
  if (!entity) throw new Error('target row has no entity FK set');

  // Find an existing current row for the same entity+blurb_type. At most
  // one exists for team/player/ranking_entry (partial UNIQUE index); league
  // has no such index but we still single-out the latest if any.
  let demotedId = null;
  if (entity.col === 'team_id') {
    const r = await sql`SELECT id FROM editorial_blurbs WHERE blurb_type = ${target.blurb_type} AND team_id = ${entity.id} AND is_current = true LIMIT 1`;
    demotedId = r[0]?.id ?? null;
  } else if (entity.col === 'player_id') {
    const r = await sql`SELECT id FROM editorial_blurbs WHERE blurb_type = ${target.blurb_type} AND player_id = ${entity.id} AND is_current = true LIMIT 1`;
    demotedId = r[0]?.id ?? null;
  } else if (entity.col === 'ranking_entry_id') {
    const r = await sql`SELECT id FROM editorial_blurbs WHERE blurb_type = ${target.blurb_type} AND ranking_entry_id = ${entity.id} AND is_current = true LIMIT 1`;
    demotedId = r[0]?.id ?? null;
  } else if (entity.col === 'league_id') {
    const r = await sql`SELECT id FROM editorial_blurbs WHERE blurb_type = ${target.blurb_type} AND league_id = ${entity.id} AND is_current = true ORDER BY published_at DESC NULLS LAST LIMIT 1`;
    demotedId = r[0]?.id ?? null;
  }

  // Atomic demote-then-promote. If demotedId is null, the first statement
  // matches zero rows (no-op) and the second still promotes.
  await sql.transaction([
    sql`
      UPDATE editorial_blurbs
         SET is_current = false,
             status     = 'superseded',
             updated_at = now()
       WHERE id = ${demotedId}
    `,
    sql`
      UPDATE editorial_blurbs
         SET status         = 'editor_approved',
             is_current     = true,
             auto_published = false,
             published_at   = COALESCE(published_at, now()),
             reviewed_at    = now(),
             reviewed_by    = ${reviewedBy},
             supersedes_id  = ${demotedId},
             updated_at     = now()
       WHERE id = ${id} AND status = 'pending_review'
    `,
  ]);

  const updated = await sql`SELECT * FROM editorial_blurbs WHERE id = ${id}`;
  return updated[0] ?? null;
}

/**
 * rejectBlurb({ id, reviewedBy, notes }) — status='rejected'. Returns the
 * updated row or null if not pending.
 */
export async function rejectBlurb({ id, reviewedBy, notes = null }) {
  if (id == null) throw new Error('id required');
  if (!reviewedBy) reviewedBy = 'admin';
  const r = await sql`
    UPDATE editorial_blurbs
       SET status       = 'rejected',
           reviewed_at  = now(),
           reviewed_by  = ${reviewedBy},
           editor_notes = COALESCE(${notes}, editor_notes),
           updated_at   = now()
     WHERE id = ${id} AND status = 'pending_review'
     RETURNING *
  `;
  return r[0] ?? null;
}
