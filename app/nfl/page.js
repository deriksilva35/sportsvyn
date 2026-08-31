// app/nfl/page.js — NFL Today shell. Public and INDEXABLE (linked from the FOOTBALL
// nav). Its destinations are the selector pills in LeagueHeader - one list for
// every league page. Indexability policy lives in lib/seo/routes.js.
import TodayPage from '@/components/gridiron/TodayPage';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL - Sportsvyn' };

export default async function NflToday({ searchParams }) {
  return (
    <TodayPage
      leagueSlug="nfl"
      leagueLabel="NFL"
      searchParams={searchParams}
    />
  );
}
