// lib/appBanner.js — the "get the app" banner's flag and its one decision.
//
// PURE (no React, no next/*, no DB) so the server wrapper, the client island,
// and a node test all read the same answer. lib/aasa.js already holds the app's
// identity (87BX25MUHY.com.sportsvyn.draftvyn); this holds where to send people
// to install it.
//
// THE FLAG IS APP_STORE_URL, read at request time on the SERVER.
// It ships DARK: Draftvyn is not approved yet, so the var is empty in Vercel and
// appStoreUrl() returns null, so nothing renders anywhere. On approval Derik
// pastes the real listing URL into the Vercel env and redeploys - no code change,
// no migration. Deliberately NOT NEXT_PUBLIC_: a public var is inlined into the
// client bundle at BUILD time, which would mean the banner's on/off state was
// frozen into a build artifact. Reading it server-side keeps flipping the flag a
// pure environment change, and keeps the URL out of the JS bundle until it's real.
//
// THE URL IS VALIDATED, NOT TRUSTED. A half-pasted, http://, or wrong-host value
// leaves the banner dark rather than shipping a broken or off-brand outbound link
// to every mobile visitor. The failure mode of a typo is "no banner", never "a
// banner that goes somewhere strange".

export const APP_STORE_URL_ENV = 'APP_STORE_URL';

// Apple serves listings from apps.apple.com; itunes.apple.com is the legacy host
// that still 301s there, so an older-format URL is accepted rather than silently
// dropped. Nothing else is.
const APP_STORE_HOSTS = new Set(['apps.apple.com', 'itunes.apple.com']);

// localStorage, not a cookie: dismissal is a pure browser-side preference that no
// server render depends on, and keeping it out of the cookie jar keeps it off
// every request. Web-only by construction - the banner never renders in the
// shell, so the native webview never writes this key.
export const APP_BANNER_DISMISS_KEY = 'sv_app_banner';
export const APP_BANNER_DISMISSED = 'dismissed';

/**
 * Normalize a candidate App Store URL. Returns the canonical string, or null if
 * the value is absent, unparseable, not https, or not an Apple store host.
 */
export function normalizeAppStoreUrl(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (!APP_STORE_HOSTS.has(u.hostname.toLowerCase())) return null;
  return u.toString();
}

/**
 * The flag, read from the environment. `env` is injectable so tests never touch
 * process.env. The lookup is a COMPUTED key on purpose: `process.env.APP_STORE_URL`
 * written literally is a candidate for build-time inlining, and this value has to
 * be resolved per request so that setting it in Vercel takes effect on redeploy
 * without the flag having been baked into an earlier build.
 */
export function appStoreUrl(env = process.env) {
  return normalizeAppStoreUrl(env?.[APP_STORE_URL_ENV]);
}

/**
 * The whole decision, in one place.
 *
 * SHELL IS THE HARD RULE: the app must never advertise itself. A "download our
 * app" banner inside the app is at best absurd, and to an App Store reviewer it
 * reads as a link out of the container to a store listing. Shell is checked
 * FIRST, so no flag configuration can turn it on in the native wrapper.
 */
export function shouldShowAppBanner({ shell = false, url = null } = {}) {
  if (shell) return false;
  return normalizeAppStoreUrl(url) != null;
}
