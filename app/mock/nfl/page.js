/**
 * /mock/nfl - the NFL mock draft (mon-3). PUBLIC, indexable, playable signed out.
 *
 * The page reads the season's pool (one row, nfl_mock_pool - built daily by
 * /api/cron/nfl-mock-pool) and hands it to the client, which runs the whole draft
 * in the browser on the NBA mock's engine (components/mockNfl/MockNflDraft.js).
 * MOCK_ADP_SOURCE=off drops the ADP column here too (lib/mockNba/adp.js). A
 * signed-in reader's saved setup and named setups come with the page (sport
 * 'nfl'); a guest's setup lives in their browser. The ADP source's attribution
 * is a licence condition, shown whenever its ADP is.
 */
import Link from 'next/link';
import { auth } from '@/auth';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import MockNflDraft from '@/components/mockNfl/MockNflDraft';
import { readNflMockPool } from '@/lib/mockNfl/pool';
import { adpEnabled } from '@/lib/mockNba/adp';
import { readMockSettings } from '@/lib/mockNba/record';
import { listSetups } from '@/lib/mockNba/setups';
import Attribution from '@/components/sim/Attribution';
import { FFC_ATTRIBUTION } from '@/lib/fantasy/attribution';
import '../../daily/daily.css';
import '../../draft/game/game.css';
import '../nba/mock.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'NFL Mock Draft 2026 - Sportsvyn',
  description: 'A free NFL mock draft for 2026: 8 to 14 teams, PPR, Half PPR, Standard or your own scoring, any roster. You against the bots, with ADP and our in-season projection side by side. Get a team grade and a share card.',
  alternates: { canonical: '/mock/nfl' },
};

export default async function MockNflPage() {
  const adpOn = adpEnabled();
  const [pool, session] = await Promise.all([readNflMockPool().catch(() => null), auth().catch(() => null)]);
  const userId = session?.user?.id ?? null;
  const [saved, setups] = userId != null
    ? await Promise.all([
      readMockSettings(Number(userId), { sport: 'nfl' }).catch(() => null),
      listSetups(Number(userId), { sport: 'nfl' }).catch(() => []),
    ])
    : [null, []];
  const rows = pool?.rows?.length ? (adpOn ? pool.rows : pool.rows.map(({ adp: _a, ...r }) => r)) : null;
  return (
    <div className="daily-shell">
      <GlobalHeaderServer activeNav="games" />
      <div className="weekly" data-surface="ink">
        <header className="daily-head">
          <Wordmark href="/" />
          <span className="tag">NFL <b>Mock Draft</b></span>
        </header>
        <main className="daily-main dgm mnb">
          <Link className="appcrumb" href="/games">&larr; Games</Link>
          {rows ? (
            <MockNflDraft pool={rows} builtAt={pool.builtAt} adpAsOf={adpOn ? pool.adpAsOf : null} adpOn={adpOn} signedIn={userId != null} saved={saved} setups={setups} />
          ) : (
            <p className="dgm-empty" data-mock-nfl-empty>The NFL mock draft is getting its player pool ready. Try again in a few minutes.</p>
          )}

        </main>
        {adpOn && rows && <div className="mnb-attr"><Attribution text={FFC_ATTRIBUTION.text} url={FFC_ATTRIBUTION.url} /></div>}
      </div>
    </div>
  );
}
