// app/nfl/rankings/page.js — NFL rankings hub (Power / MVP Offense / MVP Defense).
// Indexable; policy in lib/seo/routes.js.
import RankingsHub from '@/components/gridiron/RankingsHub';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL Rankings - Sportsvyn' };

export default async function NflRankings({ searchParams }) {
  return <RankingsHub leagueSlug="nfl" leagueLabel="NFL" searchParams={searchParams} />;
}
