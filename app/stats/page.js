/**
 * /stats: Stats Hub.
 *
 * Wave 1 reader-only. Pulls all leaderboards + tournament totals from
 * lib/stats.js (which queries match_events + players directly; no
 * dependence on team_tournament_stats / player_match_stats, both 0
 * rows on PROD until the Wave 2 pipeline ships).
 *
 * Always-dark page. Tabs swap via ?view=<id> for sharability; the
 * client component (StatsClient) handles the swap without full
 * navigation. Default view is "overview".
 *
 * MUST keep force-dynamic. Without it, Next 16 freezes data at build
 * time and the live "refreshing every minute" copy becomes a lie.
 * Same rule the /bracket and /world-cup-2026/* routes follow.
 */

import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import {
  getOverview,
  getScorers,
  getAssists,
  getGoalContributions,
  getDiscipline,
  getSvPoints,
  getAllStatsPlayers,
} from '@/lib/stats';
import StatsClient from './StatsClient';

import './stats.css';

const LEAGUE_SLUG = 'fifa-wc-2026';

export const metadata = {
  title: 'Stats · Sportsvyn',
  description: 'Sortable WC stats: scorers, assists, goal contributions, and SV Points.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function StatsPage({ searchParams }) {
  // Next 16: searchParams arrives as a Promise. Await before reading.
  const sp = (await searchParams) ?? {};
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const initialTab = typeof viewParam === 'string' ? viewParam : 'overview';

  // Everything fetched in parallel. _aggregateAllPlayerStats inside
  // lib/stats.js is wrapped in React.cache so the six leaderboards
  // share a single DB round trip.
  const [overview, scorers, assists, goalContributions, svPoints, discipline, allPlayers] =
    await Promise.all([
      getOverview(LEAGUE_SLUG),
      getScorers(LEAGUE_SLUG),
      getAssists(LEAGUE_SLUG),
      getGoalContributions(LEAGUE_SLUG),
      getSvPoints(LEAGUE_SLUG),
      getDiscipline(LEAGUE_SLUG),
      getAllStatsPlayers(LEAGUE_SLUG),
    ]);

  const totals = overview.totals;

  return (
    <>
      <SiteHeaderServer activeNav="stats" />

      <header className="stats-hero">
        <div className="stats-wrap">
          <div className="stats-eyebrow">FIFA World Cup 2026</div>
          <h1 className="stats-title">Stats</h1>
          <div className="stats-subhead">
            <span className="stats-live-dot" aria-hidden="true" />
            <b>Live</b>
            {' · '}
            updated through {totals.matches_played} {totals.matches_played === 1 ? 'match' : 'matches'}
            {' · '}
            {totals.goals} goals
            {' · '}
            <b>refreshing every minute</b>
          </div>
        </div>
      </header>

      <main className="stats-wrap">
        <StatsClient
          initialTab={initialTab}
          overview={overview}
          allPlayers={allPlayers}
          leaderboards={{
            scorers,
            assists,
            goalContributions,
            svPoints,
            discipline,
          }}
        />
        <div className="stats-footer-note">
          Data through Matchday 1 {'·'} scorers and assists from match events {'·'} SV Points is a Sportsvyn metric {'·'} refreshes live every minute during matches.
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
