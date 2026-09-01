// lib/gridiron/serverTz.js — the server's read of the reader's timezone.
//
// ITS OWN FILE because it imports next/headers, which is server-only, while
// viewerTz.js is imported by a client component. Putting the cookie read beside
// the hook would drag next/headers into the client bundle and fail the build.

import { cookies } from 'next/headers';
import { TZ_COOKIE, safeTz } from './viewerTz.js';

/** The reader's zone from the cookie, or null on a cold visit. */
export async function readViewerTz() {
  try {
    const jar = await cookies();
    return safeTz(jar.get(TZ_COOKIE)?.value ?? null);
  } catch { return null; }
}
