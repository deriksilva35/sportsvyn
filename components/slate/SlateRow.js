// components/slate/SlateRow.js — the canonical game row.
//
// ONE GRAMMAR, TWO SURFACES. This markup was inline in WeekSlate and duplicated
// in spirit across the front page's bands; /my was rendering the same games in
// a different dialect, so a reader could see "PIT at BUF" set as display type
// on the front page and as a mono data row on their own dashboard. A matchup is
// display type; a data row is data. This is the display-type one.
//
// STATE COMES FROM lib/today/slateRow.js AND NOWHERE ELSE. This file decides
// what a row LOOKS like; rowState decides what it IS. Keeping those apart is
// why /scores, the front page and /my cannot disagree about whether a game is
// live - and it is the reason this component takes a game, not a pile of
// pre-computed booleans.
//
// THE COLUMNS ARE FIXED at 52px / 1fr / auto so matchups line up down a card
// regardless of how long a club's name is. That is the same reason the /scores
// card fixes its abbreviation column.

import Link from 'next/link';
import { rowState } from '@/lib/today/slateRow';
import './slateRow.css';

// NFL AND CFB ONLY, exactly as the front page had it. Adding epl here turned
// every EPL row from a <div> into an <a> and moved 252 tag lines on a page this
// relay must not touch. A soccer match page exists, so linking these is a
// defensible FUTURE change - but it is a change, not part of an extraction, and
// it does not get made under cover of one.
const GAME_ROUTE = { nfl: '/nfl/game', cfb: '/cfb/game' };
const abbr = (t) => t?.abbreviation ?? t?.name ?? 'TBD';

/**
 * @param g        a game DTO (kickoffAt, status, scores, home/away, week…)
 * @param onBoard  render the Board pill
 * @param tag      override the meta sub-line (panels carry their own context -
 *                 a lock time on Pick'em, the followed team on Your Schedule -
 *                 and that context is the panel's, not this component's)
 * @param state    override the right-hand state word (defaults Live/FT/Preview)
 * @param href     override the destination; null disables the link entirely
 */
export default function SlateRow({ g, onBoard = false, tag, state, href }) {
  const { live, final, played, homeWin, awayWin, isPreseason, when, day } = rowState(g);
  const body = (
    <>
      <div className={`when${live ? ' live' : ''}`}>
        {day}<br />
        {live ? <><span className="sdot" />LIVE</> : when}
      </div>
      <div>
        <div className="mu">
          <span className={awayWin ? 'win' : homeWin ? 'dim' : undefined}>{abbr(g.away)}</span>
          {' '}<span className="at">at</span>{' '}
          <span className={homeWin ? 'win' : awayWin ? 'dim' : undefined}>{abbr(g.home)}</span>
          {onBoard ? <span className="onboard">Board 1</span> : null}
        </div>
        <div className="stag">
          {/* THE TWO EXPRESSIONS STAY TWO. Collapsing them into one template
              string renders the same characters and a DIFFERENT DOM: React
              emits a <!-- --> separator between adjacent text children, and
              merging them removed one per row - 258 changed tag lines on a
              page that was supposed to be untouched. An extraction that
              alters the output is not an extraction. */}
          {tag != null ? tag : <>{isPreseason ? 'PRE · ' : ''}{g.week != null ? `Wk ${g.week}` : ''}</>}
        </div>
      </div>
      <div className="fin">
        {played ? `${g.awayScore ?? '—'}-${g.homeScore ?? '—'}` : null}
        <span className="s2">{state ?? (live ? 'Live' : final ? 'FT' : 'Preview')}</span>
      </div>
    </>
  );
  const route = href === null ? null : (href ?? (GAME_ROUTE[g.leagueSlug] ? `${GAME_ROUTE[g.leagueSlug]}/${g.slug}` : null));
  return route
    ? <Link className="srow srow--link" href={route}>{body}</Link>
    : <div className="srow">{body}</div>;
}
