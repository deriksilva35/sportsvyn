/**
 * /api/email/unsubscribe -- the target of the welcome email's unsubscribe link.
 *
 * GET, because it is reached by clicking a link in a mail client; POST for the
 * mail client's own one-click button (RFC 8058, see POST below). Both must be
 * safe to hit twice, and they are: setting email_opted_out_at is idempotent,
 * and a second visit reports the same thing as the first.
 *
 * The link is SIGNED. Without a signature the query string is just a user id,
 * and anyone could unsubscribe anyone by counting upwards. The token is an HMAC
 * of the id under the app secret - the same one issued in the mail - and a
 * mismatch is refused rather than silently ignored.
 *
 * No auth required, deliberately: demanding a sign-in before honouring an
 * unsubscribe is the pattern that gets senders blocked.
 */

import { sql } from '@/lib/db';
import { verifyUnsubscribe } from '@/lib/email/linkSecret';

export const dynamic = 'force-dynamic';

function page(title, body) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" />`
    + `<meta name="viewport" content="width=device-width, initial-scale=1" />`
    + `<title>${title}</title></head>`
    + `<body style="margin:0;background:#0A0A0A;color:#F5F5F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">`
    + `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;">`
    + `<div style="max-width:360px;">`
    + `<div style="font-size:10px;font-weight:700;letter-spacing:.28em;text-transform:uppercase;color:#D4FF00;margin-bottom:12px;">Sportsvyn</div>`
    + `<h1 style="font-size:22px;margin:0 0 10px;">${title}</h1>`
    + `<p style="font-size:15px;line-height:1.55;color:#888;margin:0;">${body}</p>`
    + `</div></div></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/**
 * The one opt-out, shared by both doors. Returns 'incomplete' | 'unverified'
 * | 'failed' | 'done'.
 */
async function optOut(request) {
  const url = new URL(request.url);
  const u = url.searchParams.get('u');
  const t = url.searchParams.get('t');
  if (!u || !t) return 'incomplete';

  const ok = verifyUnsubscribe(u, t);
  if (!ok) return 'unverified';

  try {
    // Idempotent: COALESCE keeps the FIRST opt-out time rather than moving it
    // on every re-click. When somebody said no is worth preserving.
    await sql`UPDATE users SET email_opted_out_at = COALESCE(email_opted_out_at, now()) WHERE id = ${Number(u)}`;
  } catch (e) {
    console.error('[unsubscribe] write failed', { u, message: e?.message });
    return 'failed';
  }
  return 'done';
}

export async function GET(request) {
  const r = await optOut(request);
  if (r === 'incomplete') return page('Link incomplete', 'That unsubscribe link is missing part of itself. Reply to the email and we will take you off by hand.');
  if (r === 'unverified') return page('Link not recognised', 'That unsubscribe link could not be verified. Reply to the email and we will take you off by hand.');
  if (r === 'failed') return page('Something went wrong', 'We could not record that just now. Reply to the email and we will take you off by hand.');
  return page('You are unsubscribed', 'No more account email from Sportsvyn. Your account and your drafts are untouched.');
}

/**
 * ONE-CLICK UNSUBSCRIBE (RFC 8058). The mail carries
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so Gmail and Apple
 * Mail POST to the same signed URL - body `List-Unsubscribe=One-Click` - and
 * never open a page. Until wed-2 this route had only GET, so every native
 * Unsubscribe button got a 405 and nobody was taken off. The signature in the
 * query string is the authority, exactly as for the browser link; the body is
 * not required, because a client that sends it differently must still work.
 */
export async function POST(request) {
  const r = await optOut(request);
  const status = r === 'done' ? 200 : r === 'failed' ? 500 : 400;
  return new Response(r === 'done' ? 'unsubscribed' : r, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
