/**
 * /october/board - frame 3 of the mock: one October total, today beside it,
 * and the pool bar that shows where the reader's tournament went.
 */

import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { currentOctoberDay } from '@/lib/october/create';
import { octoberBoard, poolSplit } from '@/lib/october/board';
import { usedPlayers } from '@/lib/october/pool';
import { seriesFor } from '@/lib/mlb/series';
import '../../games/games.css';
import '../october.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'October · standings - Sportsvyn' };

export default async function OctoberBoardPage() {
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const contest = await currentOctoberDay({ now: new Date() }).catch(() => null);
  const season = contest?.season_year ?? new Date().getUTCFullYear();

  const [rows, used, series] = await Promise.all([
    octoberBoard(season).catch(() => []),
    uid == null ? Promise.resolve(new Map()) : usedPlayers(Number(uid), season).catch(() => new Map()),
    seriesFor(null, season).catch(() => []),
  ]);

  // WHO IS STILL ALIVE. A club is out when it has lost a series it was in;
  // everyone else is still playing, which is what the pool bar splits on.
  const eliminated = new Set();
  for (const s of series) {
    if (!s.winner) continue;
    for (const t of s.teams) if (t.id !== s.winner) eliminated.add(t.abbreviation);
  }
  const alive = new Set(series.flatMap((s) => s.teams.map((t) => t.abbreviation)).filter((a) => !eliminated.has(a)));

  const me = rows.find((r) => String(r.userId) === String(uid)) ?? null;
  const split = poolSplit({ used, rosterTeamOf: new Map(), aliveTeams: alive, totalPool: used.size });

  return (
    <div className="gi ocpage" data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <div className="oc-wrap">
        <div className="oc-crumb">
          <Link href="/october">&#8249; Your five</Link>
          <Link className="r" href="/mlb/bracket">Bracket &#8250;</Link>
        </div>

        <div className="oc-hd" style={{ borderRadius: '18px 18px 0 0' }}>
          <div className="oc-hd-top">
            <span className="oc-eb">October</span>
            <span className="oc-ed">{rows.length} playing · the World Series decides it</span>
          </div>
          <div className="oc-crow">
            <div className="oc-lbl">you<b>{me ? `${ordinal(me.rank)} · ${me.back} back` : 'not entered'}</b></div>
            <div className="oc-tot"><b>{me?.total ?? 0}</b><span>October</span></div>
          </div>
        </div>

        <div className="ob-lb">
          {rows.length ? rows.slice(0, 10).map((r) => (
            <div key={r.userId} className={`ob-lr${String(r.userId) === String(uid) ? ' you' : ''}`} data-rank={r.rank}>
              <span className="rk">{r.rank}</span>
              <span>{String(r.userId) === String(uid) ? 'you' : r.handle}{r.house ? <span className="h"> · house</span> : null}</span>
              {/* TODAY'S DELTA, and a DNF says DNF rather than +0.0 - a day
                  you did not field a card is a different fact from a day you
                  played badly. */}
              <span className="d">{r.todayState === 'dnf' ? 'DNF' : r.todayPoints == null ? '—' : `+${r.todayPoints}`}</span>
              <span className="t">{r.total}</span>
            </div>
          )) : <div className="ob-lr"><span className="rk">—</span><span>Nobody has played a day yet.</span><span /><span /></div>}
        </div>

        <div className="ob-pool">
          <div className="oc-eb">Your pool</div>
          <div className="row"><span>used · gone for October</span><b>{split.used}</b></div>
          <div className="row"><span>clubs still alive</span><b>{alive.size ? [...alive].sort().join(' ') : '—'}</b></div>
          <div className="row"><span>clubs eliminated</span><b>{eliminated.size ? [...eliminated].sort().join(' ') : '—'}</b></div>
          <div className="ob-bar">
            <i className="g" style={{ width: `${split.pct.used}%` }} />
            <i className="a" style={{ width: `${split.pct.alive}%` }} />
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
};
