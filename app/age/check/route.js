/**
 * GET /age/check?next=/path - where the proxy sends a signed-in page request
 * whose session has no age marker yet (proxy.js, lib/auth/ageGate.js).
 *
 * ONE READ, THEN A REDIRECT:
 *   no valid session (a stale cookie)  -> mark this token checked, go on
 *   already answered (13+)             -> set the marker, go on
 *   this browser was refused before    -> the answer is refused again: the
 *                                         account sign-up just made is deleted,
 *                                         the session cleared -> /age/blocked
 *   never answered                     -> /age, the form
 *
 * A route handler and not the page, because a page cannot set a cookie.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { hasPassed, applyAnswer, accountFacts } from '@/lib/auth/ageGateDb';
import {
  AGE_BLOCK_COOKIE, AGE_OK_COOKIE, AGE_PATH, AGE_BLOCKED_PATH, SESSION_COOKIES, safeNext, sessionTokenFrom,
} from '@/lib/auth/ageGate';
import { ageCookieValue, AGE_COOKIE_MAX_AGE } from '@/lib/auth/ageCookie';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const secure = process.env.NODE_ENV === 'production';
  const token = sessionTokenFrom((n) => request.cookies.get(n)?.value);
  const blocked = Boolean(request.cookies.get(AGE_BLOCK_COOKIE)?.value);
  const go = (path) => NextResponse.redirect(new URL(path, request.url), 307);
  const pass = (res) => {
    if (token) {
      res.cookies.set(AGE_OK_COOKIE, ageCookieValue(token), {
        httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: AGE_COOKIE_MAX_AGE,
      });
    }
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  };

  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  // A COOKIE WITH NO LIVE SESSION BEHIND IT. Marking the token checked is what
  // stops the proxy sending it here forever; it is signed out for every door.
  if (userId == null) return pass(go(next));

  if (await hasPassed(userId)) return pass(go(next));

  if (blocked) {
    const facts = await accountFacts(userId).catch(() => null);
    await applyAnswer(sql, {
      userId, email: facts?.email ?? null, createdAt: facts?.created_at ?? null, fields: {}, blocked: true,
    });
    const res = go(AGE_BLOCKED_PATH);
    for (const n of SESSION_COOKIES) {
      res.cookies.set(n, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: n.startsWith('__Secure-') || secure });
    }
    res.headers.set('Cache-Control', 'private, no-store');
    return res;
  }

  const res = go(`${AGE_PATH}?next=${encodeURIComponent(next)}`);
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
