// app/nfl/rankings/page.js — NFL rankings hub (Power / MVP Offense / MVP Defense).
// noindex for now (lifts with the site-wide decision).
import RankingsHub from '@/components/gridiron/RankingsHub';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL Rankings - Sportsvyn', robots: { index: false, follow: false } };

export default async function NflRankings({ searchParams }) {
  return <RankingsHub leagueSlug="nfl" leagueLabel="NFL" searchParams={searchParams} />;
}
