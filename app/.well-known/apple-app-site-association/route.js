/**
 * /.well-known/apple-app-site-association — Universal Links association file.
 *
 * Apple requires this served with NO file extension and Content-Type
 * application/json, over HTTPS, with no redirect. A Route Handler is how Next 16
 * serves a custom .well-known endpoint (docs: Route Handlers > Content types).
 * force-static: the content is fixed and Apple fetches it periodically.
 *
 * Inert until a native build claims the domain — see lib/aasa.js.
 */

import { APPLE_APP_SITE_ASSOCIATION } from '@/lib/aasa';

export const dynamic = 'force-static';

export async function GET() {
  return new Response(JSON.stringify(APPLE_APP_SITE_ASSOCIATION), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
