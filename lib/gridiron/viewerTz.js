// lib/gridiron/viewerTz.js — which timezone the reader is actually in.
//
// THE CARD USED TO HARDCODE AMERICA/NEW_YORK and append " ET". That is honest
// for a reader in New York and wrong for everyone else - and the label made it
// worse rather than better, because "5:20 PM ET" asks a reader in Denver to do
// arithmetic on every card on the screen to find out whether they can watch.
//
// THE SERVER CANNOT KNOW. A timezone is not in a request: not in a header, not
// in the URL, not derivable from an IP we do not look at. Only the browser
// knows it, so the answer has to make a round trip.
//
// I TRIED THE SMALLER MECHANISM FIRST AND MEASURED IT FAILING. The plan was to
// render UTC on the server with no zone label and let hydration correct it -
// briefly imprecise, never a lie. On a real render of /nfl that fallback
// produced DAY HEADERS a full day off: NE at SEA is 00:20Z on the 10th, so the
// server wrote "Thursday · Sep 10" where the reader's screen would say
// "Wednesday · Sep 9". An unlabelled time being an hour out is a small thing to
// fix at hydration; a sticky header naming the wrong day of the week, above the
// game it names, is not, and the correction is a visible jump on the one
// element the eye is anchored to.
//
// SO THE ZONE RIDES A COOKIE. sv_tz is written once, client-side, from the
// browser's own answer; the server reads it and renders the right thing from
// then on, with no swap at all. The FIRST view of a session still has no cookie
// and still falls back to UTC unlabelled - that case cannot be removed, only
// made rare, because the first request is the one that has nothing to read.
//
// This is the same shape as sv_shell: a fact only the client can know, written
// once, read by the server thereafter. It is deliberately NOT in the proxy -
// the proxy sets shell mode from things that are IN the request, and a timezone
// never is.

// PURE, AND DELIBERATELY REACT-FREE. The server reads sv_tz through
// lib/gridiron/serverTz (which imports next/headers) and the board reads it
// through components/gridiron/useViewerTz (which imports a React hook). Neither
// of those can import the other's module, so the pieces they SHARE - the cookie
// name, the validator, the fallback - live here, where both sides can reach
// them. An earlier draft put the hook in this file and the build refused it:
// a server component cannot import a module that pulls in useSyncExternalStore.

export const TZ_COOKIE = 'sv_tz';

export const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch { return null; }
};

/** What to format with: the reader's zone, or UTC while we do not know. */
export const tzOrUtc = (tz) => tz ?? 'UTC';

/**
 * Validate a cookie value before trusting it as a zone.
 *
 * A COOKIE IS READER-CONTROLLED INPUT. It is handed straight to
 * Intl.DateTimeFormat's timeZone option, which THROWS on a value it does not
 * recognise - so an edited cookie would take out every card on the board rather
 * than degrade one. Checked here, once, on the way in.
 */
export function safeTz(value) {
  if (typeof value !== 'string' || !value || value.length > 64) return null;
  if (!/^[A-Za-z0-9+_\-]+(\/[A-Za-z0-9+_\-]+)*$/.test(value)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch { return null; }
}
