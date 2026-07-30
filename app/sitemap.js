// app/sitemap.js — generated /sitemap.xml (Next metadata file convention).
//
// Static routes from lib/seo/routes.js plus the DB-enumerated slugs: matches,
// teams, players, and published articles. ~3,000 URLs today, one file (the 50k
// cap is a tripwire, not a target — see SITEMAP_MAX_URLS).
//
// Cached rather than force-dynamic. This is a Route Handler, so force-dynamic
// would re-run four table scans on every crawler hit; a sitemap does not need
// to be second-accurate and crawlers fetch it rarely. Hourly revalidation is
// well inside how fast new slugs appear.
//
// Included content is filtered to what actually renders as a page:
//   · matches  — all leagues. /match/[slug] serves gridiron AND soccer rows
//                (verified: cfb-2025-reg-w1-iowa-state-kansas-state renders).
//   · articles — status='published' ONLY. 'draft' and 'preview' rows are
//                pending-review and must never be advertised to a crawler.
// A row with a NULL slug is skipped rather than emitting a broken URL.

import { sql } from '@/lib/db';
import { STATIC_ROUTES, SITEMAP_MAX_URLS, absolute, dedupeByUrl } from '@/lib/seo/routes';

export const revalidate = 3600;

export default async function sitemap() {
  const now = new Date();

  let entries = STATIC_ROUTES.map((r) => ({
    url: absolute(r.path),
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  // One query per surface, each already narrowed to (slug, updated_at). No joins:
  // the sitemap needs identity and freshness, nothing else.
  const [matches, teams, players, articles] = await Promise.all([
    sql`SELECT slug, updated_at FROM matches WHERE slug IS NOT NULL`,
    sql`SELECT slug, updated_at FROM teams WHERE slug IS NOT NULL`,
    sql`SELECT slug, updated_at FROM players WHERE slug IS NOT NULL`,
    sql`SELECT slug, updated_at FROM articles WHERE slug IS NOT NULL AND status = 'published'`,
  ]);

  const push = (rows, prefix, changeFrequency, priority) => {
    for (const r of rows) {
      entries.push({
        url: absolute(`${prefix}/${r.slug}`),
        lastModified: r.updated_at ?? now,
        changeFrequency,
        priority,
      });
    }
  };

  push(articles, '/article', 'monthly', 0.7);
  push(matches, '/match', 'daily', 0.6);
  push(teams, '/team', 'weekly', 0.6);
  push(players, '/player', 'monthly', 0.4);

  // One entry per URL. Slugs are unique per ROW, not per URL — `teams` holds a row
  // per competition, so 383 rows collapse to 346 /team/... URLs. See dedupeByUrl.
  const unique = dedupeByUrl(entries);
  if (unique.length !== entries.length) {
    console.log(`[sitemap] ${entries.length} rows -> ${unique.length} unique URLs`);
  }
  entries = unique;

  if (entries.length > SITEMAP_MAX_URLS) {
    // Loud on purpose: a silently truncated sitemap reads as "everything is
    // covered" when it is not. Crossing this means splitting via generateSitemaps().
    console.warn(
      `[sitemap] ${entries.length} URLs exceeds the ${SITEMAP_MAX_URLS} single-file cap; ` +
      `emitting the first ${SITEMAP_MAX_URLS} and DROPPING ${entries.length - SITEMAP_MAX_URLS}. ` +
      'Split with generateSitemaps().',
    );
    return entries.slice(0, SITEMAP_MAX_URLS);
  }
  return entries;
}
