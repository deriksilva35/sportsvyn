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
// Pre-match previews tied to matches that KICK OFF today (PT calendar).
// We scope by matches.kickoff_at (when the audience cares) rather than
// articles.published_at (when the writer produced it), and we link the
// rail row to the match page — articles.body already renders inside
// the match Preview tab, so the article itself doesn't need its own
// route. Capped by Watch Score so the most-watchable previews lead.
// Returns [] when no preview-attached matches fall on today PT — caller
// hides the section rather than rendering an empty header.
// =============================================================================
export async function getTodaysReads({ ptDay = null, limit = 4 } = {}) {
  let day = ptDay;
  if (!day) {
    const r = await sql`SELECT to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS d`;
    day = r[0].d;
  }
  const rows = await sql`
    SELECT a.id, a.slug, a.title, a.subtitle, a.type, a.score_type, a.published_at,
           a.composite_score,
           coalesce(length(a.body), 0) AS body_len,
           m.slug AS match_slug
      FROM articles a
      JOIN matches m ON m.id = a.match_id
      JOIN leagues lg ON lg.id = m.league_id AND lg.slug = 'fifa-wc-2026'
     WHERE a.status = 'published'
       AND a.type = 'preview'
       AND a.body IS NOT NULL
       AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date = ${day}::date
     ORDER BY a.composite_score DESC NULLS LAST, a.published_at DESC NULLS LAST
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
