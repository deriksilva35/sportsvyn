// lib/market/cachedReads.js - /market's reads, cached for 60 s and shared
// across every request and every instance (Next's data cache).
//
// WHY (25 Sep incident). /market takes ~1,100 requests a minute and each one
// ran its reads against Neon; the proxy began refusing connections ("Failed to
// acquire permit ... Too many database connection attempts") and the page
// returned thousands of 500s an hour. None of these reads is per-user - they
// take no user, no cookie, no header - so one answer per minute serves every
// reader. The page itself stays dynamic (its tabs and filters are the URL, its
// header is the reader's own), and only the DATA is cached.
//
// THE CACHE STORES JSON, so what these return has to survive a round trip:
// Maps and Sets go in as entries and come back rebuilt, a Date comes back as
// the ISO string every renderer already passes through new Date(). Each
// wrapper restores the shape its reader returned, so the page reads them
// exactly as before.
import { unstable_cache } from 'next/cache';
import { pricedSlate, futuresBoards, bookCounts, latestSnapshotAt, boardMatchIds } from './reads.js';
import { propsBoardRows, propsBoardFrom, propsGames } from './propsBoard.js';

export const MARKET_REVALIDATE_SEC = 60;
const opts = { revalidate: MARKET_REVALIDATE_SEC, tags: ['market'] };

const slateEntries = unstable_cache(async () => [...(await pricedSlate()).entries()], ['market:pricedSlate:v1'], opts);
const futuresCached = unstable_cache(async () => futuresBoards(), ['market:futuresBoards:v1'], opts);
const bookEntries = unstable_cache(async () => [...(await bookCounts()).entries()], ['market:bookCounts:v1'], opts);
const snapIso = unstable_cache(async () => {
  const at = await latestSnapshotAt();
  return at == null ? null : new Date(at).toISOString();
}, ['market:latestSnapshotAt:v1'], opts);
const boardIdList = unstable_cache(async () => [...(await boardMatchIds())], ['market:boardMatchIds:v1'], opts);
// THE PROPS BOARD IS CACHED BY LEAGUE, NOT BY FILTER. Its database reads
// depend only on the league (lib/market/propsBoard.js propsBoardRows); every
// other filter is applied in memory (propsBoardFrom). The traffic behind the
// incident walked thousands of filter combinations, each of which would have
// been its own cache miss; keyed by league, there are four entries a minute.
const propsRowsCached = unstable_cache(async (league) => propsBoardRows(league), ['market:propsBoardRows:v1'], opts);
const propsGamesCached = unstable_cache(async () => propsGames(), ['market:propsGames:v1'], opts);

export async function cachedPricedSlate() { return new Map(await slateEntries()); }
export async function cachedFuturesBoards() { return futuresCached(); }
export async function cachedBookCounts() { return new Map(await bookEntries()); }
export async function cachedLatestSnapshotAt() { const s = await snapIso(); return s == null ? null : new Date(s); }
export async function cachedBoardMatchIds() { return new Set(await boardIdList()); }
export async function cachedPropsBoard(state = {}) { return propsBoardFrom(await propsRowsCached(state.league ?? 'all'), state); }
export async function cachedPropsGames() { return propsGamesCached(); }
