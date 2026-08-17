// lib/seo/routes.js — the single definition of what Sportsvyn lets search engines
// index. Read by app/robots.js (the Disallow list), app/sitemap.js (the URL set),
// and lib/seo/routes.test.mjs (which scans app/**/page.js and fails if any page
// disagrees with the policy below).
//
// One list, three consumers, on purpose. Before this existed, indexability was 24
// scattered `robots: { index: false }` literals with no way to answer "what is
// indexable?" except by grepping — and the audit found real drift: /signin and
// /admin/signups were publicly indexable while /market and /membership had already
// been lifted by hand. A policy that lives in one file can be tested; a policy
// spread across 24 files cannot.
//
// NOTE ON PRECEDENCE: robots.txt Disallow and a page's noindex meta do different
// jobs. Disallow stops the crawl; noindex stops the listing. A page that is only
// Disallow'd can still be listed from external links (Google cannot see the meta
// tag it never fetched), so the private surfaces below carry BOTH.

// Prefix -> every route under it is off-limits to crawlers. Order is irrelevant;
// matching is "pathname === prefix || pathname.startsWith(prefix + '/')".
export const NOINDEX_PREFIXES = [
  '/sim',    // the draft sim: an authed app surface, not editorial
  '/my',     // per-user dashboard
  '/account',// signed-in account surface: email and membership state
  '/admin',  // Basic-Auth'd behind proxy.js; noindex belt-and-braces
  '/signin', // auth flow, incl. /signin/check-email
  '/app',    // the Capacitor native shell (app/app/layout.js)
];

export function isNoindexRoute(pathname) {
  return NOINDEX_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Static indexable routes, with sitemap hints. changeFrequency/priority are advisory
// — Google has said it largely ignores both — so they are set to describe the page
// honestly rather than to game anything.
//
// Deliberately ABSENT and worth knowing why:
//   /confirmed          transactional email landing page; nothing to rank
//   /signin/check-email same, and now noindex
//   /article/[slug]     enumerated from the DB below, not static
export const STATIC_ROUTES = [
  { path: '/', changeFrequency: 'hourly', priority: 1.0 },
  { path: '/scores', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/schedule', changeFrequency: 'daily', priority: 0.8 },
  { path: '/market', changeFrequency: 'hourly', priority: 0.8 },
  { path: '/stats', changeFrequency: 'daily', priority: 0.7 },
  { path: '/articles', changeFrequency: 'daily', priority: 0.8 },
  { path: '/nfl', changeFrequency: 'daily', priority: 0.9 },
  { path: '/nfl/rankings', changeFrequency: 'weekly', priority: 0.8 },
  // Public editorial surface, deliberately indexable: it is a record of the
  // market, not a member tool. Daily because the pool re-snapshots each morning.
  { path: '/nfl/fantasy', changeFrequency: 'daily', priority: 0.8 },
  { path: '/cfb', changeFrequency: 'daily', priority: 0.9 },
  { path: '/cfb/rankings', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/world-cup-2026/bracket', changeFrequency: 'daily', priority: 0.9 },
  { path: '/world-cup-2026/rankings', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/world-cup-2026/rankings/power', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/world-cup-2026/rankings/players', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/membership', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
];

// Sitemaps cap at 50,000 URLs / 50MB uncompressed per file. Current enumeration is
// ~3,000, so one file is correct and pagination would be premature. This constant
// is the tripwire: if it is ever hit, split with Next's generateSitemaps() (see
// node_modules/next/dist/docs/.../sitemap.md) rather than silently truncating —
// sitemap.js logs when it trims.
export const SITEMAP_MAX_URLS = 50_000;

// Absolute site origin, no trailing slash. Follows the convention already used by
// the email signup/confirm API routes, with a literal final fallback so a missing
// env can never emit "https://undefined/..." into a sitemap — a wrong-but-valid
// host is recoverable, a malformed one poisons every URL in the file.
export function siteOrigin() {
  const raw = process.env.NEXT_PUBLIC_BASE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    || 'https://sportsvyn.com';
  return raw.replace(/\/+$/, '');
}

export function absolute(pathname) {
  return `${siteOrigin()}${pathname}`;
}

/**
 * Collapse sitemap entries to one per URL, keeping the NEWEST lastModified.
 *
 * Needed because slugs are unique per row, not per URL. `teams` carries one row
 * per national team PER COMPETITION — Senegal exists three times (World Cup,
 * international friendlies, Africa Cup of Nations) on the same 'senegal' slug, so
 * 383 team rows yield only 346 distinct /team/... URLs. Emitting the same <loc>
 * repeatedly is malformed-ish (crawlers dedupe, but it inflates the file and
 * misreports coverage), and picking an arbitrary row's timestamp would make
 * lastModified unstable between builds.
 *
 * Applied to ALL surfaces, not just teams: it is one code path, it costs nothing at
 * this scale, and it also catches any future cross-surface collision.
 *
 * Order is preserved (first appearance wins position), which keeps the file stable
 * and diffable across regenerations.
 */
export function dedupeByUrl(entries) {
  const byUrl = new Map();
  for (const e of entries) {
    const prev = byUrl.get(e.url);
    if (!prev) { byUrl.set(e.url, e); continue; }
    const a = new Date(prev.lastModified).getTime();
    const b = new Date(e.lastModified).getTime();
    if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) {
      byUrl.set(e.url, { ...prev, lastModified: e.lastModified });
    }
  }
  return [...byUrl.values()];
}
