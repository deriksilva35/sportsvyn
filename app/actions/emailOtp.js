'use server';

/**
 * Server Action: verify a 6-digit email sign-in code. Delegates the DB logic to
 * lib/auth/emailOtp.js (unit-tested), then — on success — sets the same database
 * session cookie Auth.js would, so auth() recognizes the session. The cookie name
 * mirrors Auth.js: __Secure-authjs.session-token on https (prod), authjs.session-
 * token otherwise. Failures return a typed reason; the raw code/secret never leave.
 */

import { cookies } from 'next/headers';
import { sql } from '@/lib/db';
import { redeemEmailCode } from '@/lib/auth/emailOtp';

export async function verifyEmailCode(email, code) {
  const secret = process.env.AUTH_SECRET;
  const res = await redeemEmailCode(sql, { email, code, secret });
  if (!res.ok) return { ok: false, reason: res.reason, remaining: res.remaining };

  const secure = process.env.NODE_ENV === 'production';
  const name = `${secure ? '__Secure-' : ''}authjs.session-token`;
  (await cookies()).set(name, res.sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    expires: res.sessionExpires,
  });
  return { ok: true };
}
