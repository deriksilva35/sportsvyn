// lib/rankings.js — read helpers for the rankings system.
//
// Read-only. Two functions only — the homepage Power-5 rail consumes
// both; the /power-rankings page surface leans on the same shape.
//
// Naming + return-shape conventions match lib/scheduleData.js:
//   · single `sql` import from ./db.js
//   · functions return rows / objects as-is; null when the canonical
//     "no current edition" state is true; [] for list calls when no
//     current edition exists. Never throw on absence — callers render
//     graceful empty / "coming soon" surfaces on null/[].
//
// Schema notes (verified against DEV before this was written):
//   · ranking_editions has: id, edition_number, edition_label, status,
//     is_current, published_at, editorial_weight, sites_weight (all
//     columns referenced below). status='published' AND is_current=true
//     is the "current published" predicate.
//   · teams has a `slug` column (global-unique, per migration 005).
//
// Filtering policy: BOTH helpers gate on is_current=true AND
// status='published'. A draft or superseded edition is NEVER returned.

import { sql } from './db.js';

// =============================================================================
// getCurrentEdition({ listSlug, leagueSlug })
//
// Returns the metadata for the single published-and-current edition of
// the given ranking list within the given league, or NULL when no such
// edition exists (pre-launch state, or between editions where the
// previous was superseded but no new one is current yet).
//
// Returned shape:
//   {
//     id:                integer    — ranking_editions.id (PK)
//     edition_number:    integer    — sequential number per list
//     edition_label:     string|null — display label like 'Pre-tournament'
//     published_at:      Date|null  — timestamp at flip; null if pre-flip
//     editorial_weight:  number     — typically 0.70 per Methodology §3
//     sites_weight:      number     — typically 0.30
//   }
// =============================================================================
export async function getCurrentEdition({ listSlug, leagueSlug }) {
  const rows = await sql`
    SELECT
      ed.id,
      ed.edition_number,
      ed.edition_label,
      ed.published_at,
      ed.editorial_weight::float AS editorial_weight,
      ed.sites_weight::float     AS sites_weight
    FROM ranking_editions ed
    JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
    JOIN leagues lg       ON lg.id = rl.league_id
    WHERE rl.slug = ${listSlug}
      AND lg.slug = ${leagueSlug}
      AND ed.is_current = true
      AND ed.status     = 'published'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// getTopN({ listSlug, leagueSlug, limit = 5 })
//
// Returns up to `limit` rows from the current published edition,
// ordered by rank ASC. Returns [] when there is no current edition or
// the edition has no entries. Never null, never throws on absence.
//
// Per-row shape:
//   {
//     rank:                 integer
//     team_id:              integer    — teams.id
//     team_name:            string     — teams.name
//     team_slug:            string     — teams.slug (canonical /team/[slug])
//     score:                number     — outer composite, 0.00-10.00
//     movement_label:       string     — 'new' | 'up' | 'down' | 'hold' |
//                                       'returning' | 'needs_review'
//     editorial_composite:  number     — 5-dim editorial composite, 0-10
//     sites_composite:      number|null — 3-source sites blend, 0-10
//   }
// =============================================================================
export async function getTopN({ listSlug, leagueSlug, limit = 5 }) {
  const rows = await sql`
    SELECT
      e.rank,
      e.team_id,
      t.name AS team_name,
      t.slug AS team_slug,
      e.score::float               AS score,
      e.movement_label,
      e.editorial_composite::float AS editorial_composite,
      e.sites_composite::float     AS sites_composite
    FROM ranking_entries e
    JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
    JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
    JOIN leagues lg          ON lg.id = rl.league_id
    JOIN teams t             ON t.id  = e.team_id
    WHERE rl.slug = ${listSlug}
      AND lg.slug = ${leagueSlug}
      AND ed.is_current = true
      AND ed.status     = 'published'
    ORDER BY e.rank ASC
    LIMIT ${limit}
  `;
  return rows;
}

// =============================================================================
// getRankingsForPage({ listSlug, leagueSlug, limit })
//
// Full-list payload for the /power-rankings article page. Same edition filter
// as getTopN (is_current + published), plus:
//   · team abbreviation / flag_svg_path / flag_color_primary
//     (the trigram chip + flag fallbacks the schedule / sidebar / match
//     pages already use — single shared source on teams)
//   · ranking_entry_id (needed to wire the row-blurb adapter in Phase 2)
//   · LEFT JOIN editorial_blurbs for blurb_type='ranking_row_blurb',
//     status='editor_approved', is_current=true. Returns blurb_body=null
//     when no approved row exists yet — caller renders the card without
//     the blurb paragraph, so Part 1 ships before Part 2 generates the
//     row-blurb prose.
//
// Per-row shape (extends the getTopN shape with team flag fields +
// ranking_entry_id + blurb_body):
//   {
//     rank, ranking_entry_id, team_id, team_name, team_slug,
//     team_abbreviation, team_flag_svg_path, team_flag_color_primary,
//     score, movement_label, editorial_composite, sites_composite,
//     blurb_body
//   }
// =============================================================================
export async function getRankingsForPage({ listSlug, leagueSlug, limit = 48 }) {
  const rows = await sql`
    SELECT
      e.id                          AS ranking_entry_id,
      e.rank,
      e.team_id,
      t.name                        AS team_name,
      t.slug                        AS team_slug,
      t.abbreviation                AS team_abbreviation,
      t.flag_svg_path               AS team_flag_svg_path,
      t.flag_color_primary          AS team_flag_color_primary,
      e.score::float                AS score,
      e.movement_label,
      e.editorial_composite::float  AS editorial_composite,
      e.sites_composite::float      AS sites_composite,
      b.body                        AS blurb_body
    FROM ranking_entries e
    JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
    JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
    JOIN leagues lg          ON lg.id = rl.league_id
    JOIN teams t             ON t.id  = e.team_id
    LEFT JOIN editorial_blurbs b
           ON b.ranking_entry_id = e.id
          AND b.blurb_type = 'ranking_row_blurb'
          AND b.status     = 'editor_approved'
          AND b.is_current = true
    WHERE rl.slug = ${listSlug}
      AND lg.slug = ${leagueSlug}
      AND ed.is_current = true
      AND ed.status     = 'published'
    ORDER BY e.rank ASC
    LIMIT ${limit}
  `;
  return rows;
}
