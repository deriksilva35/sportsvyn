// app/nfl/page.js — NFL Today shell. Public and INDEXABLE (linked from the FOOTBALL
// nav). Sub-nav lists only tabs whose route exists (no dead # links on a public
// page). Indexability policy lives in lib/seo/routes.js.
import TodayPage from '@/components/gridiron/TodayPage';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL - Sportsvyn' };

const NFL_TABS = [
  { label: 'Today', href: '/nfl', active: true },
  { label: 'Scores & Schedule', href: '/scores' },
  { label: 'Rankings', href: '/nfl/rankings' },
  { label: 'Fantasy', href: '/nfl/fantasy' },
];
const NFL_LEDE = 'Season opens September 10. The slate, the lines, and the reads land here.';

export default async function NflToday({ searchParams }) {
  return (
    <TodayPage
      leagueSlug="nfl"
      leagueLabel="NFL"
      lede={NFL_LEDE}
      tabs={NFL_TABS}
      contendersN={12}
      standingsPhase="REG"
      searchParams={searchParams}
    />
  );
}
