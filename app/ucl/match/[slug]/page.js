/**
 * /ucl/match/[slug] - the Champions League match center (fri-3): the EPL's
 * page (components/soccer/SoccerMatchPage.js) with the league's slug. Scores,
 * goals and cards, team stats; no odds, no game, no props. /match/[slug] 308s
 * UCL slugs here.
 */

import SoccerMatchPage, { soccerMatchMetadata } from '@/components/soccer/SoccerMatchPage';
import '@/components/gridiron/gridiron.css';
import '@/app/scores/scoresV4.css';
import '@/components/gridiron/gamePageArcade.css';
import '@/components/soccer/eplArcade.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  return soccerMatchMetadata(slug, 'ucl');
}

export default async function UclMatchPage({ params }) {
  const { slug } = await params;
  return <SoccerMatchPage slug={slug} leagueSlug="ucl" />;
}
