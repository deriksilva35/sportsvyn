/**
 * app/api/email/signup/route.js
 *
 * Public email signup endpoint. The homepage form POSTs to /api/email/signup
 * with { email, source?, utm_source?, utm_medium?, utm_campaign? } and the
 * row is inserted into the `email_signups` table (see migration 001).
 *
 * Deferred concerns (intentionally NOT here yet):
 *   - Rate limiting. Endpoint is currently open; abuse mitigation lands in
 *     a later session (likely Routing Middleware + Upstash).
 *   - Resend confirmation email. The confirmation_token column is populated
 *     on insert so it's ready to use, but no email is sent yet (Session 3b).
 *   - sports_interests capture. The column exists, but the homepage form
 *     does not yet collect it; field is left NULL on insert.
 *
 * Silent-duplicate behavior — DO NOT "fix":
 *   If the email already exists (Postgres 23505 unique violation), we return
 *   { success: true } with HTTP 200. This is intentional: revealing that an
 *   address is already subscribed leaks membership and creates an enumeration
 *   oracle. The user-facing UX is identical whether the signup is new or
 *   already present.
 */

import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid email' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid email' }, { status: 400 });
  }

  const { email, source, utm_source, utm_medium, utm_campaign } = body;

  if (
    typeof email !== 'string' ||
    email.length > 320 ||
    !EMAIL_RE.test(email)
  ) {
    return Response.json({ error: 'Invalid email' }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase();
  const confirmationToken = randomBytes(32).toString('hex');

  const safeSource =
    typeof source === 'string' && source.length <= 128 ? source : 'homepage';
  const safeUtmSource =
    typeof utm_source === 'string' && utm_source.length <= 128 ? utm_source : null;
  const safeUtmMedium =
    typeof utm_medium === 'string' && utm_medium.length <= 128 ? utm_medium : null;
  const safeUtmCampaign =
    typeof utm_campaign === 'string' && utm_campaign.length <= 128 ? utm_campaign : null;

  try {
    await sql`
      INSERT INTO email_signups (
        email,
        source,
        utm_source,
        utm_medium,
        utm_campaign,
        confirmation_token
      ) VALUES (
        ${normalizedEmail},
        ${safeSource},
        ${safeUtmSource},
        ${safeUtmMedium},
        ${safeUtmCampaign},
        ${confirmationToken}
      )
    `;
    return Response.json({ success: true });
  } catch (err) {
    if (err?.code === '23505') {
      return Response.json({ success: true });
    }
    console.error('email signup error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
