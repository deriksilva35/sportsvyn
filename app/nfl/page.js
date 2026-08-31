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
  { label: 'Standings', href: '/nfl/standings' },
  { label: 'Fantasy', href: '/nfl/fantasy' },
];

export default async function NflToday({ searchParams }) {
  return (
    <TodayPage
      leagueSlug="nfl"
      leagueLabel="NFL"
      tabs={NFL_TABS}
      searchParams={searchParams}
    />
  );
}
