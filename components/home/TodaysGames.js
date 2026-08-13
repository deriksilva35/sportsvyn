/**
 * TodaysGames - the homepage sidebar slate.
 *
 * The scorecard row, in miniature. Same vocabulary as /scores (status chip, PRE
 * badge, abbreviation, score or kickoff) at a third the width, because a reader
 * who has learned to read one should not have to learn the other.
 *
 * ABSENCE OVER INFERENCE, and here it means the whole unit. An empty day
 * renders NOTHING - not a frame, not a heading, not "no games today". The
 * caller checks for null and the sidebar closes up around it. A permanently
 * empty box in a rail is how the World Cup homepage's right column died.
 *
 * LIVE GAMES SORT FIRST, which getSlateByDate already does in SQL
 * (ORDER BY (status='live') DESC). This component does not re-sort, so the
 * ordering the scoreboard uses and the ordering here cannot drift.
 *
 * NFL ROWS LINK TO THE GAME PAGE. CFB ROWS DO NOT, because /cfb/game does not
 * exist - the college feed serves no scoring plays and no player lines, so
 * there is nothing behind a link. A dead link is worse than a plain row.
 */

import Link from 'next/link';
import { ABSENT } from '@/lib/gridiron/lineScore';

const ET = 'America/New_York';
const fmtTime = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: ET, hour: 'numeric', minute: '2-digit',
}).format(new Date(d));

function Row({ g }) {
  const final = g.status === 'final';
  const live = g.status === 'live';
  const played = final || live;
  const homeWin = final && g.homeScore > g.awayScore;
  const awayWin = final && g.awayScore > g.homeScore;

  const body = (
    <>
      <div className="tg-status">
        {live ? <span className="tg-live"><span className="tg-dot" />LIVE</span> : null}
        {final ? <span className="tg-final">FINAL</span> : null}
        {!played ? <span className="tg-time">{fmtTime(g.kickoffAt)}</span> : null}
        {g.seasonPhase === 'PRE' ? <span className="tg-pre">PRE</span> : null}
      </div>
      <div className="tg-teams">
        <div className={`tg-team${awayWin ? ' win' : ''}${homeWin ? ' lose' : ''}`}>
          <span className="tg-abbr">{g.away?.abbreviation ?? g.away?.name ?? 'TBD'}</span>
          <span className="tg-score">{played ? (g.awayScore ?? ABSENT) : ''}</span>
        </div>
        <div className={`tg-team${homeWin ? ' win' : ''}${awayWin ? ' lose' : ''}`}>
          <span className="tg-abbr">{g.home?.abbreviation ?? g.home?.name ?? 'TBD'}</span>
          <span className="tg-score">{played ? (g.homeScore ?? ABSENT) : ''}</span>
        </div>
      </div>
    </>
  );

  return g.leagueSlug === 'nfl'
    ? <Link className="tg-row tg-row--link" href={`/nfl/game/${g.slug}`}>{body}</Link>
    : <div className="tg-row">{body}</div>;
}

export default function TodaysGames({ slate, label }) {
  const nfl = slate?.byLeague?.nfl ?? [];
  const cfb = slate?.byLeague?.cfb ?? [];
  const games = [...nfl, ...cfb];
  if (games.length === 0) return null;

  // Live first across BOTH leagues, then the SQL order within each. Concatenating
  // the two league arrays would otherwise bury a live college game under a full
  // NFL slate that has not kicked off.
  const rows = [...games].sort((a, b) => (b.status === 'live') - (a.status === 'live'));

  return (
    <section className="tg" data-surface="ink" aria-label="Today's games">
      <div className="tg-head">
        <span className="tg-h">Today&rsquo;s Games</span>
        <span className="tg-n">{rows.length}</span>
      </div>
      {label ? <div className="tg-day">{label}</div> : null}
      <div className="tg-rows">
        {rows.map((g) => <Row key={`${g.leagueSlug}-${g.id}`} g={g} />)}
      </div>
      <Link className="tg-all" href="/scores">All scores &rarr;</Link>
    </section>
  );
}
