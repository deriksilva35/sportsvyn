// app/cfb/wire/page.js — the whole wire for one league.
import WirePage from '@/components/wire/WirePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'CFB Wire - Sportsvyn' };

export default async function CFBWire({ searchParams }) {
  return WirePage({ leagueSlug: 'cfb', label: 'CFB', sp: (await searchParams) ?? {} });
}
