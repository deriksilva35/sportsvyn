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

/**
 * ONE LINE PER GAME.
 *
 *   7:00 PM   PRE   DET @ CIN
 *   FINAL     PRE   DET 17 @ CIN 20
 *
 * The first version stacked a status block over a two-row team block, which is
 * three block elements and therefore three lines however it is styled - on a
 * phone each game stood about five lines tall and six games did not fit a
 * screen. No CSS fixes that; the structure had to change.
 *
 * The WHEN column carries one fact at a time: the kickoff before the game, the
 * live marker during it, FINAL after. A time next to a finished game is noise,
 * and a score next to a game that has not kicked off is a lie.
 */
function Row({ g }) {
  const final = g.status === 'final';
  const live = g.status === 'live';
  const played = final || live;
  const homeWin = final && g.homeScore > g.awayScore;
  const awayWin = final && g.awayScore > g.homeScore;
  const abbr = (t) => t?.abbreviation ?? t?.name ?? 'TBD';

  const body = (
    <>
      <span className={`tg-when${live ? ' live' : ''}${final ? ' final' : ''}`}>
        {live ? <><span className="tg-dot" />LIVE</> : null}
        {final ? 'FINAL' : null}
        {!played ? fmtTime(g.kickoffAt) : null}
      </span>
      <span className="tg-badge">{g.seasonPhase === 'PRE' ? 'PRE' : ''}</span>
      <span className="tg-match">
        <span className={`tg-side${awayWin ? ' win' : ''}${homeWin ? ' dim' : ''}`}>
          {abbr(g.away)}{played ? <b>{g.awayScore ?? ABSENT}</b> : null}
        </span>
        <span className="tg-at">@</span>
        <span className={`tg-side${homeWin ? ' win' : ''}${awayWin ? ' dim' : ''}`}>
          {abbr(g.home)}{played ? <b>{g.homeScore ?? ABSENT}</b> : null}
        </span>
      </span>
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
