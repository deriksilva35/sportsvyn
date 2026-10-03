/**
 * /epl/match/[slug] - the Premier League match center (thu-24). The page is
 * components/soccer/SoccerMatchPage.js with the league's slug: the Champions
 * League's /ucl/match/[slug] is the same file (fri-3). /match/[slug] 308s EPL
 * slugs here, so every link already shared keeps working.
 */

import SoccerMatchPage, { soccerMatchMetadata } from '@/components/soccer/SoccerMatchPage';
import '@/components/gridiron/gridiron.css';
import '@/app/scores/scoresV4.css';
import '@/components/gridiron/gamePageArcade.css';
import '@/components/soccer/eplArcade.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return soccerMatchMetadata(slug, 'epl');
}

export default async function EplMatchPage({ params }) {
  const { slug } = await params;
  return <SoccerMatchPage slug={slug} leagueSlug="epl" />;
}
