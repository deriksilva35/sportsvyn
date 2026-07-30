// app/cfb/rankings/page.js — CFB rankings hub (The Sportsvyn 25 / Heisman /
// Playoff Picture). Indexable; policy in lib/seo/routes.js.
import RankingsHub from '@/components/gridiron/RankingsHub';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'College Football Rankings - Sportsvyn' };

export default async function CfbRankings({ searchParams }) {
  return <RankingsHub leagueSlug="cfb" leagueLabel="CFB" searchParams={searchParams} />;
}
