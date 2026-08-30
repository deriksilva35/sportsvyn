/**
 * /nfl/standings — conference, then division.
 *
 * REGULAR SEASON ONLY, and that is enforced upstream: getLeagueRecords filters
 * to season_type = 'regular', so the preseason rows the provider serves before
 * Week 1 exist in the table, stay labelled, and never reach this page. The
 * seed column drops itself until somebody has actually played — a playoff seed
 * on an 0-0 record is a number the provider computes and nobody should read.
 */

import StandingsPage from '@/components/standings/StandingsPage';
import { nflColumns } from '@/lib/standings/columns';
import { getLeagueRecords } from '@/lib/standings/read';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'NFL Standings - Sportsvyn',
  description: 'NFL standings by conference and division: record, division and conference marks, points for and against, and current streak.',
};

const TABS = [
  { label: 'Today', href: '/nfl' },
  { label: 'Scores & Schedule', href: '/scores' },
  { label: 'Rankings', href: '/nfl/rankings' },
  { label: 'Standings', href: '/nfl/standings', active: true },
  { label: 'Fantasy', href: '/nfl/fantasy' },
];

export default async function NflStandings() {
  const season = resolveSeasonYear(new Date());
  // Read once here purely to decide whether the seed column means anything;
  // StandingsPage reads again for the render. Two cheap indexed reads beat
  // threading the rows through a prop that every other caller ignores.
  const rows = await getLeagueRecords('nfl', season).catch(() => []);

  return (
    <StandingsPage
      leagueSlug="nfl"
      leagueLabel="NFL"
      season={season}
      tabs={TABS}
      groupBy={['conference', 'division']}
      columns={nflColumns(rows)}
      note="Regular season, by conference and division. Preseason records are stored but never shown here."
    />
  );
}
