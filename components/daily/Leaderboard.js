// components/daily/Leaderboard.js — the board modules. SERVER COMPONENTS.
//
// EVERY BOARD HERE IS A REVEALED-DAY BOARD. The queries in boards.js filter on
// puzzle_days.revealed, so nothing on this page can carry an open day's score.
// The "through <date>" label is not decoration - it is the promise these
// modules make, and the reason there is no today column and no rank movement.
// A delta against yesterday is a statement about today, computed by
// subtraction, so it does not exist either.

import { tierClass } from '@/lib/daily/reveal';

const rowKey = (r) => `${r.userId}`;

function Name({ r }) {
  return (
    <span className={`lb-name${r.handle ? '' : ' lb-name--anon'}`}>{r.name}</span>
  );
}

function DayRow({ r, me }) {
  return (
    <div className={`row${me ? ' row--me' : ''}${r.rank == null ? ' row--dnf' : ''}`}>
      <span className="lb-left">
        <span className="lb-rank">{r.rank ?? '—'}</span>
        <Name r={r} />
        {r.tier && <span className={`tierbadge ${tierClass(r.tier)}`}>{r.tier}</span>}
      </span>
      <span className="r">
        {r.rank == null
          ? <span className="r--mut">no score</span>
          : <>{r.score}{r.pct != null && <span className="r--mut"> {r.pct}%</span>}</>}
      </span>
    </div>
  );
}

/** Yesterday's podium: top 5, plus your row pinned if you are outside it. */
export function PodiumModule({ board, userId }) {
  if (!board?.top?.length) return null;
  return (
    <section className="mod">
      <h2 className="eyebrow">
        Yesterday&rsquo;s podium <span className="ctx">&mdash; {board.date}</span>
      </h2>
      <div>
        {board.top.map((r) => <DayRow key={rowKey(r)} r={r} me={r.userId === userId} />)}
        {board.self && <DayRow r={board.self} me />}
      </div>
    </section>
  );
}

/** Today's board. Only ever rendered on a revealed day. */
export function DayBoardModule({ board, userId }) {
  if (!board?.top?.length) return null;
  return (
    <section className="mod">
      <h2 className="eyebrow">
        Today&rsquo;s leaderboard{' '}
        <span className="ctx">&mdash; {board.entries} {board.entries === 1 ? 'entry' : 'entries'}</span>
      </h2>
      <div className="list--long">
        {board.top.map((r) => <DayRow key={rowKey(r)} r={r} me={r.userId === userId} />)}
        {board.self && <DayRow r={board.self} me />}
      </div>
    </section>
  );
}

/**
 * The overall table. THROUGH the last revealed day, and the label says so
 * because that is the guarantee, not a caption.
 */
export function OverallModule({ table, userId, detailed = false }) {
  if (!table?.top?.length) return null;
  return (
    <section className="mod">
      <h2 className="eyebrow">
        Overall{' '}
        <span className="ctx">
          &mdash; through {table.through ?? 'the last close'}
          {detailed && table.players ? ` · ${table.players} players` : ''}
        </span>
      </h2>
      <div>
        {table.top.map((r) => (
          <OverallRow key={rowKey(r)} r={r} me={r.userId === userId} detailed={detailed} />
        ))}
        {table.self && <OverallRow r={table.self} me detailed={detailed} />}
      </div>
      {detailed && (
        <p className="muted">
          Tier points: HOF 5 · MVP 4 · PB 3 · ST 2 · PS 1. A DNF and a day you missed
          both score zero. Ties break on cumulative percent of perfect, then days played.
        </p>
      )}
    </section>
  );
}

function OverallRow({ r, me, detailed }) {
  return (
    <div className={`row${me ? ' row--me' : ''}`}>
      <span className="lb-left">
        <span className="lb-rank">{r.rank}</span>
        <Name r={r} />
      </span>
      <span className="r">
        {r.points} <span className="r--mut">pts</span>
        {detailed && (
          <>
            {' '}· <span className={r.hof ? 'lb-hof' : 'r--mut'}>{r.hof}</span>
            {' '}· <span className={r.mvp ? 'lb-mvp' : 'r--mut'}>{r.mvp}</span>
            {' '}· <span className="r--mut">{r.played}/{r.daysPlayable}</span>
          </>
        )}
      </span>
    </div>
  );
}
