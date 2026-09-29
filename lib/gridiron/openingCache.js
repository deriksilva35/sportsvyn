// lib/gridiron/openingCache.js - the opening spreads for a slate, cached for
// five minutes in Next's data cache and shared by every request (see
// openingLine.js). JSON round trip: the Map goes in as entries.
import { unstable_cache } from 'next/cache';
import { openingSpreads } from './openingLine.js';

// FIVE MINUTES (mon-22), down from an hour once migrations/117 made the read
// an index range: a match whose first odds arrive mid-slate shows its
// "opened" within five minutes rather than within the hour.
export const OPENING_REVALIDATE_SEC = 300;
// KEYED BY THE SLATE: unstable_cache folds the arguments into the key, and the
// ids arrive sorted, so one slate is one entry however the page lists it.
const entries = unstable_cache(async (ids) => [...(await openingSpreads(ids)).entries()], ['scores:openingSpreads:v2'], { revalidate: OPENING_REVALIDATE_SEC, tags: ['scores-open'] });

export async function cachedOpeningSpreads(matchIds) {
  const ids = [...new Set((matchIds ?? []).filter((x) => x != null))].sort((a, b) => a - b);
  return ids.length ? new Map(await entries(ids)) : new Map();
}
