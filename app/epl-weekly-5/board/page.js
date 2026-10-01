/**
 * /epl-weekly-5/board - the national board for one gameweek (?gw=N, default
 * the current one): settled, the graded scores; before that, every card as it
 * stands. One card per reader; a league board is the same read with members.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { currentGameweek, gameweek } from '@/lib/eplWeekly5/create';
import { boardTop } from '@/lib/eplWeekly5/board';
import { GAME_NAME, roundLabel } from '@/lib/eplWeekly5/rules';
import '../eplWeekly5.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: `${GAME_NAME} · board - Sportsvyn` };

export default async function EplWeekly5BoardPage({ searchParams }) {
  const q = await searchParams;
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const current = await currentGameweek({ now: new Date() }).catch(() => null);
  const gw = Number(q?.gw);
  const contest = Number.isInteger(gw) && gw > 0 && current ? (await gameweek(current.season_year, gw).catch(() => null)) ?? current : current;
  const rows = contest ? await boardTop(contest, { limit: 100 }).catch(() => []) : [];
  return (
    <div className="gi e5page" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="e5-wrap">
        <div className="e5-top">
          <Link href={contest ? `/epl-weekly-5?gw=${contest.week}` : '/epl-weekly-5'} aria-label={`Back to ${GAME_NAME}`}>&larr;</Link>
          <span>{GAME_NAME.toUpperCase()}{contest ? ` · ${roundLabel(contest.week).toUpperCase()}` : ''} · BOARD</span>
        </div>
        <div className="e5-sh"><span>NATIONAL BOARD{contest && !contest.settled ? ' · SO FAR' : ''}</span></div>
        <div className="e5-board">
          {rows.length ? rows.map((r) => (
            <div key={`${r.rank}-${r.handle}`} className={`e5-br${uid != null && String(r.userId) === String(uid) ? ' you' : ''}`}>
              <span className="e5-br-r">{r.rank}</span><b>@{r.handle}</b><span className="e5-br-t">{r.total}</span>
            </div>
          )) : <p className="e5-none">No cards on this gameweek yet.</p>}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
