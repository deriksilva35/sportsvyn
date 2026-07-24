// app/nfl/page.js — NFL Today shell. Public (linked from the FOOTBALL nav) but
// kept noindex until the surface is fully fleshed out. Sub-nav lists only tabs
// whose route exists (no dead # links on a public page).
import TodayPage from '@/components/gridiron/TodayPage';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL - Sportsvyn', robots: { index: false, follow: false } };

const NFL_TABS = [
  { label: 'Today', href: '/nfl', active: true },
  { label: 'Scores & Schedule', href: '/scores' },
];
const NFL_LEDE = 'Season opens September 10. The slate, the lines, and the reads land here.';

export default async function NflToday({ searchParams }) {
  return (
    <TodayPage
      leagueSlug="nfl"
      leagueLabel="NFL"
      lede={NFL_LEDE}
      tabs={NFL_TABS}
      standingsPhase="REG"
      searchParams={searchParams}
    />
  );
}
