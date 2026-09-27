// components/boards/YouCard.js - the hybrid board's pinned "you" card, for the
// boards that keep their own page around it (/october/board, /run/board).
//
// The same markup and classes as LiveBoard's card (app/boards/board.css), so
// the two read as one family; it sits inside a `.lb .lb-embed` wrapper, which
// carries the tokens without the board page's frame. PURE: no hooks.

import Link from 'next/link';
import { rankMoveText } from '@/components/boards/LiveBoard';

const fmt = (n) => (n == null ? '–' : (Math.round(Number(n) * 10) / 10).toFixed(1));
const num = (n) => Number(n).toLocaleString('en-US');

/**
 * @param me        the reader's ranked row ({ rank, points, dRank }) or null
 * @param count     how many are on the board
 * @param label     the eyebrow's game word ("October", "The Run")
 * @param sideTitle the right column's caption under the total ("October", "Total")
 * @param sub       one fact under the total (e.g. "+12.5 today · 2 slots live")
 * @param live      whether movement applies (a settled board has none)
 */
export default function YouCard({ me = null, count = 0, name = null, label = 'You', sideTitle = 'points', sub = null,
  live = false, minutes = 10, signedIn = false, signinHref = '/signin', homeHref = '/', joinWord = 'Play' }) {
  return (
    <div className="lb lb-embed">
      <div className="lb-you">
        <div className="lb-you-hd">
          <span className="lb-eb">{me ? `${label} · ${name ?? 'you'}` : label}</span>
          <span className="lb-of">{num(count)} playing</span>
        </div>
        {me ? (
          <div className="lb-you-row">
            <div className="lb-you-rk">
              <b>#{num(me.rank)}</b>
              <span>{(live ? rankMoveText(me.dRank, minutes) : null) ?? `of ${num(count)}`}</span>
            </div>
            <div className="lb-you-pts">
              <b>{fmt(me.points)}</b>
              <span>{sub ?? sideTitle}</span>
            </div>
          </div>
        ) : (
          <div className="lb-you-out">
            {signedIn ? <Link href={homeHref}>{joinWord}</Link> : <Link href={signinHref}>Sign in to see your rank</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
