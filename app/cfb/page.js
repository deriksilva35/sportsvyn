// app/cfb/page.js — College Football Today shell. Public (linked from the FOOTBALL
// nav) but kept noindex for now. Sub-nav lists only tabs whose route exists.
import TodayPage from '@/components/gridiron/TodayPage';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'College Football - Sportsvyn', robots: { index: false, follow: false } };

const CFB_TABS = [
  { label: 'Today', href: '/cfb', active: true },
  { label: 'Scores & Schedule', href: '/scores' },
];
const CFB_LEDE = 'Week 0 kicks August 29. The slate and the lines are already in.';

export default async function CfbToday({ searchParams }) {
  return (
    <TodayPage
      leagueSlug="cfb"
      leagueLabel="CFB"
      lede={CFB_LEDE}
      tabs={CFB_TABS}
      standingsPhase="REG"
      searchParams={searchParams}
    />
  );
}
