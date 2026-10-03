'use server';

/**
 * app/actions/age.js - the age screen's one answer.
 *
 * A thin door, like the others: the session is resolved here, the database
 * work is lib/auth/ageGateDb.js applyAnswer (tested against DEV), and this file
 * only owns what a lib cannot - the cookies.
 *
 *   stored   -> the per-session pass marker (sv_age), then the client goes on
 *   underage -> the account is gone (applyAnswer), the session cookie is
 *               cleared, and the long-lived refusal cookie (sv_age_block) is
 *               set, so a back-button retry with a new date in this browser is
 *               refused whatever it says. The client also sets the device flag.
 *
 * `deviceBlocked` is the client's localStorage flag. It can only make the
 * answer stricter: a client that lies about it lies in the refusing direction.
 */

import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { applyAnswer, accountFacts } from '@/lib/auth/ageGateDb';
import { AGE_BLOCK_COOKIE, AGE_OK_COOKIE, SESSION_COOKIES, AGE_BLOCKED_PATH, safeNext, sessionTokenFrom } from '@/lib/auth/ageGate';
import { ageCookieValue, AGE_COOKIE_MAX_AGE } from '@/lib/auth/ageCookie';

const MESSAGES = {
  incomplete: 'Choose a month, a day and a year.',
  invalid: 'That date does not look right. Check it and try again.',
};

export async function submitDateOfBirth(fields, next, deviceBlocked = false) {
  const jar = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  const blocked = Boolean(jar.get(AGE_BLOCK_COOKIE)?.value) || deviceBlocked === true;

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) {
    // Signed out on the form: the back button after a refusal lands here. The
    // answer is refused if this browser was refused; otherwise there is no
    // account to answer for.
    return blocked ? { ok: false, blocked: true, next: AGE_BLOCKED_PATH } : { ok: false, message: 'Sign in first.' };
  }

  const facts = await accountFacts(userId).catch(() => null);
  const res = await applyAnswer(sql, {
    userId, email: facts?.email ?? session.user?.email ?? null, createdAt: facts?.created_at ?? null,
    fields: { month: fields?.month, day: fields?.day, year: fields?.year }, blocked,
  });

  if (res.outcome === 'stored') {
    const token = sessionTokenFrom((n) => jar.get(n)?.value);
    jar.set(AGE_OK_COOKIE, ageCookieValue(token), {
      httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: AGE_COOKIE_MAX_AGE,
    });
    return { ok: true, next: safeNext(next) };
  }
  if (res.outcome === 'underage') {
    // SIGNED OUT. The sessions rows are already deleted; this clears the
    // cookie too. A __Secure- cookie is only overwritten by a Secure write.
    for (const n of SESSION_COOKIES) {
      jar.set(n, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: n.startsWith('__Secure-') || secure });
    }
    jar.set(AGE_OK_COOKIE, '', { path: '/', maxAge: 0 });
    jar.set(AGE_BLOCK_COOKIE, '1', {
      httpOnly: true, sameSite: 'lax', path: '/', secure, maxAge: AGE_COOKIE_MAX_AGE,
    });
    return { ok: false, blocked: true, next: AGE_BLOCKED_PATH };
  }
  return { ok: false, message: MESSAGES[res.reason] ?? MESSAGES.invalid };
}
