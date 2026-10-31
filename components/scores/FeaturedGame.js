// components/scores/FeaturedGame.js - the landscape board's featured card (scores-landscape).
//
// One game, wide: the card face on the left, the live read in the middle, the
// reader's stake on the right. WHICH game is lib/scores/featured.js pickFeatured
// (the first of "in your games" when signed in, else the first live game, else
// nothing - in which case this renders nothing at all).
//
// THE MIDDLE IS THE SPORT'S OWN READ, drawn from what scoresV2 already put on
// the row, never recomputed:
//   NFL / CFB  the win-probability bar (liveWinProbView, where
//              lib/winprob/display.js says it is displayed) and the down and
//              distance line (fieldLine of x.drive)
//   NBA        the last play (lastPlayText of g.nbaDetail); NO win probability
//   MLB        the diamond strip (x.diamond: situation, count, last play)
//
// The card is a <section>, not an .sv4-card: it is the board's second look at
// a game already in the grid, and a second article per game would double every
// count that walks the cards. The whole card links to the game (the overlay
// link); the links inside the face sit above it, as on every card.

import Link from 'next/link';
import { CardFace } from '@/components/scores/ScoreboardV4';
import { liveWinProbView } from '@/components/gridiron/LiveWinProb';
import { winProbDisplayed } from '@/lib/winprob/display';
import { fieldLine } from '@/lib/scores/v4';
import { lastPlayText } from '@/lib/nba/card';
import { abbrOf } from '@/lib/gridiron/scoresV2Shape';
import { isSoccerSlug, matchHref } from '@/lib/soccer/leagues';
import { sportOf, BASEBALL, BASKETBALL } from '@/lib/live/vocabulary';

const MAX_STAKE_LINES = 3;

const hrefOf = (g) => (isSoccerSlug(g.leagueSlug) ? matchHref(g.leagueSlug, g.slug) : `/${g.leagueSlug}/game/${g.slug}`);

/** The stake as lines: the pick first, then the Weekly's players. [{ key, left, right }] */
export function stakeLines(stake, g) {
  const out = [];
  if (stake?.pick) {
    const st = stake.pick.state;
    out.push({ key: 'pick', left: "Pick'em", right: `${stake.pick.abbr ?? ''}${st === 'won' ? ' ✓' : st === 'lost' ? ' ✗' : ''}`.trim() });
  }
  for (const [i, r] of (stake?.weekly ?? []).entries()) {
    const name = String(r.name ?? '').split(/\s+/).pop();
    out.push({ key: `wk${i}`, left: name, right: g.status === 'scheduled' ? (r.pos ?? '') : String(Math.round(Number(r.points) * 10) / 10) });
  }
  return out;
}

function Read({ g, x, now }) {
  const sport = sportOf(g.leagueSlug);
  const live = g.status === 'live';
  if (sport === BASKETBALL) {
    const lp = live ? lastPlayText(g.nbaDetail) : null;
    return lp ? <><span className="eb">LAST PLAY</span><p className="lp" data-last-play="1">{lp}</p></> : null;
  }
  if (sport === BASEBALL) {
    const d = live ? x.diamond : null;
    if (!d) return null;
    return (
      <>
        <span className="eb">ON THE DIAMOND</span>
        <p className="sit" data-baseball="1">{d.lead}{d.sub ? ` ${d.sub}` : ''}{d.count ? ` - count ${d.count}` : ''}</p>
        {d.lastPlay ? <p className="lp">{d.lastPlay}</p> : null}
      </>
    );
  }
  // FOOTBALL (and anything else that carries a drive).
  const v = live && winProbDisplayed(g.leagueSlug) ? liveWinProbView(g.liveState, now) : null;
  const field = live ? fieldLine(x.drive) : { line: null };
  if (!v && !field.line) return null;
  return (
    <>
      {v ? (
        <>
          <span className="eb">WIN PROBABILITY</span>
          <div className="wpl" data-winprob-bar="1"><span>{abbrOf(g.away)} {v.away}%</span><span>{abbrOf(g.home)} {v.home}%</span></div>
          <div className="wpbar" role="img" aria-label={`Win probability: ${abbrOf(g.away)} ${v.away}%, ${abbrOf(g.home)} ${v.home}%`}>
            <span className="a" style={{ width: `${v.away}%` }} /><span className="h" style={{ width: `${v.home}%` }} />
          </div>
        </>
      ) : null}
      {field.line ? <p className="sit" data-sit="1">{field.line}</p> : null}
    </>
  );
}

export default function FeaturedGame({ pick, signedIn = false, signinHref = '/signin', tz, now = new Date() }) {
  if (!pick) return null;
  const { g, x, label } = pick;
  const lines = stakeLines(x.stake, g);
  const shown = lines.slice(0, MAX_STAKE_LINES);
  const more = lines.length - shown.length;
  const away = g.away?.shortName ?? g.away?.name;
  const home = g.home?.shortName ?? g.home?.name;
  return (
    <section className="sv4-featured" data-featured="1" data-featured-id={g.id} data-league={g.leagueSlug}>
      <Link className="sv4-fhit" href={hrefOf(g)} aria-label={`${away} at ${home}`} />
      <div className="f-face" data-variant={g.status}>
        <span className="f-label" data-featured-label="1">{label}</span>
        <CardFace g={g} x={x} signedIn={signedIn} signinHref={signinHref} tz={tz} now={now} />
      </div>
      <div className="f-read">
        <Read g={g} x={x} now={now} />
      </div>
      <div className="f-stake">
        {shown.length ? (
          <>
            <span className="eb">YOUR STAKE</span>
            {shown.map((l) => <div key={l.key} className="row"><span>{l.left}</span><b>{l.right}</b></div>)}
            {more > 0 ? <span className="more" data-more="1">+{more}</span> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
