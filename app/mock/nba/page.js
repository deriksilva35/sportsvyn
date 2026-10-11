/**
 * /mock/nba - the NBA mock draft (sun-5). PUBLIC, indexable, playable signed out.
 *
 * The page reads the season's pool (one row, nba_mock_pool - built daily by
 * /api/cron/nba-mock-pool) and hands it to the client, which runs the whole
 * draft in the browser (components/mockNba/MockNbaDraft.js). Nothing is stored,
 * so a signed-out reader needs nothing - no guest row, no cookie.
 */
import Link from 'next/link';
import Wordmark from '@/components/gridiron/Wordmark';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import MockNbaDraft from '@/components/mockNba/MockNbaDraft';
import { readNbaMockPool } from '@/lib/mockNba/pool';
import '../../daily/daily.css';
import '../../draft/game/game.css';
import './mock.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'NBA Mock Draft 2026 - Sportsvyn',
  description: 'A free 12-team NBA mock draft for 2026: points league, 13 rounds, you against 11 bots. Players ranked by last season\'s fantasy points; rookies by draft slot. Get a team grade and a share card.',
  alternates: { canonical: '/mock/nba' },
};

export default async function MockNbaPage() {
  const pool = await readNbaMockPool().catch(() => null);
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
          {pool?.rows?.length ? (
            <MockNbaDraft pool={pool.rows} builtAt={pool.builtAt} />
          ) : (
            <p className="dgm-empty" data-mock-nba-empty>The NBA mock draft is getting its player pool ready. Try again in a few minutes.</p>
          )}
        </main>
      </div>
    </div>
  );
}
