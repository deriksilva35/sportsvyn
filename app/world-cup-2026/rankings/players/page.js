/**
 * /world-cup-2026/rankings/players: Player Power Rankings stub.
 *
 * Surface gate: requires 'players' in the resolved competition's
 * rankings surfaces (set in leagues.metadata). Today the WC declares
 * 'players' but no ranking_lists row with slug 'player-power' yet
 * has a published current edition. The page renders an honest empty
 * state until the first edition lands, at which point the same code
 * path used by the power leaf will start producing real rows
 * without any change here.
 *
 * Force-dynamic so the moment the player-power edition flips to
 * is_current=true + status='published', the next request reads it.
 */

import { notFound } from 'next/navigation';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { getCurrentEdition, getRankingsForPage } from '@/lib/rankings';
import {
  resolveCompetitionBySegment,
  requireRankingsListSurface,
  getRankingListMetaForUrlLeaf,
} from '@/lib/competition';

import './rankings.css';

const COMPETITION_URL_SLUG = 'world-cup-2026';
const RANKING_URL_LEAF     = 'players';

export const metadata = {
  title: 'Player Power Rankings · Sportsvyn',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PlayerRankingsLeafPage() {
  const comp = await resolveCompetitionBySegment(COMPETITION_URL_SLUG);
  if (!requireRankingsListSurface(comp, RANKING_URL_LEAF)) notFound();

  const leafMeta = getRankingListMetaForUrlLeaf(RANKING_URL_LEAF);
  if (!leafMeta) notFound();

  // Attempt the same read shape the power leaf uses. When no published
  // current edition exists for the player-power list, both calls return
  // their canonical empty signal (null + []) and we drop into the empty
  // state below. Calling both up front means the day rows arrive the
  // page lights up without touching this file.
  const [edition, allRows] = await Promise.all([
    getCurrentEdition({ listSlug: leafMeta.listSlug, leagueSlug: comp.slug }),
    getRankingsForPage({ listSlug: leafMeta.listSlug, leagueSlug: comp.slug, limit: 48 }),
  ]);

  const hasRows = !!edition && allRows.length > 0;

  if (!hasRows) {
    return (
      <>
        <SiteHeaderServer activeNav="rankings" />
        <main className="rankings-wrap">
          <header className="hero">
            <div className="kicker">Player Power Rankings</div>
            <h1>Coming with kickoff.</h1>
            <p className="dek">
              Sportsvyn keeps a separate read on the players inside each squad. The first player-rankings edition lands once the tournament is underway and there is real tape to score against.
            </p>
            <div className="meta-row">
              <span>By <span className="v">Derik Silva</span></span>
              <span><span className="v">Pre-tournament</span></span>
            </div>
          </header>

          <div className="method">
            <div className="method-label">Why no rankings yet</div>
            <p>
              The team rankings can be honest pre-tournament because the squad list and FIFA / ESPN context exist before a ball is kicked. Players need minutes against this opponent set. The ranking flips on after matchday 1 and recomputes after every fixture from there.
            </p>
          </div>

          <div className="foot">
            <p>Looking for the team board? <a href="/world-cup-2026/rankings/power">Team Power Rankings</a>.</p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  // Rows-bearing state placeholder. When the player-power edition
  // actually publishes, the next ship can lift the power leaf{'’'}s
  // PlayerCard / BareRow components verbatim. Leaving as a minimal
  // visible state for now so the surface is reachable.
  return (
    <>
      <SiteHeaderServer activeNav="rankings" />
      <main className="rankings-wrap">
        <header className="hero">
          <div className="kicker">Player Power Rankings</div>
          <h1>Edition {edition.edition_number}.</h1>
          <p className="dek">
            {allRows.length} players ranked. Cards land on the next iteration.
          </p>
        </header>
      </main>
      <SiteFooter />
    </>
  );
}
