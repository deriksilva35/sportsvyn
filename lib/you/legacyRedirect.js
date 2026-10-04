// lib/you/legacyRedirect.js - /my and /account are /you now (sun-16 D).
//
// THREE PAGES ANSWERED "ME": /my (the follow dashboard), /account (email,
// membership, sign out) and /you (the You tab, which already absorbed most of
// /account). Two of them go. Each is a PERMANENT 308 to /you, answered in the
// proxy so the old route is never rendered, with the query kept - a deep link
// like /account?from=email lands on /you?from=email - and every /my/* and
// /account/* subpath is caught too, so no old link can 404.
//
// PURE: the proxy and the two fallback page files call the same function.
// /sim/account is NOT one of them: it is the draft settings and the account
// deletion door (App Store 5.1.1(v)), and it stays where it is.

export const YOU_PATH = '/you';
/** The retired roots. proxy.js's matcher repeats them as literals (Next reads
 *  it statically); legacyRedirect.test.mjs pins the two lists together. */
export const LEGACY_YOU_ROOTS = Object.freeze(['/my', '/account']);

/** '/you' plus the original query for a retired path, else null. */
export function youRedirect(pathname, search = '') {
  const p = String(pathname ?? '');
  const hit = LEGACY_YOU_ROOTS.some((r) => p === r || p === `${r}/` || p.startsWith(`${r}/`));
  if (!hit) return null;
  const q = String(search ?? '').replace(/^\?/, '');
  return q ? `${YOU_PATH}?${q}` : YOU_PATH;
}

/** The same, from a page's awaited searchParams object (the fallback pages). */
export function youRedirectFromParams(pathname, sp = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp ?? {})) {
    for (const one of Array.isArray(v) ? v : [v]) if (one != null) q.append(k, String(one));
  }
  return youRedirect(pathname, q.toString());
}
