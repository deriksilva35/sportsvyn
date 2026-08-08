/**
 * lib/auth/firstSeen.js — how an account arrived, written once at creation.
 *
 * users.first_seen_context (migration 058) answers the question launch week
 * could not: six organic signups, four of whom never started a draft, and
 * nothing recorded where any of them came from.
 *
 * THE VALUE IS TWO CLOSED VOCABULARIES, joined by a colon:
 *
 *     <auth>:<surface>        email:web · email:shell · apple:web · apple:shell
 *
 * Closed on purpose. A free-text provenance column becomes a landfill of
 * one-off strings nobody can group by six weeks later; two enums can be counted
 * with a GROUP BY and read at a glance. Anything unrecognised resolves to the
 * safe end of each axis rather than inventing a new token.
 *
 * SET ONCE, NEVER UPDATED. markFirstSeen only writes where the column IS NULL,
 * so a later sign-in cannot rewrite how the account originally arrived - which
 * is the only thing this column is for. That also makes it idempotent: running
 * it twice is the same as running it once.
 *
 * EXISTING ROWS STAY NULL. There is no backfill and no inference from session
 * timestamps; NULL says "we did not record this", which is true, and is the same
 * doctrine 058 applied to created_at.
 *
 * NOTHING HERE MAY BREAK A SIGN-UP. Every function swallows its own failures:
 * an account that exists without provenance is a small gap in analytics, while
 * an account that failed to be created is a lost user.
 */

export const AUTH_APPLE = 'apple';
export const AUTH_EMAIL = 'email';
export const SURFACE_SHELL = 'shell';
export const SURFACE_WEB = 'web';

const AUTHS = new Set([AUTH_APPLE, AUTH_EMAIL]);
const SURFACES = new Set([SURFACE_SHELL, SURFACE_WEB]);

/**
 * Build the stored value. Unknown inputs fall back rather than throw or invent:
 * an unrecognised auth route reads as email (the path that does not require a
 * provider handshake) and an unrecognised surface as web (the larger, default
 * surface). A wrong-but-in-vocabulary value is countable; a novel token is not.
 */
export function firstSeenContext(auth, surface) {
  const a = AUTHS.has(auth) ? auth : AUTH_EMAIL;
  const s = SURFACES.has(surface) ? surface : SURFACE_WEB;
  return `${a}:${s}`;
}

/**
 * Which surface this request came from, read from the shell cookie the native
 * container persists (components/sim/ShellPersist).
 *
 * Never throws: cookies() is unavailable in some server contexts, and a signup
 * must not fail because we could not label it. Anything unreadable is 'web'.
 */
export async function resolveSurface() {
  try {
    const { cookies } = await import('next/headers');
    const { SHELL_COOKIE, SHELL_VALUE } = await import('../shell/constants.js');
    const jar = await cookies();
    return jar.get(SHELL_COOKIE)?.value === SHELL_VALUE ? SURFACE_SHELL : SURFACE_WEB;
  } catch {
    return SURFACE_WEB;
  }
}

/**
 * Stamp a newly created user, once.
 *
 * The `IS NULL` guard is the "set once" rule in the statement itself rather than
 * in a caller's discipline - both creation sites go through here, and neither
 * can accidentally rewrite an existing value.
 */
export async function markFirstSeen(sql, userId, context) {
  if (userId == null || !context) return false;
  try {
    const rows = await sql`
      UPDATE users SET first_seen_context = ${context}
       WHERE id = ${userId} AND first_seen_context IS NULL
       RETURNING id`;
    return rows.length > 0;
  } catch (e) {
    // A missing column (migration not applied here) or any write failure is
    // swallowed: provenance is worth having, never worth a failed signup.
    console.error('[first-seen] could not stamp', { userId, context, message: e?.message });
    return false;
  }
}
