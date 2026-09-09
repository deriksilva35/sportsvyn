/**
 * /daily/board/[date] — a closed edition's results.
 *
 * For a player who submitted that day: the SAME receipt they saw at submit
 * (regraded from their stored picks against the frozen best roster), plus the
 * day's leaderboard - SeasonBoard's own grade screen, so there is one receipt,
 * not two. For anyone else, signed in or out: the best roster, the ceiling
 * and the leaderboard. A signed-in DNF is told so.
 *
 * TODAY REDIRECTS TO THE BOARD. Results exist only once an edition has
 * closed; today's edition is /daily/board, and so is any date that has not
 * closed yet. A date with no edition is a 404, not an empty page.
 *
 * This is where the midnight push lands (lib/push/copy.js 'daily-revealed'
 * -> dailyResultsPath(edition)), where the lobby's Yesterday line, Latest
 * Answer and History all link. One constant builds every one of those hrefs.
 */

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { SLOTS, DAILY_V2_PATH, DAILY_ROUND_SECONDS } from '@/lib/daily/boardShape';
import { todayEt } from '@/lib/daily/entries';
import { regradeStoredRun } from '@/lib/daily/seasonBoardRuns';
import { todayLeaderboard, streakLeaderboard } from '@/lib/daily/seasonBoardLeaderboards';
import { bestRosterLines } from '@/lib/daily/seasonBoardResults';
import { editionLabel, editionNo } from '@/lib/daily/homeModule';
import SeasonBoard from '@/components/daily/season/SeasonBoard';
import '../../../../components/daily/season/seasonBoard.css';

export const dynamic = 'force-dynamic';

function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default async function DailyResultsPage({ params }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const today = await todayEt();
  if (date === today) redirect(DAILY_V2_PATH);

  const [board] = await sql`
    SELECT *, to_char(edition_date, 'YYYY-MM-DD') AS edition_ymd, now() >= closes_at AS closed
      FROM daily_boards WHERE edition_date = ${date}::date`;
  if (!board) notFound();
  if (!board.closed) redirect(DAILY_V2_PATH);

  const session = await auth();
  const userId = session?.user?.id ?? null;
  const edition = `The Daily · No. ${editionLabel(editionNo(board.edition_ymd)) ?? board.edition_ymd}`;
  const year = String(board.season_year);

  const run = userId == null ? null
    : (await sql`SELECT * FROM daily_board_runs WHERE board_id = ${board.id} AND user_id = ${userId}`)[0] ?? null;

  const [rows, streak] = await Promise.all([
    todayLeaderboard(sql, board.id),
    userId == null ? Promise.resolve(null)
      : streakLeaderboard(sql, board.edition_ymd).then((r) => r.find((x) => Number(x.userId) === Number(userId))?.primary ?? null),
  ]);

  if (run?.picks != null) {
    // THE RECEIPT THE PLAYER SAW AT SUBMIT, regraded from the stored picks.
    const regraded = regradeStoredRun(board, run.picks, SLOTS);
    if (regraded.ok) {
      return (
        <SeasonBoard
          edition={edition} year={year} teams={board.board} slots={SLOTS} ranked userId={userId}
          boardId={board.id}
          initialPlay={regraded.play} initialGrade={regraded.grade}
          initialClockLabel={mmss(Math.min(DAILY_ROUND_SECONDS, Number(run.elapsed_s ?? 0)) * 1000)}
          streak={streak} closesAt={board.closes_at} todayRows={rows}
        />
      );
    }
  }

  // NO RUN THAT DAY (or a DNF): the best roster, the ceiling, the field.
  const best = bestRosterLines(board);
  const dnf = run != null && run.picks == null;
  return (
    <div className="sbd">
      <div className="sbd-crumb-row"><Link className="appcrumb" href="/games">&larr; Games</Link></div>
      <header className="sbd-hdr">
        <span className="sbd-ed">{edition}</span>
        {streak != null ? <span className="sbd-streak">🔥 {streak} day{streak === 1 ? '' : 's'}</span> : null}
      </header>
      <div className="sbd-yr"><h1>{year}</h1>
        <div className="sbd-sub">
          {dnf
            ? <>You opened this board but never locked a roster - no score. Here is what it allowed.</>
            : <>Settled at midnight ET. The best roster these twelve teams allowed, and the field.</>}
        </div>
      </div>
      <div className="sbd-lb">
        <div className="sbd-lb-h"><span>Best roster</span><span>{Number(board.ceiling).toLocaleString('en-US')} pts</span></div>
        {best.map((b, i) => (
          <div key={i} className="sbd-lr">
            <span className="sbd-lr-rk">{b.slot}</span>
            <span className="sbd-lr-who">{b.name} <small style={{ opacity: .6 }}>{b.abbr}</small></span>
            <span className="sbd-lr-sc">{Number(b.points).toLocaleString('en-US')}</span>
          </div>
        ))}
      </div>
      <div className="sbd-lb">
        <div className="sbd-lb-h"><span>The field</span><span>{rows.length} played</span></div>
        {rows.length === 0 ? <div className="sbd-lr"><span className="sbd-lr-who" style={{ opacity: .6 }}>Nobody submitted this board.</span></div> : null}
        {rows.map((r) => (
          <div key={r.userId} className="sbd-lr">
            <span className="sbd-lr-rk">{r.rank}</span>
            <span className="sbd-lr-who">{r.handle}</span>
            <span className="sbd-lr-sc">{r.primary.toLocaleString('en-US')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
