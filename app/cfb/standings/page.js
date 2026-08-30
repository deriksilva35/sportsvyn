/**
 * /cfb/standings — college standings, FBS by default.
 *
 * FBS DEFAULT, FCS BY TOGGLE, per the tier-(a) ruling. We now hold complete
 * provider records for both, including the FCS-vs-FCS games our fixtures table
 * deliberately does not carry — so an FCS team's row here is its real record,
 * not the fraction we happen to have ingested. FBS leads because it is what a
 * reader arriving at "college football standings" means; FCS is one link away
 * rather than absent.
 */

import StandingsPage from '@/components/standings/StandingsPage';
import { CFB_COLUMNS } from '@/lib/standings/columns';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'College Football Standings - Sportsvyn',
  description: 'College football standings by conference: overall, conference, home, away and neutral-site records.',
};

const TABS = [
  { label: 'Today', href: '/cfb' },
  { label: 'Scores & Schedule', href: '/scores' },
  { label: 'Rankings', href: '/cfb/rankings' },
  { label: 'Standings', href: '/cfb/standings', active: true },
];

export default async function CfbStandings({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const raw = Array.isArray(sp.division) ? sp.division[0] : sp.division;
  const isFcs = raw === 'fcs';
  const season = resolveSeasonYear(new Date());

  return (
    <StandingsPage
      leagueSlug="cfb"
      leagueLabel="College Football"
      season={season}
      tabs={TABS}
      groupBy={['conference']}
      columns={CFB_COLUMNS}
      classification={isFcs ? 'fcs' : 'fbs'}
      divisionToggle={{
        options: [
          { value: 'fbs', label: 'FBS', href: '/cfb/standings', active: !isFcs },
          { value: 'fcs', label: 'FCS', href: '/cfb/standings?division=fcs', active: isFcs },
        ],
      }}
      note={isFcs
        ? 'Championship Subdivision, by conference. These are complete records from the provider, including games outside our own schedule.'
        : 'Bowl Subdivision, by conference. Overall, conference, home, away and neutral-site records.'}
    />
  );
}
