// components/boards/LiveBoard.js - the always-on public board (hybrid mock,
// "The Daily live board" frame on the Arcade directions canvas, drawn for the
// Weekly and the Draft first).
//
// PURE PRESENTATION. The page reads (lib/boards/live.js gameBoard), boardView
// shapes, this draws. No hooks, so it renders on the server and in a test.
//
// THE FRAME, TOP TO BOTTOM: title + live pill · the pinned "you" card (rank,
// movement over the last 10 minutes, points, how many of the six have played,
// the top-10% line) · the table (top ten, then the reader's own row with a
// neighbour either side when they sit lower). The chips are National and the
// reader's own leagues (a league ranks its members among themselves); the
// mock's Friends chip and prize line are NOT drawn - neither exists in the
// product, and a control that goes nowhere is worse than none.

import Link from 'next/link';
import BoardChips from './BoardChips.js';

const fmt = (n) => (n == null ? '–' : (Math.round(Number(n) * 10) / 10).toFixed(1));
const num = (n) => Number(n).toLocaleString('en-US');

/** "+4.2" / "-2.0" / "–" for the 10m column. */
export function deltaText(d) {
  if (d == null || d === 0) return '–';
  return `${d > 0 ? '+' : ''}${fmt(d)}`;
}

/** "up 312 in the last 10 min" / "down 4 ..." / "no change ..." / null. */
export function rankMoveText(dRank, minutes = 10) {
  if (dRank == null) return null;
  if (dRank === 0) return `no change in the last ${minutes} min`;
  return `${dRank > 0 ? 'up' : 'down'} ${num(Math.abs(dRank))} in the last ${minutes} min`;
}

function Row({ r, you }) {
  const d = r.dPoints;
  return (
    <div className={`lb-row${you ? ' you' : ''}`} data-rank={r.rank} data-user={r.userId}>
      <span className="lb-rk">{num(r.rank)}</span>
      <span className="lb-nm">
        <span>{r.name}</span>
        {r.house ? <span className="lb-house"> · house</span> : null}
      </span>
      <span className="lb-pts">{fmt(r.points)}</span>
      <span className={`lb-d${d > 0 ? ' up' : d < 0 ? ' down' : ''}`}>{deltaText(d)}</span>
    </div>
  );
}

export default function LiveBoard({
  title, state, view, week = null, homeHref = '/', signedIn = false, signinHref = '/signin',
  firstKickoffLabel = null, slots = 6, minutes = 10,
  liveNote = 'Live totals from the box scores (about five minutes behind play). The settle\'s score is the ruling.',
  chips = [],
}) {
  const live = state === 'live';
  const pill = live ? `Live · Week ${week}` : state === 'final' ? `Final · Week ${week}` : week ? `Week ${week}` : null;
  const me = view?.me ?? null;
  const played = me?.played ?? null;

  return (
    <div className="lb" data-state={state}>
      <div className="lb-top">
        <Link className="lb-back" href={homeHref} aria-label={`Back to ${title}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </Link>
        <div className="lb-ttl">
          <h1>{title} · Board</h1>
          {pill ? <div className={`lb-pill${live ? ' live' : ''}`}>{live ? <i aria-hidden="true" /> : null}<span>{pill}</span></div> : null}
        </div>
        <span className="lb-sp" aria-hidden="true" />
      </div>

      <BoardChips chips={chips} />

      {state === 'none' || state === 'prekick' ? (
        <div className="lb-empty">
          <b>The board opens at first kickoff.</b>
          <span>{firstKickoffLabel ? `Kickoff ${firstKickoffLabel}. ` : ''}Totals start moving when the first game does.</span>
          <Link className="lb-cta" href={homeHref}>Set your lineup</Link>
        </div>
      ) : (
        <>
          <div className="lb-you">
            <div className="lb-you-hd">
              <span className="lb-eb">{me ? `You · ${me.name}` : signedIn ? 'You · not entered' : 'You'}</span>
              <span className="lb-of">{num(view.count)} playing</span>
            </div>
            {me ? (
              <>
                <div className="lb-you-row">
                  <div className="lb-you-rk">
                    <b>#{num(me.rank)}</b>
                    <span>{rankMoveText(me.dRank, minutes) ?? (live ? `movement shows after ${minutes} min` : 'final')}</span>
                  </div>
                  <div className="lb-you-pts">
                    <b>{fmt(me.points)}</b>
                    <span>{played == null ? 'points' : `${played} of ${slots} have played`}</span>
                  </div>
                </div>
                {played != null ? (
                  <div className="lb-bar" role="img" aria-label={`${played} of ${slots} have played`}>
                    <i style={{ width: `${Math.round((played / slots) * 100)}%` }} />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="lb-you-out">
                {signedIn
                  ? <Link href={homeHref}>{live ? 'You have no entry this week.' : 'No entry this week.'} Set one for next week</Link>
                  : <Link href={signinHref}>Sign in to see your rank</Link>}
              </div>
            )}
            {view.topTenCut != null ? <div className="lb-cut"><span>Top 10% cutoff · {fmt(view.topTenCut)}</span></div> : null}
          </div>

          <div className="lb-table">
            <div className="lb-row hd"><span className="lb-rk">Rank</span><span className="lb-nm">Player</span><span className="lb-pts">Pts</span><span className="lb-d">{minutes}m</span></div>
            {view.head.length ? view.head.map((r) => <Row key={r.userId} r={r} you={me?.userId === r.userId} />)
              : <div className="lb-row"><span className="lb-rk">—</span><span className="lb-nm">No entries this week.</span></div>}
            {view.around.length ? (
              <>
                {view.gap ? <div className="lb-gap" aria-hidden="true">· · ·</div> : null}
                {view.around.map((r) => <Row key={r.userId} r={r} you={me?.userId === r.userId} />)}
              </>
            ) : null}
          </div>
          <p className="lb-note">
            {live ? liveNote : 'Final scores from the settle.'}
          </p>
        </>
      )}
    </div>
  );
}
