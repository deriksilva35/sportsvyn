// app/cfb/page.js — College Football Today shell. Public (linked from the FOOTBALL
// nav) and INDEXABLE. Its destinations are the selector pills in LeagueHeader.
// Indexability policy lives in lib/seo/routes.js.
import TodayShell from '@/components/gridiron/TodayShell';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'College Football - Sportsvyn' };

export default async function CfbToday() {
  return (
    <TodayShell
      leagueSlug="cfb"
      leagueLabel="CFB"
    />
  );
}
