// app/rankings/page.js - the Rankings tab.
//
// EVERY VIEW IS A URL (item 1): ?league=nfl|cfb|epl and
// ?view=teams|players|people, with ?stat= on players and ?game= on people.
// The pills and the segment are links, so the server renders the view the URL
// names and nothing is client state.

import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import Rankings from '@/components/rankings/Rankings';
import { rankingsView } from '@/lib/rankings/view';
import { auth } from '@/auth';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rankings - Sportsvyn' };

export default async function RankingsPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const session = await auth().catch(() => null);
  const v = await rankingsView({ sp, userId: session?.user?.id ?? null });
  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav="rankings" />
      <Rankings v={v} />
    </div>
  );
}
