'use client';

// components/time/ViewerTz.js - which zone a time on this page renders in.
//
// THE CHOICE (sun-16 item B), and why it is this one.
//
// A server render cannot know the reader's zone: it is not in the request.
// Three ways to live with that, two of them rejected:
//   - render UTC (or nothing) and let the client fill in: every time on the
//     page jumps after hydration, and an unlabelled UTC hour reads as a
//     schedule error (measured on /nfl: a day header a full day off);
//   - render client-only: the time is missing from the HTML, the row is a
//     different width until JS runs - layout shift on every visit, forever;
//   - THE COOKIE (kept): components/gridiron/TzCookie writes sv_tz once a
//     session from the browser's own answer (mounted in app/layout.js, so every
//     page writes it), the page reads it on the server (readViewerTz) and puts
//     it in this context, and every time below renders in the reader's zone in
//     the HTML itself. Hydration agrees, nothing moves.
// The ONE visit with no cookie - the very first - renders the Eastern fallback
// WITH its label ("1:00 PM ET"), so even that paint is never an unlabelled
// guess, and settles on the device's zone after mount.
//
// HOW: useSyncExternalStore. Its server snapshot is the zone the page knows
// (the cookie, or null = the labelled ET fallback) - so the server HTML and the
// hydrating render match byte for byte - and its client snapshot is the
// device's zone, which React switches to straight after hydration only when the
// two differ. No effect, no second render for a reader whose cookie is right.

import { createContext, useContext, useSyncExternalStore } from 'react';
import { browserTz } from '@/lib/gridiron/viewerTz';

const ViewerTzContext = createContext(null);

/** Wrap a page's content: `tz` is the server's read of sv_tz (or null). */
export function ViewerTzProvider({ tz = null, children }) {
  return <ViewerTzContext.Provider value={tz ?? null}>{children}</ViewerTzContext.Provider>;
}

const subscribe = () => () => {};

/**
 * The zone to format in: the device's own once hydrated; before that (and on
 * the server) `serverTz` if given, else the provider's, else null - which
 * lib/time/display.js renders as the labelled Eastern fallback.
 */
export function useViewerZone(serverTz = null) {
  const fromPage = useContext(ViewerTzContext);
  const known = serverTz ?? fromPage ?? null;
  return useSyncExternalStore(subscribe, () => browserTz() ?? known, () => known);
}
