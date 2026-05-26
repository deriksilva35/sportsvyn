/**
 * app/api/email/signup/route.js
 *
 * Public email signup endpoint. The homepage form POSTs to
 * /api/email/signup with { email, source?, utm_source?, utm_medium?,
 * utm_campaign? }. Three outcomes, all returning { success: true }:
 *
 *   - new row -> INSERT + send confirmation email
 *   - unconfirmed dupe -> rotate token, UPDATE confirmation_sent_at,
 *                         resend confirmation email
 *   - already-confirmed dupe -> silent 200 (no DB write, no email)
 *
 * Why silent 200 on the already-confirmed dupe (and on validation-
 * passing duplicates generally): distinguishing "you're already in"
 * from "you're new" leaks list membership and creates an enumeration
 * oracle. User-facing UX is identical across all three branches.
 *
 * Send behavior:
 *   We await the Resend send but wrap it to swallow errors and log
 *   to console.error. If the email fails to deliver the row still
 *   exists and the user sees the same success message -- surfacing
 *   the provider failure to the user wouldn't give them a useful
 *   recovery action. The admin CSV at /admin/signups reveals any
 *   row with confirmation_token populated but never confirmed --
 *   that's the manual debug path for Phase 0.
 *
 * Deferred concerns (intentionally NOT here yet):
 *   - Rate limiting. Endpoint is open; abuse mitigation likely lands
 *     as Routing Middleware + Upstash in a later session.
 *   - Bounce/complaint webhooks. Resend dashboard is the manual
 *     triage surface for Phase 0; webhook signature verification is
 *     deferred (Session 3c.1 or later).
 *   - sports_interests capture. Column exists; homepage form does
 *     not yet collect it.
 */

import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/db';
import { resend, EMAIL_FROM, EMAIL_REPLY_TO } from '@/lib/resend';
import { buildConfirmationEmail } from '@/lib/emails/confirmation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_URL}`;

async function sendConfirmation(to, token) {
  try {
    const confirmUrl = `${BASE_URL}/api/email/confirm?token=${token}`;
    const { subject, html, text } = buildConfirmationEmail({ confirmUrl });
    await resend.emails.send({
      from: EMAIL_FROM,
      to,
      replyTo: EMAIL_REPLY_TO,
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error('confirmation email send failed:', { to, err });
  }
}

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

  const safeSource =
    typeof source === 'string' && source.length <= 128 ? source : 'homepage';
  const safeUtmSource =
    typeof utm_source === 'string' && utm_source.length <= 128 ? utm_source : null;
  const safeUtmMedium =
    typeof utm_medium === 'string' && utm_medium.length <= 128 ? utm_medium : null;
  const safeUtmCampaign =
    typeof utm_campaign === 'string' && utm_campaign.length <= 128 ? utm_campaign : null;

  try {
    const insertToken = randomBytes(32).toString('hex');
    await sql`
      INSERT INTO email_signups (
        email,
        source,
        utm_source,
        utm_medium,
        utm_campaign,
        confirmation_token,
        confirmation_sent_at
      ) VALUES (
        ${normalizedEmail},
        ${safeSource},
        ${safeUtmSource},
        ${safeUtmMedium},
        ${safeUtmCampaign},
        ${insertToken},
        now()
      )
    `;
    await sendConfirmation(normalizedEmail, insertToken);
    return Response.json({ success: true });
  } catch (err) {
    if (err?.code === '23505') {
      const [existing] = await sql`
        SELECT confirmed_at
        FROM email_signups
        WHERE email = ${normalizedEmail}
        LIMIT 1
      `;

      if (!existing || existing.confirmed_at) {
        return Response.json({ success: true });
      }

      const resendToken = randomBytes(32).toString('hex');
      await sql`
        UPDATE email_signups
        SET confirmation_token = ${resendToken},
            confirmation_sent_at = now()
        WHERE email = ${normalizedEmail}
      `;
      await sendConfirmation(normalizedEmail, resendToken);
      return Response.json({ success: true });
    }
    console.error('email signup error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
