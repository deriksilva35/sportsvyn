// lib/seo/sitemapPlan.js - how the sitemap is cut into files.
//
// WHY IT IS CUT AT ALL. One urlset had reached 37,339 URLs and 6.4 MB against
// Google's 50,000 / 50 MB ceiling. 30,969 of those are /player/ URLs, and a CFB
// roster season adds roughly 26,700 more - so the single file was one import
// away from the cap, and crossing it does not fail loudly at the crawler, it
// just stops advertising whatever falls off the end.
//
// SPLIT BY SURFACE, THEN CHUNKED BY COUNT. Both, and the order matters.
//
//   By surface, because that is how the file is already generated: four
//   independent queries plus a static list. A surface split is a one-to-one
//   mapping onto code that already exists, and it keeps lastModified coherent
//   per file - publishing one article re-dates the articles child alone
//   instead of inviting a crawler to re-read 31,000 player URLs.
//
//   Then by count, because a surface split ALONE would have left the players
//   child at 30,969 of 50,000 - 62% full, growing by a full CFB roster every
//   season. That is a split that has to be done again next year. Chunking from
//   the start means growth adds a file rather than forcing a redesign.
//
// A CHUNK IS 20,000, NOT 50,000. The cap is the failure point, not the target;
// sizing to it means the first file to cross it fails. 20,000 keeps every child
// well inside the limit on both counts - the largest child today is under 2 MB
// against a 50 MB ceiling - and keeps a single file small enough to re-fetch
// cheaply.

/** Google's per-file ceiling. A tripwire, not a target - see above. */
export const SITEMAP_MAX_URLS = 50_000;

/** URLs per child file. */
export const SITEMAP_CHUNK_URLS = 20_000;

/**
 * The surfaces, in the order they are emitted.
 *
 * `prefix` is what makes cross-child duplication impossible BY CONSTRUCTION:
 * every surface writes under a distinct path prefix, so no URL can be produced
 * by two surfaces. Dedupe is therefore only ever needed WITHIN a surface - and
 * it is genuinely needed there, because `teams` carries one row per competition
 * and 509 rows collapse to 452 distinct /team/ URLs.
 */
export const SITEMAP_SURFACES = Object.freeze([
  { key: 'static',   prefix: null,       changeFrequency: null,      priority: null },
  { key: 'articles', prefix: '/article', changeFrequency: 'monthly', priority: 0.7 },
  { key: 'teams',    prefix: '/team',    changeFrequency: 'weekly',  priority: 0.6 },
  { key: 'matches',  prefix: '/match',   changeFrequency: 'daily',   priority: 0.6 },
  { key: 'players',  prefix: '/player',  changeFrequency: 'monthly', priority: 0.4 },
]);

export const SITEMAP_SURFACE_KEYS = Object.freeze(SITEMAP_SURFACES.map((s) => s.key));

/** How many files a surface of `count` URLs needs. Always at least one. */
export function partsFor(count) {
  if (!Number.isFinite(count) || count <= 0) return 1;
  return Math.max(1, Math.ceil(count / SITEMAP_CHUNK_URLS));
}

/**
 * The child ids, given a per-surface count.
 *
 * A surface ALWAYS emits at least one file, even at zero rows. An id that
 * exists in the index but 404s is a broken sitemap; an empty urlset is a valid
 * one that honestly says "nothing here yet".
 */
export function planSitemaps(counts = {}) {
  const ids = [];
  for (const { key } of SITEMAP_SURFACES) {
    const parts = partsFor(counts[key] ?? 0);
    for (let i = 0; i < parts; i++) ids.push(`${key}-${i}`);
  }
  return ids;
}

/** "players-1" -> { key: 'players', part: 1 }. Null for anything unrecognised. */
export function parseSitemapId(id) {
  const m = /^([a-z]+)-(\d+)$/.exec(String(id ?? ''));
  if (!m) return null;
  const surface = SITEMAP_SURFACES.find((s) => s.key === m[1]);
  if (!surface) return null;
  return { key: surface.key, part: Number(m[2]), surface };
}

/** The row window a child covers. LIMIT/OFFSET, so a child reads only its own. */
export function windowFor(part) {
  return { limit: SITEMAP_CHUNK_URLS, offset: part * SITEMAP_CHUNK_URLS };
}
