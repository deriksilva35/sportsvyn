// app/cfb/page.js — College Football Today shell. Unlinked from existing nav.
// DEV reads only. Sub-nav swaps Fantasy -> Standings per the reference.
import TodayPage from '@/components/gridiron/TodayPage';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'College Football - Sportsvyn', robots: { index: false, follow: false } };

const CFB_TABS = ['Today', 'Scores & Schedule', 'Rankings', 'Market', 'Standings', 'Stats', 'Reads'];

export default async function CfbToday({ searchParams }) {
  return <TodayPage leagueSlug="cfb" leagueLabel="CFB" tabs={CFB_TABS} standingsPhase="REG" searchParams={searchParams} />;
}
