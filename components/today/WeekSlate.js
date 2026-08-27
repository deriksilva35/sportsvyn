// components/today/WeekSlate.js - the league's week, first module in its band.
//
// THE ROW GRAMMAR IS THE MOCK'S srow: when / matchup / state. The live and
// final DECISIONS come from lib/today/slateRow.js, which TodaysGames also uses
// - two presentations, one decision-maker, so a game cannot read LIVE in the
// band and scheduled in the rail on the same screen.
//
// CAPPED AT SIX with a link to the full scoreboard. CFB week 1 is 99 games;
// a band module that tried to be a scoreboard would be a worse scoreboard than
// the scoreboard.

import Link from 'next/link';
import { rowState, orderSlate, SLATE_ROW_CAP } from '@/lib/today/slateRow';

const GAME_ROUTE = { nfl: '/nfl/game', cfb: '/cfb/game' };
const abbr = (t) => t?.abbreviation ?? t?.name ?? 'TBD';

function SlateRow({ g, onBoard }) {
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
          {isPreseason ? 'PRE · ' : ''}{g.week != null ? `Wk ${g.week}` : ''}
        </div>
      </div>
      <div className="fin">
        {played ? `${g.awayScore ?? '—'}-${g.homeScore ?? '—'}` : null}
        <span className="s2">{live ? 'Live' : final ? 'FT' : 'Preview'}</span>
      </div>
    </>
  );
  const route = GAME_ROUTE[g.leagueSlug];
  return route
    ? <Link className="srow srow--link" href={`${route}/${g.slug}`}>{body}</Link>
    : <div className="srow">{body}</div>;
}

export default function WeekSlate({ slate, boardIds, scoresHref, label }) {
  if (!slate?.games?.length) return null;
  const ordered = orderSlate(slate.games);
  const shown = ordered.slice(0, SLATE_ROW_CAP);
  const hidden = ordered.length - shown.length;
  // The heading states the week the DATA says, never a calendar week.
  const weekLabel = slate.week != null
    ? `${slate.phase === 'PRE' ? 'Preseason wk' : 'Week'} ${slate.week}`
    : null;
  return (
    <div className="mod">
      <div className="eb">
        <span>This week</span>
        <span className="ctx">
          {weekLabel}{boardIds?.size ? ' · Board 1 marked' : ''}
        </span>
      </div>
      {shown.map((g) => (
        <SlateRow key={g.id} g={g} onBoard={boardIds?.has(g.id)} />
      ))}
      <a className="ghostcta" href={scoresHref}>
        {hidden > 0 ? `Full scoreboard · ${hidden} more` : 'Full scoreboard'} &rarr;
      </a>
    </div>
  );
}
