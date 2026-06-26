'use server';

/**
 * Server Actions for the /app shell.
 *
 * The deck + Schedules preload their data in /app's Promise.all on open.
 * The match view is per-match and reached by a tap, so it can't be
 * preloaded (104 fixtures) — it's fetched ON DEMAND via this action when a
 * row is opened. Mirrors the app/actions/follows.js pattern: a 'use server'
 * module whose client callers (the shell) await it and get back a plain
 * serializable object (or null when the slug doesn't resolve).
 *
 * readMatch is self-contained in app/app/data.js (its own neon client); this
 * action is just the client-callable boundary.
 */

import { readMatch, readRankings } from './data';

export async function loadMatch(slug) {
  if (typeof slug !== 'string' || slug.length === 0) return null;
  return await readMatch(slug);
}

// Rankings (Team Power + Tournament MVP) — paramless, lazy-loaded on first
// tap of the Rankings tab (not preloaded in /app's Promise.all). Cached
// client-side for the session since editions only change after a matchday.
export async function loadRankings() {
  return await readRankings();
}
