// app/robots.js — generated /robots.txt (Next metadata file convention).
//
// Allow everything except the app/auth surfaces, and point at the sitemap. The
// Disallow list is derived from NOINDEX_PREFIXES so robots.txt and the per-page
// noindex meta tags cannot drift apart — they are the same policy stated twice
// because they do different jobs (Disallow stops the crawl, noindex stops the
// listing; see lib/seo/routes.js).
//
// A trailing slash is added to each prefix so the rule is unambiguous about
// matching a path segment rather than a name prefix.

import { NOINDEX_PREFIXES, absolute } from '@/lib/seo/routes';

export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: NOINDEX_PREFIXES.flatMap((p) => [p, `${p}/`]),
    },
    sitemap: absolute('/sitemap.xml'),
  };
}
