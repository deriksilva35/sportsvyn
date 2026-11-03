// crew/lib/lobbyProbe.mjs - lobby-probe: does the lobby render for a signed-in reader (3 Nov outage).
//
// GET / as the crew probe account (users.is_probe, scripts/crew-probe-account.mjs) with its long-lived
// session token from <secrets>/probe.token, then read the two machine markers the lobby renders
// (components/games/LobbyMain.js, components/games/LobbyHealth.js, lib/games/lobbySection.js):
//   data-sv-lobby-error                 the whole-lobby "having a moment" state (lobbyV3 itself threw)
//   data-sv-lobby-health data-modules data-hidden data-hidden-names data-signed-in
//                                       how many modules ran and which were hidden by an error
// No arguments. Read only: one GET, no write, nothing stored. Never prints the token or the cookie.
//
// THE COOKIES. Auth.js database sessions: `__Secure-authjs.session-token` on https, `authjs.session-token` on
// http (lib/auth/ageGate.js SESSION_COOKIES). The proxy also sends a signed-in page navigation without the
// per-session age marker (`sv_age`, lib/auth/ageCookie.js: sha256("sv-age:" + token)[0..32]) through /age/check
// first, so the probe sends that marker too (it is a router, not the gate; the probe account has a date of birth).
//
// OUTCOMES (the SUMMARY is `lobby-probe status=<ok|regression|error> modules=N hidden=N reason=...`):
//   exit 0 ok            200, marker present, signed-in, hidden=0, no error state
//   exit 1 regression    reason=error_page | hidden:<name,name> | no_marker | http_<5xx>
//   exit 2 setup error   auth:probe.token (no/empty token, session expired or revoked, redirect to sign-in/age),
//                        timeout:<host>, unreachable:<host>, not_found:args
import { createHash } from 'node:crypto';
import { parseArgs, readToken, rememberSecret, SetupError, networkError, statusError, HTTP_TIMEOUT_MS } from './common.mjs';

export const DEFAULT_URL = 'https://sportsvyn.com/';
const TOKEN_FILE = 'probe.token';
const UA = 'sportsvyn-crew-lobby-probe/1'; // must NOT contain the native shell's UA token

const hostOf = (url) => { try { return new URL(url).host; } catch { return 'unknown'; } };

/** The per-session age marker, as lib/auth/ageCookie.js computes it (kept in step by lobbyProbe.test.mjs). */
export function ageMarker(token) {
  return createHash('sha256').update(`sv-age:${token}`).digest('hex').slice(0, 32);
}

/** The Cookie header for this URL's scheme. */
export function cookieHeader(url, token) {
  const secure = new URL(url).protocol === 'https:';
  return `${secure ? '__Secure-' : ''}authjs.session-token=${token}; sv_age=${ageMarker(token)}`;
}

/** The open tag (as text) of the first element carrying `attr`, or null. Attribute names only inside a tag. */
function tagWith(html, attr) {
  const m = new RegExp(`<[a-zA-Z][^>]*\\s${attr}(?=[\\s=/>])[^>]*>`).exec(html);
  return m ? m[0] : null;
}
const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

/** PURE. html -> { error, marker: null | { modules, hidden, names, signedIn } }. */
export function readMarkers(html) {
  const error = tagWith(html, 'data-sv-lobby-error') != null;
  const tag = tagWith(html, 'data-sv-lobby-health');
  if (!tag) return { error, marker: null };
  const num = (n) => { const v = Number(attrOf(tag, n)); return Number.isInteger(v) && v >= 0 ? v : null; };
  const names = (attrOf(tag, 'data-hidden-names') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const modules = num('data-modules');
  const hidden = num('data-hidden');
  if (modules == null || hidden == null) return { error, marker: null };
  return { error, marker: { modules, hidden: Math.max(hidden, names.length), names, signedIn: attrOf(tag, 'data-signed-in') === '1' } };
}

const regression = (reason, extra = {}, lines = []) => ({
  lines, summary: { status: 'regression', modules: extra.modules ?? '-', hidden: extra.hidden ?? '-', reason }, code: 1,
});

export async function main({ argv, env }) {
  parseArgs(argv, []);
  const token = readToken(TOKEN_FILE, env);
  if (!token) throw new SetupError('probe.token is missing or empty (secrets dir)', 'auth', TOKEN_FILE);
  const url = env.CREW_PROBE_URL || DEFAULT_URL;
  if (!/^https?:\/\//i.test(url)) throw new SetupError('CREW_PROBE_URL must be http(s)', 'not_found', 'args');
  const host = hostOf(url);
  const cookie = cookieHeader(url, token);
  rememberSecret(cookie);
  rememberSecret(ageMarker(token));

  let status; let html;
  try {
    const res = await fetch(url, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { cookie, 'user-agent': UA, accept: 'text/html', 'cache-control': 'no-cache' },
    });
    status = res.status;
    html = status >= 300 && status < 400 ? '' : await res.text(); // inside the try: the timeout can fire mid-body
    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location') ?? '';
      if (/\/signin|\/age(\/|\?|$)/.test(loc)) throw new SetupError('session not accepted (redirect to sign-in / age screen)', 'auth', TOKEN_FILE);
      throw new SetupError(`unexpected redirect (HTTP ${status})`, 'unreachable', host);
    }
  } catch (e) {
    throw e instanceof SetupError ? e : networkError(e, 'lobby request', host);
  }

  if (status >= 500) return regression(`http_${status}`);
  if (status !== 200) throw statusError(status, 'lobby request', host);

  const { error, marker } = readMarkers(html);
  if (error) return regression('error_page', marker ? { modules: marker.modules, hidden: marker.hidden } : {}, ['lobby: whole-lobby error state is showing']);
  if (!marker) return regression('no_marker', {}, ['lobby: 200 but no data-sv-lobby-health marker in the page']);
  if (!marker.signedIn) throw new SetupError('lobby rendered signed out: probe.token is expired or revoked', 'auth', TOKEN_FILE);
  if (marker.hidden > 0) {
    const lines = marker.names.map((n) => `lobby: module hidden by error: ${n}`);
    const reason = `hidden:${marker.names.length ? marker.names.join(',') : 'unnamed'}`;
    return regression(reason, { modules: marker.modules, hidden: marker.hidden }, lines);
  }
  return { lines: [], summary: { status: 'ok', modules: marker.modules, hidden: 0, reason: '-' }, code: 0 };
}
