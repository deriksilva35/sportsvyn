// app/cfb/rankings/page.js — CFB rankings hub (The Sportsvyn 25 / Heisman /
// Playoff Picture). noindex for now (lifts with the site-wide decision).
import RankingsHub from '@/components/gridiron/RankingsHub';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'College Football Rankings - Sportsvyn', robots: { index: false, follow: false } };

export default async function CfbRankings({ searchParams }) {
  return <RankingsHub leagueSlug="cfb" leagueLabel="CFB" searchParams={searchParams} />;
}
