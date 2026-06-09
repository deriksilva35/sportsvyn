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
// Articles published on the supplied PT calendar day (defaults to today
// PT). Returns [] when nothing landed today — caller hides the section
// rather than rendering an empty header.
// =============================================================================
export async function getTodaysReads({ ptDay = null, limit = 5 } = {}) {
  let day = ptDay;
  if (!day) {
    const r = await sql`SELECT to_char((now() AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS d`;
    day = r[0].d;
  }
  const rows = await sql`
    SELECT id, slug, title, subtitle, type, score_type, published_at,
           coalesce(length(body), 0) AS body_len
      FROM articles
     WHERE status = 'published'
       AND (published_at AT TIME ZONE 'America/Los_Angeles')::date = ${day}::date
     ORDER BY published_at DESC NULLS LAST
     LIMIT ${limit}
  `;
  return rows.map(shape);
}
