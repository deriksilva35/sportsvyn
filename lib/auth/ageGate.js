// lib/auth/ageGate.js - the 13+ age screen's rules. PURE: no DB, no request,
// no node: imports, so the proxy, the server action, the route handler and the
// client form can all read the same definitions.
//
// THE SCREEN IS NEUTRAL (COPPA). It asks for a date of birth - month, day,
// year - with no default, no adult pre-fill and no copy that names the cutoff
// before the answer is in. MIN_AGE is used by the server to judge the answer
// and by the /age/blocked screen AFTER it; the form never renders it.
//
// THE GATE IS ONE QUESTION: is there a stored date of birth that makes this
// account 13 or older today? An under-13 answer is never stored (the account
// is deleted), so in practice a row either has an adult-or-teen date or NULL -
// but the verdict recomputes the age anyway, so a bad row cannot play.

export const MIN_AGE = 13;

/** The answer is refused: under MIN_AGE, or a device already refused. */
export const REASON_UNDERAGE = 'underage';
/** Signed in, never answered. Every write door returns this until they do. */
export const REASON_AGE_REQUIRED = 'age_required';

/** Long-lived per-browser refusal: set on an under-13 answer (400 days, the
 *  browser cap). Its presence alone refuses any later answer in this browser. */
export const AGE_BLOCK_COOKIE = 'sv_age_block';
/** Per-session "this session's account has passed" marker the proxy reads, so
 *  it never touches the database. Bound to the session token (ageCookie.js). */
export const AGE_OK_COOKIE = 'sv_age';
/** The client-side device flag (localStorage) - belt to the cookie's braces in
 *  the iOS WKWebView, which has no stable install id this repo can read. */
export const AGE_BLOCK_STORAGE_KEY = 'sv_age_block';

export const AGE_PATH = '/age';
export const AGE_CHECK_PATH = '/age/check';
export const AGE_BLOCKED_PATH = '/age/blocked';

/** Auth.js's database-session cookie, http (dev) and https (prod) names. */
export const SESSION_COOKIES = ['__Secure-authjs.session-token', 'authjs.session-token'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Parse the three fields into an ISO date string, or a typed refusal.
 * A real calendar date (no 31 Feb), not in the future, year >= 1900.
 * @returns {{ ok: true, iso: string } | { ok: false, reason: string }}
 */
export function parseDob({ month, day, year } = {}, now = new Date()) {
  const blank = (v) => v == null || String(v).trim() === '';
  if (blank(month) || blank(day) || blank(year)) return { ok: false, reason: 'incomplete' };
  const m = Number(month), d = Number(day), y = Number(year);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return { ok: false, reason: 'incomplete' };
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return { ok: false, reason: 'invalid' };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { ok: false, reason: 'invalid' };
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (dt.getTime() > today) return { ok: false, reason: 'invalid' };
  return { ok: true, iso: `${y}-${pad(m)}-${pad(d)}` };
}

/** Whole years between an ISO date (or Date) and `now`, birthday-exact (UTC). */
export function ageOn(dob, now = new Date()) {
  const s = dob instanceof Date ? dob.toISOString().slice(0, 10) : String(dob ?? '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Judge one submitted answer. `blocked` is true when this browser (cookie) or
 * install (device flag) has already been refused: then ANY date is refused,
 * which is what makes a back-button retry with an adult date fail.
 * @returns {{ ok: true, iso: string } | { ok: false, reason: string }}
 */
export function judgeAnswer(fields, { blocked = false, now = new Date() } = {}) {
  if (blocked) return { ok: false, reason: REASON_UNDERAGE };
  const p = parseDob(fields, now);
  if (!p.ok) return p;
  if (ageOn(p.iso, now) < MIN_AGE) return { ok: false, reason: REASON_UNDERAGE };
  return { ok: true, iso: p.iso };
}

/**
 * THE GATE. Every write door asks this of the user row (date_of_birth only).
 * @param {{ date_of_birth?: string|Date|null } | null} row
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function gateVerdict(row, now = new Date()) {
  if (!row || row.date_of_birth == null) return { ok: false, reason: REASON_AGE_REQUIRED };
  const age = ageOn(row.date_of_birth, now);
  if (age == null || age < MIN_AGE) return { ok: false, reason: REASON_UNDERAGE };
  return { ok: true };
}

/**
 * Paths a signed-in, unanswered reader may still load. Everything else that is
 * a page navigation goes to the age screen first. Signed-out readers never
 * reach this (the proxy only runs it when a session cookie is present).
 */
export function isAgeExempt(pathname) {
  const p = String(pathname || '/');
  if (p === AGE_PATH || p.startsWith(AGE_PATH + '/')) return true;
  if (p.startsWith('/_next/') || p.startsWith('/api/')) return true;
  if (p === '/admin' || p.startsWith('/admin/')) return true;
  if (p === '/signin' || p.startsWith('/signin/')) return true;
  // The legal pages the screen links to, and account deletion (5.1.1(v)):
  // deleting your account never requires answering first.
  if (['/terms', '/privacy', '/sim/account', '/account'].includes(p)) return true;
  // Files and generated images (favicon, robots, sitemap, manifest, OG cards).
  if (/\.[a-z0-9]+$/i.test(p)) return true;
  if (/\/(opengraph-image|twitter-image|icon|apple-icon)(\/|$)/.test(p)) return true;
  return false;
}

/** The session token from a cookie getter, whichever name this host uses. */
export function sessionTokenFrom(getCookie) {
  for (const n of SESSION_COOKIES) {
    const v = getCookie(n);
    if (v) return v;
  }
  return null;
}

/**
 * The proxy's decision, pure. Returns the redirect target (a relative URL) or
 * null to let the request through.
 *
 * ONLY PAGE NAVIGATIONS. GET/HEAD only: a server action is a POST to a page
 * path, and redirecting it would break the action rather than gate it - the
 * actions gate themselves (ageGateDb.js). Only with a session cookie, only
 * when the age marker does not match THIS session (expected = the hash the
 * caller computed from the token), and never on an exempt path.
 */
export function ageRedirectTarget({ method = 'GET', pathname, search = '', sessionToken, ageCookie, expected }) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (!sessionToken) return null;
  if (isAgeExempt(pathname)) return null;
  if (ageCookie && expected && ageCookie === expected) return null;
  return `${AGE_CHECK_PATH}?next=${encodeURIComponent(`${pathname}${search || ''}`)}`;
}

/** A `next` value we will redirect to: site-relative only, else '/games'. */
export function safeNext(raw) {
  const s = typeof raw === 'string' ? raw : '';
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\u0000-\u001f]/.test(s)) return '/games';
  if (s === AGE_PATH || s.startsWith(AGE_PATH + '/') || s.startsWith(AGE_PATH + '?')) return '/games';
  return s;
}
