// lib/seo/sitemapData.js - the URL set behind every sitemap file.
//
// WHY THIS IS NOT app/sitemap.js ANYMORE. Next's metadata convention owns
// /sitemap.xml unconditionally: with generateSitemaps() it emits children at
// /sitemap/<id>.xml and serves the app's 404 page at /sitemap.xml, and adding a
// route handler there fails the build outright -
//     "Conflicting route and metadata at /sitemap.xml"
// so the index cannot live at the one address crawlers already hold while the
// metadata file exists. Both files are ordinary route handlers now, reading
// from here, which also means we serialise the XML ourselves.
//
// DEDUPE IS DONE IN SQL, and that is correctness rather than tidiness. The old
// single file collected every surface into one array and deduped the whole
// thing at the end. That cannot survive chunking: with LIMIT/OFFSET over ROWS,
// two rows sharing a slug can straddle a chunk boundary and the same <loc>
// lands in two child files - exactly what a sitemap index must never do.
// `GROUP BY slug` with `max(updated_at)` is the same rule dedupeByUrl applies
// (one entry per URL, newest wins) pushed down to where the windowing happens,
// so a chunk can never hold a partial group. ORDER BY slug keeps the windows
// stable between regenerations.
//
// Included content is filtered to what actually renders as a page:
//   · matches  - all leagues. /match/[slug] serves gridiron AND soccer rows.
//   · articles - status='published' ONLY. draft/preview rows are pending review
//                and must never be advertised to a crawler.
// A row with a NULL slug is skipped rather than emitting a broken URL.

import { sql } from '../db.js';
import { STATIC_ROUTES, absolute } from './routes.js';
import { KEPT_LEAGUES } from '../retired.js';
import { SITEMAP_MAX_URLS, planSitemaps, parseSitemapId, windowFor } from './sitemapPlan.js';

// `slug` is grouped so the count and the page window agree on what a URL is.
// Counting ROWS while paging URLs would produce a child claiming more entries
// than it can emit, and a last chunk that is silently short.
// SOCCER IS RETIRED (tue-14): a soccer team, match or player 301s to /scores
// from its page, so none is listed. The league joins mirror the pages' own
// (lib/teams.js, lib/matches, lib/players.js). A player with no current team
// has no league and renders as before, so it stays. No articles surface.
const KEPT = [...KEPT_LEAGUES];
const COUNTS = {
  teams:    () => sql`SELECT count(DISTINCT t.slug)::int AS n FROM teams t JOIN leagues lg ON lg.id = t.league_id
                      WHERE t.slug IS NOT NULL AND lg.slug = ANY(${KEPT})`,
  matches:  () => sql`SELECT count(DISTINCT m.slug)::int AS n FROM matches m JOIN leagues lg ON lg.id = m.league_id
                      WHERE m.slug IS NOT NULL AND lg.slug = ANY(${KEPT})`,
  players:  () => sql`SELECT count(DISTINCT p.slug)::int AS n FROM players p
                      LEFT JOIN teams t ON t.id = p.current_team_id LEFT JOIN leagues lg ON lg.id = t.league_id
                      WHERE p.slug IS NOT NULL AND (lg.slug IS NULL OR lg.slug = ANY(${KEPT}))`,
};

const PAGES = {
  teams: (limit, offset) => sql`
    SELECT t.slug, max(t.updated_at) AS updated_at FROM teams t JOIN leagues lg ON lg.id = t.league_id
     WHERE t.slug IS NOT NULL AND lg.slug = ANY(${KEPT})
     GROUP BY t.slug ORDER BY t.slug LIMIT ${limit} OFFSET ${offset}`,
  matches: (limit, offset) => sql`
    SELECT m.slug, max(m.updated_at) AS updated_at FROM matches m JOIN leagues lg ON lg.id = m.league_id
     WHERE m.slug IS NOT NULL AND lg.slug = ANY(${KEPT})
     GROUP BY m.slug ORDER BY m.slug LIMIT ${limit} OFFSET ${offset}`,
  players: (limit, offset) => sql`
    SELECT p.slug, max(p.updated_at) AS updated_at FROM players p
      LEFT JOIN teams t ON t.id = p.current_team_id LEFT JOIN leagues lg ON lg.id = t.league_id
     WHERE p.slug IS NOT NULL AND (lg.slug IS NULL OR lg.slug = ANY(${KEPT}))
     GROUP BY p.slug ORDER BY p.slug LIMIT ${limit} OFFSET ${offset}`,
};

/** Per-surface URL counts - the numbers the split is cut from. */
export async function surfaceCounts() {
  const keys = Object.keys(COUNTS);
  const rows = await Promise.all(keys.map((k) => COUNTS[k]()));
  const out = { static: STATIC_ROUTES.length };
  keys.forEach((k, i) => { out[k] = rows[i][0]?.n ?? 0; });
  return out;
}

/** The child ids that currently exist, in emission order. */
export async function sitemapIds() {
  return planSitemaps(await surfaceCounts());
}

/**
 * The entries for one child. An unrecognised id returns null so the route can
 * 404 it - an id the index never advertised should not answer 200 with an
 * empty file, which reads as "this surface is empty" rather than "no such file".
 */
export async function entriesFor(id) {
  const parsed = parseSitemapId(id);
  if (!parsed) return null;
  const { key, part, surface } = parsed;
  const { limit, offset } = windowFor(part);
  const now = new Date();

  // A PART PAST THE END IS NOT A FILE. parseSitemapId only proves the id is
  // well-formed, so players-2 and players-99 parse perfectly and used to answer
  // 200 with an empty urlset - a crawler reading that is told the surface has no
  // URLs, when what happened is there is no such file. Caught on DEV by probing
  // ids the index does not advertise, which is the only way it shows up.
  //
  // Emptiness IS the test, and it needs no extra query: part 0 always exists
  // (every surface emits at least one file, empty or not), and any higher part
  // exists exactly when its window has rows.
  const beyondEnd = (rows) => part > 0 && rows.length === 0;

  if (key === 'static') {
    const slice = STATIC_ROUTES.slice(offset, offset + limit);
    if (beyondEnd(slice)) return null;
    return slice.map((r) => ({
      url: absolute(r.path),
      lastModified: now,
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    }));
  }

  const rows = await PAGES[key](limit, offset);
  if (beyondEnd(rows)) return null;
  if (rows.length > SITEMAP_MAX_URLS) {
    // Unreachable while the chunk size is under the cap, loud if that changes -
    // a silently truncated sitemap reads as full coverage when it is not.
    console.warn(`[sitemap] child ${id} holds ${rows.length} URLs, over the ${SITEMAP_MAX_URLS} cap`);
  }
  return rows.map((r) => ({
    url: absolute(`${surface.prefix}/${r.slug}`),
    lastModified: r.updated_at ?? now,
    changeFrequency: surface.changeFrequency,
    priority: surface.priority,
  }));
}

// ------------------------------------------------------------------ XML

/** A <loc> is XML, not a string. Cheap now; unwritten is how it stays unwritten. */
export function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const iso = (d) => {
  const t = new Date(d ?? Date.now());
  return Number.isFinite(t.getTime()) ? t.toISOString() : new Date().toISOString();
};

export function renderUrlset(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((e) => {
      const parts = [`<loc>${xmlEscape(e.url)}</loc>`, `<lastmod>${iso(e.lastModified)}</lastmod>`];
      if (e.changeFrequency) parts.push(`<changefreq>${xmlEscape(e.changeFrequency)}</changefreq>`);
      if (e.priority != null) parts.push(`<priority>${Number(e.priority).toFixed(1)}</priority>`);
      return `  <url>${parts.join('')}</url>`;
    }),
    '</urlset>',
    '',
  ].join('\n');
}

export function renderIndex(ids, lastmod = new Date()) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...ids.map((id) =>
      `  <sitemap><loc>${xmlEscape(absolute(`/sitemap/${id}.xml`))}</loc><lastmod>${iso(lastmod)}</lastmod></sitemap>`),
    '</sitemapindex>',
    '',
  ].join('\n');
}

export const XML_HEADERS = Object.freeze({
  'Content-Type': 'application/xml',
  'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
});
