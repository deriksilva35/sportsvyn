// app/sitemap.xml/route.js - the sitemap INDEX, at the address crawlers hold.
//
// The split had to keep this URL working. It is what robots.txt names and what
// was submitted to search engines, and a sitemap index is a valid response to a
// request for a sitemap - so the children are discovered from here rather than
// from a path nothing points at.
//
// It is a route handler and not Next's metadata file because the metadata
// convention cannot produce an index: see lib/seo/sitemapData.js.

import { sitemapIds, renderIndex, XML_HEADERS } from '@/lib/seo/sitemapData';

export const revalidate = 3600;

export async function GET() {
  return new Response(renderIndex(await sitemapIds()), { headers: XML_HEADERS });
}
