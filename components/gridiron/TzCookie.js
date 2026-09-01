'use client';

// components/gridiron/TzCookie.js — tells the server, once, what zone the
// reader is in.
//
// WHY A COOKIE AND NOT A PROP. A timezone is not in a request. The server has
// no way to know it on a cold visit, so the first render of a session falls
// back to UTC and the client corrects at hydration; every render after that
// reads this cookie and is right on the server, with no swap. That mattered
// enough to build because the fallback's error is not subtle: measured on
// /nfl, a UTC day header read "Thursday · Sep 10" for a game the reader's own
// screen calls Wednesday.
//
// SESSION COOKIE, like sv_shell. Someone on a laptop crossing a timezone gets
// the new zone next session rather than carrying the old one for a year, and
// the client-side read corrects the current one immediately regardless.
//
// IT WRITES ONLY WHEN THE ANSWER CHANGED, so a reader who does not move pays
// one cookie write per session rather than one per navigation.

import { useEffect } from 'react';
import { TZ_COOKIE } from '@/lib/gridiron/viewerTz';

export default function TzCookie() {
  useEffect(() => {
    let tz;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return; }
    if (!tz) return;
    const want = `${TZ_COOKIE}=${tz}`;
    if (document.cookie.split('; ').includes(want)) return;
    document.cookie = `${want}; path=/; samesite=lax`;
  }, []);
  return null;
}
