// app/nfl/wire/page.js — the whole wire for one league.
import WirePage from '@/components/wire/WirePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL Wire - Sportsvyn' };

export default async function NFLWire({ searchParams }) {
  return WirePage({ leagueSlug: 'nfl', label: 'NFL', sp: (await searchParams) ?? {} });
}
