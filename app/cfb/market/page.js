// app/cfb/market/page.js — the market, inside the league.
//
// The same MarketView /market mounts, pinned to one code by one prop and worn
// under the league header. The network /market is untouched: three codes, the
// global header, the full chip row.
import { MarketView } from '@/app/market/page';
import LeagueHeader from '@/components/league/LeagueHeader';
import '@/components/league/league.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'CFB Market - Sportsvyn' };

export default async function CFBMarket({ searchParams }) {
  const sp = (await searchParams) ?? {};
  return (
    <>
      <LeagueHeader label="CFB" leagueSlug="cfb" pathname="/cfb/market" />
      {await MarketView({ sp, pinned: 'cfb' })}
    </>
  );
}
