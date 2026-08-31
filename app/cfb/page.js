// app/cfb/page.js — College Football Today shell. Public (linked from the FOOTBALL
// nav) and INDEXABLE. Its destinations are the selector pills in LeagueHeader.
// Indexability policy lives in lib/seo/routes.js.
import TodayPage from '@/components/gridiron/TodayPage';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'College Football - Sportsvyn' };

export default async function CfbToday({ searchParams }) {
  return (
    <TodayPage
      leagueSlug="cfb"
      leagueLabel="CFB"
      searchParams={searchParams}
    />
  );
}
