'use client';
// components/daily/season/OpenReveal.js - a finished Daily run, while the day is open.
//
// THE REVEAL SEQUENCE (1b, ruling 27 Sep), drawn to the hybrid live board's
// pinned "you" card: the eight slots land one at a time with their points,
// then the card with the total, your rank among finished runs, "you beat X% of
// today's players" and the streak. Below it, today's board of finished runs.
// What is NOT here is the point: no best roster, no ceiling, no hit marks -
// the data never reached this component (lib/daily/openReveal.js), so there
// is nothing to hide. The perfect roster arrives at midnight ET, as before.
//
// THE BOARD MOVES ONLY AS RUNS FINISH, so it refreshes on a slow clock (60 s)
// while the tab is visible - LiveRefresh re-renders the page, whose fresh
// reveal replaces this one (SeasonBoard prefers the page's prop).
//
// THE SEQUENCE IS CSS: each row carries its index and animates in after the
// one before it; prefers-reduced-motion shows everything at once
// (openReveal.css). No timers, so a re-render never replays it half-way.

import LiveRefresh from '@/components/scores/LiveRefresh';
import DailyShare from '@/components/daily/season/DailyShare';
import { shareCardModel, shareText, CARD_PATH } from '@/lib/daily/shareCard';
import '@/app/boards/board.css';
import './openReveal.css';

const fmt = (n) => (n == null ? '–' : (Math.round(Number(n) * 10) / 10).toFixed(1));
const num = (n) => Number(n).toLocaleString('en-US');

/** "you beat 72% of today's players" / "first to finish today" / ties everyone. */
export function beatLine(beatPct, of) {
  if (beatPct == null) return of <= 1 ? 'first to finish today' : null;
  return `you beat ${beatPct}% of today's players`;
}

function BoardRow({ r, you }) {
  return (
    <div className={`lb-row${you ? ' you' : ''}`} data-rank={r.rank} data-user={r.userId}>
      <span className="lb-rk">{num(r.rank)}</span>
      <span className="lb-nm"><span>{r.name}</span>{r.house ? <span className="lb-house"> · house</span> : null}</span>
      <span className="lb-pts">{fmt(r.points)}</span>
    </div>
  );
}

/**
 * THE SAME-DAY SHARE (relay mon-12): the card with every pick hidden. The text
 * is built from the same pure model the image is (lib/daily/shareCard.js), from
 * the slot LABELS only - this component holds the run's names, the share never
 * receives them.
 */
export function openShareText({ editionDate, season, streak, total, slots }) {
  return shareText(shareCardModel({ phase: 'open', editionDate, seasonYear: season, streak, score: total, slots }));
}

export default function OpenReveal({ edition, reveal, refreshMs = 60_000, share = null, claim = null }) {
  const { rows = [], total, rank, of, beatPct, streak, board } = reveal ?? {};
  const meId = board?.me?.userId ?? null;
  const line = beatLine(beatPct, of);
  const canShare = share?.editionDate && share?.season;
  return (
    <div className="lb dr" data-state="open">
      {refreshMs ? <LiveRefresh everyMs={refreshMs} /> : null}
      <div className="lb-top">
        <span className="lb-sp" aria-hidden="true" />
        <div className="lb-ttl">
          <h1>The Daily · Board</h1>
          <div className="lb-pill live"><i aria-hidden="true" /><span>{edition ? `${edition.replace(/^The Daily · /, '')} · open` : 'Open'}</span></div>
        </div>
        <span className="lb-sp" aria-hidden="true" />
      </div>

      <div className="dr-slots" aria-label="Your roster">
        {rows.map((r, i) => (
          <div key={`${r.slot}-${i}`} className="dr-slot" style={{ '--i': i }} data-slot={r.slot}>
            <span className="dr-pos">{r.slot}</span>
            <span className="dr-who">{r.name ?? 'Empty'}{r.team ? <small> {r.team}</small> : null}</span>
            <span className="dr-pts">{fmt(r.points)}</span>
          </div>
        ))}
      </div>

      <div className="lb-you dr-you" style={{ '--i': rows.length }}>
        <div className="lb-you-hd">
          <span className="lb-eb">{board?.me ? `You · ${board.me.name}` : 'You'}</span>
          <span className="lb-of">{num(of ?? 0)} finished</span>
        </div>
        <div className="lb-you-row">
          <div className="lb-you-rk">
            <b>{rank != null ? `#${num(rank)}` : '–'}</b>
            {line ? <span>{line}</span> : null}
          </div>
          <div className="lb-you-pts">
            <b>{fmt(total)}</b>
            <span>points</span>
          </div>
        </div>
        {claim?.signInHref ? (
          <a className="sbd-btn dr-claim" style={{ display: 'block', marginTop: 12, textAlign: 'center', textDecoration: 'none' }} href={claim.signInHref}>
            Sign in to keep your streak
          </a>
        ) : null}
        <div className="lb-cut">
          <span>{claim ? 'Not on the board yet' : streak != null && streak > 0 ? `🔥 ${streak} day streak` : 'Streak starts today'}</span>
          <span>Perfect roster at midnight ET</span>
        </div>
        {canShare ? (
          <DailyShare
            className="dr-share"
            label="Share your score"
            cardUrl={CARD_PATH(share.editionDate)}
            editionDate={share.editionDate}
            text={openShareText({ editionDate: share.editionDate, season: share.season, streak, total, slots: rows.map((r) => r.slot) })}
          />
        ) : null}
      </div>

      <div className="lb-table dr-table">
        <div className="lb-row hd"><span className="lb-rk">Rank</span><span className="lb-nm">Today</span><span className="lb-pts">Pts</span></div>
        {(board?.head ?? []).map((r) => <BoardRow key={r.userId} r={r} you={r.userId === meId} />)}
        {board?.around?.length ? (
          <>
            {board.gap ? <div className="lb-gap" aria-hidden="true">· · ·</div> : null}
            {board.around.map((r) => <BoardRow key={r.userId} r={r} you={r.userId === meId} />)}
          </>
        ) : null}
      </div>
      <p className="lb-note">Finished runs only - the board moves as more players finish. Everyone&rsquo;s picks and the perfect roster unlock at midnight ET.</p>
    </div>
  );
}
