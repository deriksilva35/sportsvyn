/**
 * /market — The Market. PHASE A: the price read, three leagues, one feed.
 *
 * WHAT THIS PAGE REPLACED. Until this relay it served a World Cup board whose
 * last match was 19 Jul 2026, under a headline reading "The Market · World Cup"
 * and a board reading "No priced markets right now." It was public, linked from
 * the site footer, and sitemapped at priority 0.8 — a dead tournament
 * advertised to every crawler that asked. The WC retirement swept /my and did
 * not reach here.
 *
 * ONE SURFACE, ONE SOURCE. Every number is an odds_markets row written by The
 * Odds API ingest. The API-Sports soccer feed still serves the soccer match
 * pages and is filtered out here by fetcher_version. Two vendors' consensus
 * prices are not comparable and are never blended into one number.
 *
 * PHASE A ENDS AT THE TOTAL ROW. The mock shows a modelline (MODEL x% · GAP)
 * and a LEDGER band; both need the gridiron model that does not exist yet, and
 * both are Phase B. They are ABSENT here, not empty — the keep-their-place law
 * governs sections whose data happens to be missing today, not features that
 * have not been built. An empty ledger would promise a grade sheet we cannot
 * yet write, which is the one thing a page about honesty must not do.
 *
 * NO VOLT ON PRICES. Volt is structural only — band heads and the active chip.
 * The board recommends nothing, so nothing on it is highlighted as an
 * opportunity. Movement is jade/terra because direction is a fact.
 */

import GlobalHeaderClient from '@/components/GlobalHeaderClient';
import MarketClient from '@/components/market/MarketClient';
import SiteFooter from '@/components/SiteFooter';
import {
  cachedPricedSlate, cachedFuturesBoards, cachedBookCounts, cachedLatestSnapshotAt, cachedBoardMatchIds,
  cachedPropsBoardRows, cachedPropsGames,
} from '@/lib/market/cachedReads';
import './market.css';

// STATIC (droplet-mon-4, B). The page is prerendered and revalidated every
// 60 s - the same clock as lib/market/cachedReads.js - and the URL is applied
// in the browser by components/market/MarketClient.js. It was rendered per
// request because the filters are the URL and the header is the reader's; at
// ~1,100 requests a minute that was a database-bound function per hit. The
// three per-request reads are gone from this file:
//   - searchParams      -> useSearchParams in MarketClient
//   - resolveShellMode  -> the sv_shell cookie, read client-side
//   - GlobalHeaderServer (auth + cookies) -> GlobalHeaderClient + /api/session
export const dynamic = 'force-static';
export const revalidate = 60;

// ONE VIEWPORT FOR WEB AND SHELL. The shell needs viewport-fit:cover for its
// safe-area insets, and a static page cannot ask which one it is serving.
// cover is inert on a browser without a notch and on every desktop.
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export const metadata = {
  title: 'The Market - Sportsvyn',
  description: 'Where the market is actually pricing NFL, CFB and Premier League games, and how that has changed. Consensus lines across books, de-vigged.',
};

/**
 * THE WHOLE DATA SET, ONCE. Every priced game, every future and EVERY prop
 * row across the three leagues - the client narrows it. Plain arrays, not
 * Maps and Sets, because this crosses into a client component.
 */
export async function marketData() {
  const [slate, futures, books, snapAt, boardIds, propsRows, propsGames] = await Promise.all([
    cachedPricedSlate(), cachedFuturesBoards(), cachedBookCounts(), cachedLatestSnapshotAt(), cachedBoardMatchIds(),
    cachedPropsBoardRows('all').catch(() => []),
    cachedPropsGames().catch(() => []),
  ]);
  return {
    slate: [...slate.entries()],
    futures,
    books: [...books.entries()],
    snapAt: snapAt ? new Date(snapAt).toISOString() : null,
    boardIds: [...boardIds],
    propsRows,
    propsGames,
  };
}

/**
 * THE BOARD, once, worn two ways - the same arrangement /scores keeps.
 * /market is the network surface; /nfl/market and /cfb/market are this
 * component with `pinned` set, under the league header and without the league
 * chips. MOVERS ONLY survives the pin because it is state, not a league.
 */
export async function MarketView({ pinned = null, leagueHeader = null }) {
  const data = await marketData();
  return (
    <MarketClient data={data} pinned={pinned} leagueHeader={leagueHeader}
      header={<GlobalHeaderClient activeNav="market" />} />
  );
}

// THE SITE FOOTER ON THE NETWORK /market ONLY (R5 follow-up). It is static-safe
// - no auth, no cookies; HideInShell reads the shell cookie in the browser, the
// same way it does on the prerendered /privacy and /terms - so the page stays
// ○. The league wearings (/nfl/market, /cfb/market) render MarketView without
// it, as every other league route does.
export default async function MarketPage() {
  return (
    <>
      {await MarketView({})}
      <SiteFooter />
    </>
  );
}
