/**
 * /daily/leaderboards — the six v2 boards (spec 5b), main first. Six tabs,
 * ink, v1.2 module grammar - rows, not a table, and one primary action on
 * the whole page (Play today's board, only when there's somewhere to send
 * a reader who hasn't run yet).
 *
 * ONLY THE DAILY FEEDS THESE (standing ruling) - every row here comes
 * straight off daily_board_runs via lib/daily/seasonBoardLeaderboards.js,
 * which never reads a preview or practice source, because none exists:
 * daily_board_runs is the only table a run is ever written to.
 *
 * SERVER-SIDE SORT OR THE HEADER LIES - every leaderboard function already
 * returns its rows in final display order (ORDER BY in SQL, with rank as a
 * SQL dense_rank()); this page renders them as given, no client re-sort.
 */

import Link from 'next/link';
import { todayEt } from '@/lib/daily/entries';
import { displayName } from '@/lib/daily/handles';
import { sql } from '@/lib/db';
import { ensureBoardForDate, isEditionLive, effectiveEpoch } from '@/lib/daily/seasonBoardEditions';
import { LEADERBOARDS } from '@/lib/daily/seasonBoardLeaderboards';
import { DAILY_V2_PATH } from '@/lib/daily/boardShape';
import { auth } from '@/auth';
import './leaderboards.css';

export const dynamic = 'force-dynamic';

const TABS = ['main', 'today', 'streak', 'perfect', 'played', 'best'];

export default async function LeaderboardsPage({ searchParams }) {
  const sp = await searchParams;
  const tab = TABS.includes(sp?.tab) ? sp.tab : 'main';
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const editionDate = await todayEt();
  const todayBoard = isEditionLive(editionDate, effectiveEpoch()) ? await ensureBoardForDate(sql, editionDate) : null;

  let rows = [];
  if (tab === 'today') {
    rows = todayBoard ? await LEADERBOARDS.today.fn(sql, todayBoard.id) : [];
  } else if (tab === 'streak') {
    rows = await LEADERBOARDS.streak.fn(sql, editionDate);
  } else {
    rows = await LEADERBOARDS[tab].fn(sql);
  }

  const showPlay = todayBoard != null; // the one primary action this page ever offers

  return (
    <div className="lbd" data-surface="ink">
      <header className="lbd-hdr">
        <h1>Leaderboards</h1>
        {showPlay ? <Link className="lbd-play" href={DAILY_V2_PATH}>Play today&rsquo;s board</Link> : null}
      </header>

      <nav className="lbd-tabs" aria-label="Leaderboard boards">
        {TABS.map((t) => (
          <a key={t} href={`/daily/leaderboards?tab=${t}`} className={`lbd-tab${t === tab ? ' lbd-tab--on' : ''}`}>
            {LEADERBOARDS[t].label}
          </a>
        ))}
      </nav>

      <div className="lbd-rows">
        {rows.length === 0 ? (
          <div className="lbd-empty">Nobody qualifies here yet.</div>
        ) : rows.map((r) => (
          <Row key={r.userId} r={r} tab={tab} me={userId != null && Number(userId) === Number(r.userId)} />
        ))}
      </div>
    </div>
  );
}

function Row({ r, tab, me }) {
  const name = displayName({ id: r.userId, handle: r.rawHandle });
  return (
    <div className={`lbd-row${me ? ' lbd-row--me' : ''}`}>
      <span className="lbd-rank">{r.rank}</span>
      <span className="lbd-name">{name}</span>
      <span className="lbd-primary">{primaryFor(r, tab)}</span>
      {secondaryFor(r, tab) ? <span className="lbd-secondary">{secondaryFor(r, tab)}</span> : null}
    </div>
  );
}

function primaryFor(r, tab) {
  switch (tab) {
    case 'main': return `${Math.round(r.primary * 1000) / 10}%`;
    case 'today': return `${r.primary} pts`;
    case 'streak': return `${r.primary} day${r.primary === 1 ? '' : 's'}`;
    case 'perfect': return `${r.primary} perfect`;
    case 'played': return `${r.primary} played`;
    case 'best': return `${Math.round(r.primary * 1000) / 10}%`;
    default: return String(r.primary);
  }
}

function secondaryFor(r, tab) {
  switch (tab) {
    case 'main': return `${Math.round(r.secondary * 10) / 10} of 8 avg`;
    case 'today': return `${r.secondary} of 8 matched`;
    case 'streak': return `longest ${r.secondary}`;
    case 'best': return `${r.editionDate} · ${r.seasonYear}`;
    default: return null;
  }
}
