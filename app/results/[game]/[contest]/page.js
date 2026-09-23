// app/results/[game]/[contest]/page.js - one results route for the four
// football games.
//
// FOUR READERS, ONE COMPONENT, ONE ROUTE. Before this, each game rendered its
// own graded state inside its own PLAY page - /weekly, /draft, /pickem/[sport],
// /daily - so the results grammar existed four times and agreed with itself
// only by hand. The old grade components are still mounted on those pages and
// stay there until this route serves the same contest, which is the relay's own
// rule: a results screen that 404s is worse than an inconsistent one.
//
// THE GAME IS A PATH SEGMENT AND IT IS VALIDATED AGAINST A LIST. An unknown
// game is a 404, not a dynamic import of whatever the URL said.
//
// ?who=<userId> IS THE MOCK'S "tap an entry to see its six". It reads ANOTHER
// entrant's results, which is public information on a settled contest - the
// board already shows their score and their lineup is the thing the mock offers
// to open. Before settle there is nothing here at all.

import { notFound } from 'next/navigation';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import Results from '@/components/results/Results';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

const READERS = {
  daily: async (id, uid) => (await import('@/lib/results/daily')).dailyResults(id, uid),
  weekly: async (id, uid) => (await import('@/lib/results/weekly')).weeklyResults(id, uid),
  draft: async (id, uid) => (await import('@/lib/results/draft')).draftResults(id, uid),
  pickem: async (id, uid) => (await import('@/lib/results/pickem')).pickemResults(id, uid),
};

const TITLE = { daily: 'The Daily', weekly: 'The Weekly', draft: 'The Draft', pickem: "Pick'em" };

export async function generateMetadata({ params }) {
  const { game } = await params;
  return { title: `${TITLE[game] ?? 'Results'} · results · Sportsvyn` };
}

export default async function ResultsPage({ params, searchParams }) {
  const { game, contest } = await params;
  const q = await searchParams;
  const read = READERS[game];
  const id = Number(contest);
  if (!read || !Number.isFinite(id)) notFound();

  // WHOSE RESULTS. The signed-in reader by default; ?who= overrides it, which is
  // how the board's rows open. A signed-out visitor with no ?who gets the field
  // and the ceiling with no `mine` - the screen still says something true.
  const viewerId = (await auth().catch(() => null))?.user?.id ?? null;
  const asked = q?.who == null ? null : Number(q.who);
  const uid = Number.isFinite(asked) ? asked : (viewerId == null ? null : Number(viewerId));

  const v = await read(id, uid).catch(() => null);
  // A CONTEST THAT IS NOT SETTLED, OR DOES NOT EXIST, IS A 404 - not an empty
  // results screen, which would read as "you scored nothing".
  if (!v) notFound();

  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="rs-wrap">
        <Results v={v} href={`/results/${game}/${id}`} />
      </div>
    </div>
  );
}
