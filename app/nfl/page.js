// app/nfl/page.js — NFL Today shell. Unlinked from existing nav. DEV reads only.
import TodayPage from '@/components/gridiron/TodayPage';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL - Sportsvyn', robots: { index: false, follow: false } };

const NFL_TABS = ['Today', 'Scores & Schedule', 'Rankings', 'Market', 'Fantasy', 'Stats', 'Reads'];

export default async function NflToday({ searchParams }) {
  return <TodayPage leagueSlug="nfl" leagueLabel="NFL" tabs={NFL_TABS} standingsPhase="REG" searchParams={searchParams} />;
}
