/**
 * app/api/email/confirm/route.js
 *
 * Closes the confirmation loop. The signup endpoint emails a tokenized
 * link; this endpoint validates the token, flips confirmed_at, and
 * redirects to the brand-styled /confirmed page.
 *
 * Every outcome is a 303 redirect to /confirmed (with ?error=invalid
 * or ?error=expired on the failure paths). 303 specifically so that
 * a browser refresh on /confirmed won't replay the GET.
 *
 * Validation order:
 *   1. missing / empty token   -> /confirmed?error=invalid
 *   2. no row matches token    -> /confirmed?error=invalid
 *   3. confirmation_sent_at older than 7d (or NULL)
 *                              -> /confirmed?error=expired
 *   4. otherwise               -> mark confirmed, redirect /confirmed
 *
 * The expiry comparison happens in SQL (now() - interval '7 days') so
 * we use the database's notion of "now" -- no clock-skew risk between
 * function and DB host.
 */

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ?? `https://${process.env.VERCEL_URL}`;

function redirect(path) {
  return NextResponse.redirect(new URL(path, BASE_URL), 303);
}

export async function GET(request) {
  const token = new URL(request.url).searchParams.get('token');

  if (!token) {
    return redirect('/confirmed?error=invalid');
  }

  const rows = await sql`
    SELECT
      id,
      (confirmation_sent_at IS NULL
        OR confirmation_sent_at < now() - interval '7 days') AS expired
    FROM email_signups
    WHERE confirmation_token = ${token}
    LIMIT 1
  `;
  const row = rows[0];

  if (!row) {
    return redirect('/confirmed?error=invalid');
  }

  if (row.expired) {
    return redirect('/confirmed?error=expired');
  }

  await sql`
    UPDATE email_signups
    SET confirmed_at = now(),
        confirmation_token = NULL
    WHERE id = ${row.id}
  `;

  return redirect('/confirmed');
}
