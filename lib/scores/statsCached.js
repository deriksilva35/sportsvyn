// lib/scores/statsCached.js - the Stats tab's day read, in Next's data cache.
//
// 30 SECONDS, shared by every request, keyed by league + day (the arguments are
// folded into the key). The page's LiveRefresh polls router.refresh() on the same
// 30 s while a game in view is live, so a refresh is a cache hit for all but the
// first reader of each window. The VIEWER'S tags are never cached here: whose
// players they are is read per request (statsMine.js).
import { unstable_cache } from 'next/cache';
import { readStatsDay } from './statsRead.js';
import { CACHE_SECONDS } from './statsTab.js';

const cached = unstable_cache(
  async (league, date) => readStatsDay(league, date),
  ['scores:statsDay:v1'],
  { revalidate: CACHE_SECONDS, tags: ['scores-stats'] },
);

export const cachedStatsDay = (league, date) => cached(league, date);
