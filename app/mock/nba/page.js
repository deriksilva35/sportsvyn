/**
 * /mock/nba - the NBA mock draft (sun-5, sun-7). PUBLIC, indexable, playable signed out.
 *
 * The page reads the season's pool (one row, nba_mock_pool - built daily by
 * /api/cron/nba-mock-pool) and the ADP list matched to it (mock_nba_adp), merges
 * the two, and hands them to the client, which runs the whole draft in the
 * browser (components/mockNba/MockNbaDraft.js). MOCK_ADP_SOURCE=off drops the ADP
 * column entirely (lib/mockNba/adp.js). A signed-in reader's saved setup comes
 * with the page, and so do their NAMED setups (lib/mockNba/setups.js, mon-2); a
 * guest's setup lives in their browser.
 */
import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import MockNbaDraft from '@/components/mockNba/MockNbaDraft';
import { readNbaMockPool } from '@/lib/mockNba/pool';
import { adpEnabled, readAdp, withAdp } from '@/lib/mockNba/adp';
import { readMockSettings } from '@/lib/mockNba/record';
import { listSetups } from '@/lib/mockNba/setups';
import '../../daily/daily.css';
import '../../draft/game/game.css';
import './mock.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'NBA Mock Draft 2026 - Sportsvyn',
  description: 'A free NBA mock draft for 2026: 8 to 14 teams, points scoring or your own, any roster. You against the bots, with ADP and our own ranking side by side. Get a team grade and a share card.',
  alternates: { canonical: '/mock/nba' },
};

export default async function MockNbaPage() {
  const adpOn = adpEnabled();
  const [pool, adp, session] = await Promise.all([
    readNbaMockPool().catch(() => null),
    adpOn ? readAdp().catch(() => new Map()) : Promise.resolve(new Map()),
    auth().catch(() => null),
  ]);
  const userId = session?.user?.id ?? null;
  const [saved, setups] = userId != null
    ? await Promise.all([readMockSettings(Number(userId)).catch(() => null), listSetups(Number(userId)).catch(() => [])])
    : [null, []];
  const rows = pool?.rows?.length ? withAdp(pool.rows, adp, { on: adpOn }) : null;
  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="games" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">NBA <b>Mock Draft</b></span>
        </header>
        <main className="daily-main dgm mnb">
          <Link className="appcrumb" href="/games">&larr; Games</Link>
          {rows ? (
            <MockNbaDraft pool={rows} builtAt={pool.builtAt} adpOn={adpOn && adp.size > 0} signedIn={userId != null} saved={saved} setups={setups} />
          ) : (
            <p className="dgm-empty" data-mock-nba-empty>The NBA mock draft is getting its player pool ready. Try again in a few minutes.</p>
          )}
        </main>
      </div>
    </div>
  );
}
