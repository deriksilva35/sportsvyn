/**
 * /market/props/<player-slug>?match=<id> - one player's priced props for one
 * game.
 *
 * UNDER /market, NOT UNDER THE GAME PAGE. The card is about a PLAYER across the
 * last five he played; the game is the context that gives the prices a
 * deadline. /market already owns every priced surface, and the game page
 * already links players to /player/<slug> for the career view - a third parent
 * would be a third answer to "where do prices live".
 *
 * ?match IS REQUIRED AND IS NOT A DEFAULT. A prop is priced FOR a game; a card
 * that guessed the game would show last week's line beside this week's logs.
 * No match, no card.
 */

import { notFound } from 'next/navigation';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import PlayerPropCard from '@/components/market/PlayerPropCard';
import { playerPropCard } from '@/lib/market/playerCard';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import '@/app/market/market.css';

export const dynamic = 'force-dynamic';

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export async function generateMetadata({ params, searchParams }) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const matchId = Number(Array.isArray(sp.match) ? sp.match[0] : sp.match);
  const card = Number.isInteger(matchId) ? await playerPropCard(slug, matchId).catch(() => null) : null;
  if (!card) return { title: 'Props - Sportsvyn', robots: { index: false } };
  return {
    title: `${card.player.name} props - ${card.game.away.abbr} at ${card.game.home.abbr} - Sportsvyn`,
    description: 'Priced props and what our own game logs did against the line.',
    // A PRICE PAGE IS NOT AN EVERGREEN PAGE. It is true until kickoff and
    // meaningless after, so it stays out of the index.
    robots: { index: false },
  };
}

export default async function PlayerPropsPage({ params, searchParams }) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const raw = Array.isArray(sp.match) ? sp.match[0] : sp.match;
  const matchId = Number(raw);
  if (!Number.isInteger(matchId) || matchId <= 0) notFound();

  const card = await playerPropCard(slug, matchId).catch(() => null);
  // NOTHING PRICED IS A 404, NOT AN EMPTY CARD. A page whose whole subject is
  // a set of prices has nothing to say when there are none.
  if (!card) notFound();

  return (
    <>
      <GlobalHeaderServer activeNav="market" />
      <main data-surface="ink">
        <div className="mk-wrap">
          <PlayerPropCard card={card} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
