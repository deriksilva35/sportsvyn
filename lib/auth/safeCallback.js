/**
 * lib/auth/safeCallback.js - the ONE rule for where sign-in may send a reader.
 *
 * A callbackUrl arrives from the query string, i.e. from whoever wrote the
 * link. Every sign-in path (the email-code form's router.push, Auth.js's
 * redirect callback for Apple and the magic link, the sign-in href builders,
 * the join-code reader) runs it through this function first, so an open
 * redirect cannot be reopened by one path that forgot.
 *
 * SAME ORIGIN ONLY. A value is kept, unchanged, when it is either
 *   - a site-relative path: one leading "/", NOT "//" (protocol-relative),
 *     no backslash anywhere (browsers read "\" as "/", so "/\evil.com" is
 *     "//evil.com"), no control characters (the URL parser strips tab and
 *     newline, so "/\t/evil.com" is "//evil.com"), and not one whose single
 *     decode starts "//" or "/\"; or
 *   - an absolute http(s) URL whose host is sportsvyn.com, www.sportsvyn.com,
 *     or the host serving this request, with no credentials in it.
 * Anything else - another host, a lookalike suffix (sportsvyn.com.evil.com),
 * javascript:/data: schemes, a non-string - becomes "/".
 *
 * Pure: no DB, no request access. The caller passes the request host.
 */

export const SAFE_FALLBACK = '/';
export const OUR_HOSTS = Object.freeze(['sportsvyn.com', 'www.sportsvyn.com']);

// C0 controls, DEL, and whitespace the URL parser would silently drop or that
// have no business in a path we hand to a redirect.
const UNSAFE_CHARS = /[\u0000-\u0020\u007f\\]/;

function isSafeRelative(s) {
  if (s[0] !== '/') return false;
  if (s[1] === '/') return false;
  if (UNSAFE_CHARS.test(s)) return false;
  let decoded;
  try { decoded = decodeURIComponent(s); } catch { return false; }
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return false;
  // Belt and braces: resolve against a sentinel origin and insist it stayed.
  try {
    const base = 'https://sentinel.invalid';
    return new URL(s, base).origin === base;
  } catch { return false; }
}

function isOurAbsolute(s, requestHost) {
  if (UNSAFE_CHARS.test(s)) return false;
  let u;
  try { u = new URL(s); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  const host = u.host.toLowerCase();
  const req = requestHost ? String(requestHost).toLowerCase() : null;
  if (req && host === req) return true;
  // Our public hosts: https only, default port only.
  return u.protocol === 'https:' && OUR_HOSTS.includes(host);
}

/**
 * @param {unknown} raw          the callbackUrl as received
 * @param {object}  [opts]
 * @param {string}  [opts.host]  the request's Host (e.g. 'localhost:3000')
 * @returns {string} raw unchanged when same-origin, else "/"
 */
export function safeCallback(raw, { host } = {}) {
  if (typeof raw !== 'string' || raw.length === 0) return SAFE_FALLBACK;
  if (isSafeRelative(raw)) return raw;
  if (isOurAbsolute(raw, host)) return raw;
  return SAFE_FALLBACK;
}

/**
 * Auth.js callbacks.redirect, enforcing safeCallback. Auth.js calls it with
 * the incoming callbackUrl AND with the value it stored in its cookie (already
 * absolute on baseUrl), and expects an absolute URL back.
 */
export function authRedirect({ url, baseUrl }) {
  let host = null;
  try { host = new URL(baseUrl).host; } catch { /* no base: our hosts only */ }
  const safe = safeCallback(url, { host });
  if (safe.startsWith('/')) return `${baseUrl}${safe}`;
  return safe;
}
