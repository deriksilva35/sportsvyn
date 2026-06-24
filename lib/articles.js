// lib/articles.js — published articles read helpers.
//
// Read-only. Two helpers used by the homepage Daily Card + Sportsvyn-Now
// rail. Both return [] on no-data (never throw, never null) so the
// caller can render a graceful empty-state.
//
// Read-time derivation: articles.body is the long-form prose column.
// We approximate words = chars / 5 (rough English average), then divide
// by 250 wpm. Floor at 1 min so a published article never reads as 0.
//
// "Featured" semantics (Stage 1): there is no editorial-feature flag
// column on articles yet — featured = most-recent published. When a
// featured flag lands in a future migration, this helper swaps the
// ORDER BY without changing the call sites.

import { sql } from './db.js';

const WORDS_PER_MIN = 250;
const CHARS_PER_WORD = 5;

function deriveKicker(row) {
  if (row.type === 'preview' && row.score_type === 'watch') return 'Watch Score · Pre-match';
  if (row.type === 'preview') return 'Pre-match';
  if (row.type === 'recap')   return 'Match Recap';
  if (row.type === 'feature') return 'Feature';
  return String(row.type ?? 'Article');
}

function deriveReadTimeMin(bodyLen) {
  const words = Math.max(0, Number(bodyLen ?? 0)) / CHARS_PER_WORD;
  return Math.max(1, Math.round(words / WORDS_PER_MIN));
}

function shape(row) {
  return {
    slug: row.slug,
    match_slug: row.match_slug ?? null,
    // Team association for the volt-title tint on Today's Reads. Carried
    // through from matches via match_id for preview rows; null for
    // non-preview types (essay/edge/profile/rankings/recap/newsletter)
    // which don't link to a match. Renderers must null-guard before
    // calling followedSet.has.
    home_team_id: row.home_team_id ?? null,
    away_team_id: row.away_team_id ?? null,
    title: row.title,
    subtitle: row.subtitle,
    kicker: deriveKicker(row),
    read_time_min: deriveReadTimeMin(row.body_len),
    published_at: row.published_at,
  };
}

// =============================================================================
// getFeaturedReads({ limit })
//
// Most-recent published articles across all types/categories. Stage-1
// stand-in for an editorial-feature flag.
// =============================================================================
export async function getFeaturedReads({ limit = 5 } = {}) {
  const rows = await sql`
    SELECT id, slug, title, subtitle, type, score_type, published_at,
           coalesce(length(body), 0) AS body_len
      FROM articles
     WHERE status = 'published'
     ORDER BY published_at DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT ${limit}
  `;
  return rows.map(shape);
}

// =============================================================================
// getTodaysReads({ ptDay?, limit })
//
// Mixed rail: WC pre-match previews tied to matches kicking off today
// (PT calendar) PLUS WC-scoped essays / non-preview features published
// today. Date axis differs per type by design — readers care WHEN the
// match happens for previews, but WHEN it dropped for evergreen pieces
// like /article essays.
//
// Pinned pieces lead: a non-null articles.pinned_at floats the row to
// the top regardless of date. Use sparingly — pin one piece at a time
// so the rail still reads as "today's reads," not a static feature.
//
// Returns [] when nothing surfaces. Caller hides the section header
// rather than rendering an empty rail.
//
// Per-row shape (unchanged) via shape(): slug, match_slug (null for
// essays — the route is /article/[slug] in that case), title, subtitle,
// kicker, read_time_min, published_at.
// =============================================================================
export async function getTodaysReads({ ptDay = null, limit = 4 } = {}) {
  let day = ptDay;
  if (!day) {
    const r = await sql`SELECT to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS d`;
    day = r[0].d;
  }
  const rows = await sql`
    SELECT a.id, a.slug, a.title, a.subtitle, a.type, a.score_type, a.published_at,
           a.pinned_at, a.composite_score,
           coalesce(length(a.body), 0) AS body_len,
           m.slug AS match_slug,
           m.home_team_id, m.away_team_id
      FROM articles a
      LEFT JOIN matches m ON m.id = a.match_id
      LEFT JOIN leagues lg_m ON lg_m.id = m.league_id
      LEFT JOIN leagues lg_a ON lg_a.id = a.league_id
     WHERE a.status = 'published'
       AND a.body IS NOT NULL
       AND (
         (a.type = 'preview'
          AND lg_m.slug = 'fifa-wc-2026'
          AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date = ${day}::date)
         OR
         (a.type IN ('essay','edge','profile','rankings','recap','newsletter')
          AND lg_a.slug = 'fifa-wc-2026'
          AND (a.published_at AT TIME ZONE 'America/Los_Angeles')::date = ${day}::date)
       )
     ORDER BY (a.pinned_at IS NOT NULL) DESC,
              COALESCE(a.pinned_at, a.published_at) DESC NULLS LAST,
              a.composite_score DESC NULLS LAST
     LIMIT ${limit}
  `;
  return rows.map(shape);
}

// =============================================================================
// getArticleBySlug(slug)
//
// Single-article fetch for /article/[slug] reader. Returns the full
// articles row plus league name/slug + the primary tag's name/slug (the
// lowest-id tag attached to the article, used to derive the kicker
// e.g. "The Laws · 2026 FIFA World Cup"). Returns null when no row is
// found — caller (the route) flips to notFound() so the page 404s
// cleanly rather than crashing.
// =============================================================================
export async function getArticleBySlug(slug) {
  const rows = await sql`
    SELECT a.*,
           l.name AS league_name, l.slug AS league_slug,
           pt.name AS primary_tag_name, pt.slug AS primary_tag_slug
    FROM articles a
    LEFT JOIN leagues l ON l.id = a.league_id
    LEFT JOIN LATERAL (
      SELECT t.name, t.slug
      FROM article_tags at JOIN tags t ON t.id = at.tag_id
      WHERE at.article_id = a.id
      ORDER BY at.tag_id ASC
      LIMIT 1
    ) pt ON true
    WHERE a.slug = ${slug}
    LIMIT 1
  `;
  return rows[0] || null;
}
