// app/nfl/page.js — NFL Today shell. Public and INDEXABLE (linked from the FOOTBALL
// nav). Its destinations are the selector pills in LeagueHeader - one list for
// every league page. Indexability policy lives in lib/seo/routes.js.
import TodayShell from '@/components/gridiron/TodayShell';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL - Sportsvyn' };

export default async function NflToday() {
  return (
    <TodayShell
      leagueSlug="nfl"
      leagueLabel="NFL"
    />
  );
}
