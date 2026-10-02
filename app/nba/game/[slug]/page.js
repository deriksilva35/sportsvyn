// app/nba/game/[slug] - the NBA game page (nba-card, thu-37).
//
// THE ARCADE GAME PAGE'S STRUCTURE: the board's card (CardFace, onPage) and
// the modules under it, drawn by components/gridiron/GamePageArcade.js from
// one view (lib/nba/gamePageView.js) - the way /nfl/game/[slug] draws its
// arcade branch. Basketball has no dark page to fall back to, so this route
// draws the arcade view on every request; its sheets are arcade-scoped, and
// the arcade theme is what PROD serves.
//
//   live   card (Q4 · 2:14, BONUS, last play, top scorers, timeouts),
//          In your games, chips Plays | Box | Leaders | Market
//   final  card (W, FINAL · OT), In your games settled, leaders PTS/REB/AST,
//          team stats FG% / 3PT / REB / TOV, the full box behind a link
// NO WIN PROBABILITY and NO LIVE ACTIVITY (liveActivitySupported is false for
// basketball, thu-18) - neither is drawn, not even as a placeholder.

import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { readViewerTz } from '@/lib/gridiron/serverTz';
import { getNbaGame } from '@/lib/nba/gameDetail';
import { nbaGameView } from '@/lib/nba/gamePageView';
import GamePageArcade from '@/components/gridiron/GamePageArcade';
import BackToAppBar from '@/components/BackToAppBar';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import '@/components/gridiron/gridiron.css';
import '@/app/scores/scoresV4.css';
import '@/components/gridiron/gamePageArcade.css';

export const dynamic = 'force-dynamic';

const one = (v) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const g = await getNbaGame(slug).catch(() => null);
  if (!g) return { title: 'Game not found - Sportsvyn' };
  const fixture = `${g.away?.name} at ${g.home?.name}`;
  const score = g.status === 'final' ? `Final ${g.away?.abbreviation} ${g.awayScore}, ${g.home?.abbreviation} ${g.homeScore}.` : null;
  return {
    title: `${fixture} - Sportsvyn`,
    description: [score, 'Line score, plays, leaders and the box.'].filter(Boolean).join(' '),
  };
}

export default async function NbaGamePage({ params, searchParams }) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const game = await getNbaGame(slug).catch(() => null);
  if (!game) notFound();
  const [session, isShell, tz] = await Promise.all([
    auth().catch(() => null), resolveShellMode().catch(() => false), readViewerTz(),
  ]);
  const view = await nbaGameView({
    game,
    viewerId: session?.user?.id ?? null,
    allPlays: one(sp.plays) === 'all',
    boxOpen: one(sp.box) === 'all',
    signinHref: shellSigninHref(`/nba/game/${game.slug}`, isShell),
  });
  return (
    <div className="gi" data-surface="ink">
      <BackToAppBar />
      <GlobalHeaderServer activeNav="scores" />
      <GamePageArcade view={view} tz={tz ?? 'America/New_York'} />
    </div>
  );
}
