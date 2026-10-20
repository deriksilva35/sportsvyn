// app/coins/results/[week]/page.js - THE TUESDAY REVEAL (coins-2 B5).
//
// /coins/results/<week id> once that week is drawn; /coins/results/dry-run draws
// the OPEN week as if it closed now and writes nothing - the review page for a
// preview deploy (lib/coins/close.js runClose dryRun + previewWeekId).
// 404 unless COINS=on.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import ResultsView from '@/components/coins/ResultsView';
import { coinsEnabled } from '@/lib/coins/mint';
import { currentWeek } from '@/lib/coins/drum';
import { runClose } from '@/lib/coins/close';
import { closeLabel } from '@/lib/coins/week';
import { resolveShellMode } from '@/lib/shell/shell';
import '@/components/coins/coins.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Drum results - Sportsvyn' };

function mine(draw, userId) {
  if (userId == null) return null;
  const uid = Number(userId);
  let won = null;
  for (const d of draw.drums) {
    for (const w of d.winners) if (w.user_id === uid && !won) won = `a ${d.title}`;
  }
  return { coins: 0, won };
}

export default async function ResultsPage({ params }) {
  if (!coinsEnabled()) notFound();
  const { week: key } = await params;
  const [session, isShell] = await Promise.all([auth().catch(() => null), resolveShellMode().catch(() => false)]);
  const userId = session?.user?.id ?? null;
  let r; let preview = false; let checkHref = null; let weekId;
  if (key === 'dry-run') {
    const open = await currentWeek();
    if (!open) notFound();
    const out = await runClose({ dryRun: true, previewWeekId: open.id });
    if (out.decision !== 'dry-run') notFound();
    r = { ordinal: out.ordinal, ...out.draw }; preview = true; weekId = open.id;
  } else {
    if (!/^\d+$/.test(String(key))) notFound();
    const [w] = await sql`
      SELECT w.id, w.draw, w.drawn_at, (SELECT count(*)::int FROM coin_weeks x WHERE x.opens_at <= w.opens_at) AS ordinal
        FROM coin_weeks w WHERE w.id = ${Number(key)} AND w.drawn_at IS NOT NULL`;
    if (!w?.draw) notFound();
    r = { ordinal: w.ordinal, ...w.draw }; checkHref = `/api/coins/draw/${w.id}`; weekId = w.id;
  }
  let me = mine(r, userId);
  if (me) {
    const [{ q }] = await sql`SELECT COALESCE(sum(qty), 0)::int AS q FROM drum_entries WHERE user_id = ${Number(userId)} AND week_id = ${weekId}`;
    me = { ...me, coins: q };
  }
  const [next] = await sql`SELECT closes_at FROM coin_weeks WHERE opens_at > (SELECT opens_at FROM coin_weeks WHERE id = ${weekId}) ORDER BY opens_at LIMIT 1`;
  return (
    <div data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <main className="cn">
        <div className="cn-top"><Link href="/coins">The Drum</Link><h1 className="cn-mono">RESULTS</h1><Link href="/coins/rules">Rules</Link></div>
        <ResultsView r={r} me={me} preview={preview} checkHref={checkHref} nextLabel={next ? closeLabel(next.closes_at) : null} />
      </main>
      {!isShell && <SiteFooter />}
    </div>
  );
}
