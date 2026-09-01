'use client';

// components/gridiron/useViewerTz.js — the board's read of the reader's zone.
//
// SPLIT FROM lib/gridiron/viewerTz BECAUSE OF THE IMPORT GRAPH, not because the
// idea is in two pieces. That module is imported by a SERVER component (through
// serverTz, to read the cookie) and a server component may not import a module
// that pulls in a React hook - the build says so plainly. So the shared, pure
// half stays there and the hook lives here.

import { useSyncExternalStore } from 'react';
import { browserTz } from '@/lib/gridiron/viewerTz';

const subscribe = () => () => {};
const getSnapshot = () => browserTz() ?? 'UTC';

/**
 * The reader's IANA zone, or null until we know it.
 *
 * NULL, NOT 'UTC', WHEN WE DO NOT KNOW. The card has to tell "the reader is in
 * UTC" from "we have not been told yet", because only the second may fall back
 * to a zone-neutral render. Returning 'UTC' would make the two identical.
 *
 * `initial` is the SERVER's read of the sv_tz cookie, threaded down from the
 * page. It is the server snapshot, so a request carrying the cookie renders the
 * reader's own zone with no hydration swap at all.
 */
export function useViewerTz(initial = null) {
  return useSyncExternalStore(subscribe, getSnapshot, () => initial);
}
