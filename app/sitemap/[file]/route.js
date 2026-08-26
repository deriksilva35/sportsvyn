// app/sitemap/[file]/route.js - one child sitemap, e.g. /sitemap/players-1.xml.
//
// The filename carries the id, so the index and the children agree on one
// naming scheme: <surface>-<part>.xml. An id the index does not advertise 404s
// rather than answering 200 with an empty urlset, which would read as "this
// surface has no URLs" instead of "no such file".

import { entriesFor, renderUrlset, XML_HEADERS } from '@/lib/seo/sitemapData';

export const revalidate = 3600;

export async function GET(_req, ctx) {
  const { file } = await ctx.params;
  const id = String(file ?? '').replace(/\.xml$/, '');
  const entries = await entriesFor(id);
  if (!entries) return new Response('Not found', { status: 404 });
  return new Response(renderUrlset(entries), { headers: XML_HEADERS });
}
