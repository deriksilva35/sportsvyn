/**
 * GET /api/email/click?c=<campaign>&u=<userId>&t=<sig>&to=<url>
 *
 * The one place a broadcast link lands before it goes where it says. Verifies
 * the signature (lib/auth/welcomeEmail.js clickToken - campaign + user +
 * destination), ledgers the click to sync_runs source='email-click', and 302s.
 *
 * ONLY OUR OWN DESTINATIONS. `to` must be a site-relative path or an
 * https://sportsvyn.com URL; anything else is refused even with a valid
 * signature, so this can never be an open redirect. A bad signature still
 * sends the reader to the lobby rather than a dead page - the ledger records
 * the refusal, the person gets a door.
 */
import { sql } from '@/lib/db';
import { clickToken } from '@/lib/auth/welcomeEmail';

export const dynamic = 'force-dynamic';

const SITE = 'https://sportsvyn.com';

export function safeDestination(to) {
  if (typeof to !== 'string' || !to) return null;
  if (to.startsWith('/') && !to.startsWith('//')) return `${SITE}${to}`;
  try {
    const u = new URL(to);
    if (u.protocol === 'https:' && (u.hostname === 'sportsvyn.com' || u.hostname === 'www.sportsvyn.com')) return u.toString();
  } catch { /* not a URL */ }
  return null;
}

export async function GET(request) {
  const url = new URL(request.url);
  const c = url.searchParams.get('c');
  const u = url.searchParams.get('u');
  const t = url.searchParams.get('t');
  const to = url.searchParams.get('to');
  const dest = safeDestination(to);

  const { timingSafeEqual } = await import('node:crypto');
  const want = c && u && to ? clickToken({ campaign: c, userId: u, to }) : '';
  const a = Buffer.from(want); const b = Buffer.from(String(t ?? ''));
  const ok = want.length > 0 && a.length === b.length && timingSafeEqual(a, b);

  try {
    await sql`
      INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
      VALUES ('email-click', 'click', now(), now(), ${ok && dest != null},
              ${JSON.stringify({ campaign: c, userId: u == null ? null : Number(u), to, dest, verified: ok,
                ua: request.headers.get('user-agent')?.slice(0, 200) ?? null })}::jsonb)`;
  } catch (e) {
    console.error('[email-click] ledger failed', { message: e?.message });
  }

  return Response.redirect(ok && dest ? dest : `${SITE}/games`, 302);
}
