// lib/scores/top25Memory.js - the Top 25 filter remembers the reader's last choice.
//
// A COOKIE, NOT localStorage, because the server picks the games: a remembered
// filter that only the client knew would paint the full slate and then swap.
// The chip writes it on tap (components/scores/Top25Link); the page reads it
// only when the URL says nothing. An explicit ?top25=1 always wins, and the
// chip's own off-tap clears the cookie, so "absent" and "off" stay the same
// thing in every href this module's callers build.
//
// Where the filter cannot apply (no CFB game on the picked day, or a sport
// other than All / CFB) scoresV2Shape.top25State already ignores the flag, so
// a remembered "on" never empties a Saturday-less day.

export const TOP25_COOKIE = 'sv_top25';

/** The request's answer: the query when it has one, else the remembered value. */
export function wantTop25(queryValue, cookieValue) {
  if (queryValue != null) return queryValue === '1';
  return cookieValue === '1';
}

/** The Set-Cookie string document.cookie takes; a year, site-wide. */
export function top25CookieString(on) {
  return `${TOP25_COOKIE}=${on ? '1' : '0'}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** The server's read of the cookie. Its own import of next/headers is dynamic so
 *  this module stays loadable from client components and plain node tests. */
export async function readRememberedTop25() {
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get(TOP25_COOKIE)?.value ?? null;
  } catch { return null; }
}
