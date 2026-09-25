// components/scores/ScoresV2.js - the Scores tab v2 (docs/design/mocks/scores-tab-v0_2.html).
// A server component: it draws what lib/gridiron/scoresV2.js read. Day strip
// and pills are links (the page re-renders for the picked day and league);
// LiveRefresh mounts only when a card is live. Signed out: no Mine, no stake
// rows, "Sign in to pick" instead of "Pick".

import Link from 'next/link';
import StandaloneTime from '@/components/StandaloneTime';
import TeamMark from '@/components/team/TeamMark';
import { pairHasHeadgear } from '@/lib/teams/headgear';
import RankBadge from '@/components/gridiron/RankBadge';
import PossessionDot from '@/components/gridiron/PossessionDot';
import LiveRefresh from '@/components/scores/LiveRefresh';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { orderFor } from '@/lib/gridiron/teamOrder';
import { possessionSide } from '@/lib/gridiron/possession';
import { shortOf, BASEBALL, sportOf } from '@/lib/live/vocabulary';
import { LEAGUE_LABEL, abbrOf, cardVariant, countLine, pickTone, statLineText, oddsLine, eplBar, weekdayOf } from '@/lib/gridiron/scoresV2Shape';

// THE SITE'S STRAIGHT APOSTROPHE, everywhere on this tab (GO rider 1).
const PICKEM = "Pick'em";

const href = ({ date, sport = 'all', mine = false, top25 = false }) => {
  const p = new URLSearchParams();
  if (date) p.set('date', date);
  if (sport !== 'all') p.set('sport', sport);
  if (mine) p.set('mine', '1');
  // TOP 25 RIDES ONLY WHERE IT CAN MEAN SOMETHING. It is a CFB filter, so an
  // NFL or EPL pill drops it rather than handing the reader an empty board.
  if (top25 && (sport === 'all' || sport === 'cfb')) p.set('top25', '1');
  const q = p.toString();
  return q ? `/scores?${q}` : '/scores';
};

function liveLabel(g) {
  const ls = g.liveState ?? {};
  // BASEBALL: the half and the inning, and NO CLOCK EVER. The scores feed
  // sends clock 0 and "0:00" on every MLB row - scheduled, live and final
  // alike - so the football branch below would put a stopped clock on a live
  // game. lib/live/vocabulary.js hasClock() is where that is decided.
  if (sportOf(g.leagueSlug) === BASEBALL) return shortOf(ls, BASEBALL) ?? 'Live';
  if (g.leagueSlug === 'epl') {
    const p = ls.period ?? null; const el = ls.elapsed ?? null;
    return p === 'HT' ? 'HT' : el != null ? `${el}'${ls.extra ? `+${ls.extra}` : ''}` : 'Live';
  }
  const q = ls.period ?? null; const c = ls.clock ?? null;
  return q ? `Q${q}${c ? ` · ${c}` : ''}` : 'Live';
}

function TeamRow({ t, score, trail, record, pick, pct, scored, rank = null, hasBall = false, leagueSlug = null, headgear = true, dressed = true }) {
  const ab = abbrOf(t);
  return (
    <div className={`sv2-team${trail ? ' trail' : ''}`}>
      <TeamMark primary={dressed ? t.colors?.primary : null} secondary={dressed ? t.colors?.secondary : null} abbr={ab} size={24} title={t.name}
        headgearKey={t.abbreviation ?? null}
        leagueSlug={leagueSlug} headgear={headgear} />
      {/* THE DOT RIDES THE ABBREVIATION, not the situation line under it. The
          line used to end with "ALA ball"; the row it was describing is right
          there, and a mark on that row says it without spending a line on it.
          One reader decides which row gets it - lib/gridiron/possession.js. */}
      <span className="ab">{ab}{hasBall ? <PossessionDot abbr={ab} /> : null}</span>
      {/* THE AP NUMBER SITS INSIDE THE NAME, not beside the score: it is part
          of what the team is called this week, and RankBadge renders nothing
          at all when the side is unranked or the league is not CFB. */}
      <span className="nm"><RankBadge rank={rank} />{t.shortName ?? t.name}{record ? <span className="rec">{record}</span> : null}</span>
      {pick ? <span className="pk">Your pick</span> : null}
      {scored ? <b className="n">{score ?? 0}</b> : pct != null ? <b className="n pct">{pct}%</b> : null}
    </div>
  );
}

/**
 * THE RUNNERS DIAMOND. Three squares, filled from the bases.
 *
 * IT RENDERS NOTHING AT ALL WHEN THE BASES ARE UNKNOWN, and that is the whole
 * contract: the scores feed carries no runners at all, so with MLB_STATSAPI
 * off `bases` is null on every game, and three empty squares would be a claim
 * ("nobody on") made on every pitch of every game on no evidence.
 * Known-and-empty is a different thing and DOES draw - three outlines.
 *
 * SECOND IS DRAWN ABOVE, first right and third left, which is the diamond as a
 * reader looks at a field from behind the plate. The order in the DOM is
 * second, third, first so a screen reader hears them in that same spatial
 * order rather than in the order they happen to be stored.
 */
function Diamond({ bases }) {
  // The mock's own `.dia.none` is a SPACER for the between-halves frame, not
  // a state: with the strip's 1fr auto 1fr an absent middle column lays out
  // identically, so there is nothing to render for it either.
  if (!bases) return null;
  const sq = (on, cls) => <i className={`d-b ${cls}${on ? ' on' : ''}`} />;
  return (
    <span className="sv2-diamond" role="img"
      aria-label={[bases.first && '1st', bases.second && '2nd', bases.third && '3rd']
        .filter(Boolean).join(', ') || 'bases empty'}>
      {/* SECOND, THIRD, FIRST - the mock's own DOM order, which is also the
          spatial one a reader behind the plate sees: top, then left, then
          right. A screen reader hears the aria-label above and none of this. */}
      {sq(bases.second, 'b2')}
      {sq(bases.third, 'b3')}
      {sq(bases.first, 'b1')}
    </span>
  );
}

function Stake({ stake, g, boardOpen, signinHref, signedIn }) {
  if (!signedIn) return null;
  const chips = [];
  if (stake?.pick) {
    const st = stake.pick.state;
    const mark = st === 'won' ? ' ✓' : st === 'lost' ? ' ✗' : '';
    chips.push(<span key="pick" className={pickTone(st)}>{PICKEM} <b>{stake.pick.abbr}{mark}</b></span>);
  } else if (boardOpen) {
    chips.push(<Link key="nopick" className="none" href={`/pickem/${g.leagueSlug}`}>No pick yet</Link>);
  }
  if (stake?.weekly?.length) {
    const pts = Math.round(stake.weekly.reduce((a, r) => a + r.points, 0) * 10) / 10;
    const names = stake.weekly.map((r) => r.name.split(/\s+/).pop()).join(', ');
    chips.push(<span key="wk" className={pts > 0 ? 'good' : ''}>Weekly · {names} <b>{g.status === 'scheduled' ? `${stake.weekly.length} player${stake.weekly.length === 1 ? '' : 's'}` : pts}</b></span>);
  }
  if (!chips.length) return null;
  return <div className="sv2-stake" data-stake="1">{chips}</div>;
}

function Card({ g, x, signedIn, signinHref, tz }) {
  const v = cardVariant(g);
  const live = v === 'live', final = v === 'final';
  const scored = live || final;
  const homeLeads = g.homeScore != null && g.awayScore != null && g.homeScore > g.awayScore;
  const awayLeads = g.homeScore != null && g.awayScore != null && g.awayScore > g.homeScore;
  const bar = !scored || live ? eplBar(x.prob, g) : null;
  const pctFor = (side) => (x.prob && !scored ? Math.round(side === 'home' ? x.prob.home : x.prob.away) : null);
  const odds = oddsLine(g, x.spreadHome, x.total);
  const boardOpen = !scored && (g.leagueSlug === 'nfl' || g.leagueSlug === 'cfb');
  const stat = final ? statLineText(x.stat, g.leagueSlug) : null;
  const pickAbbr = x.stake?.pick?.abbr ?? null;
  // WHICH ROW HAS THE BALL, asked once, of the one reader. The card holds the
  // clock as well as the drive, so a halftime or an end-of-quarter card keeps
  // its down-distance-spot - the ball WILL be spotted there - and carries no
  // dot, because at 0:00 nobody has it.
  const ball = possessionSide({
    leagueSlug: g.leagueSlug, status: g.status, possession: x.drive?.offenseAbbr ?? null,
    homeAbbr: abbrOf(g.home), awayAbbr: abbrOf(g.away), liveState: g.liveState,
  });
  const baseball = sportOf(g.leagueSlug) === BASEBALL;
  // BOTH OR NEITHER: one cutout beside one disc reads as a favourite.
  // THE STORED LETTERS, not the printed ones: an FCS side prints letters it
  // derived from its name, and some of them are an FBS team's key.
  const headgear = pairHasHeadgear(g.leagueSlug, g.away?.abbreviation ?? null, g.home?.abbreviation ?? null);
  // AND THE STYLE IS A PAIR TOO: when one side has no colours (an FCS club),
  // both draw the plain abbreviation disc - a two-tone disc beside a plain one
  // reads as a favourite just as a helmet beside a disc does.
  const dressed = Boolean(g.away?.colors && g.home?.colors);
  const gameHref = g.leagueSlug === 'epl' ? `/match/${g.slug}` : `/${g.leagueSlug}/game/${g.slug}`;
  return (
    <a className={`sv2-card${live ? ' live' : ''}${final ? ' final' : ''}`} href={gameHref} data-variant={v} data-league={g.leagueSlug}>
      <div className="sv2-lbl">
        {live ? <span className="l">{liveLabel(g)}</span>
          : final ? <span>Final · {g.etWeekday ?? weekdayOf(g.kickoffAt.slice(0, 10))}</span>
            : <span><StandaloneTime iso={g.kickoffAt} /></span>}
        <span>{LEAGUE_LABEL[g.leagueSlug]}{g.network ? ` · ${g.network}` : ''}</span>
        <span className="bell">{x.stake?.alerts ? (live ? 'Alerts on' : 'Alerts') : ''}</span>
      </div>
      {/* WHO GOES FIRST IS THE LEAGUE'S RULE, not this card's - away-first
          for gridiron, home-first for soccer (lib/gridiron/teamOrder.js). */}
      {orderFor(g.leagueSlug).map((side) => {
        const t = side === 'home' ? g.home : g.away;
        return (
          <TeamRow
            key={side} t={t} leagueSlug={g.leagueSlug} headgear={headgear} dressed={dressed}
            score={side === 'home' ? g.homeScore : g.awayScore}
            trail={scored && (side === 'home' ? awayLeads : homeLeads)}
            record={x.record[side]} pick={pickAbbr != null && pickAbbr === abbrOf(t)}
            pct={pctFor(side)} scored={scored} rank={x.rank?.[side] ?? null}
            hasBall={ball === side}
          />
        );
      })}
      {/* THE BASEBALL STRIP TAKES THE DRIVE STRIP'S SLOT, and the two are
          mutually exclusive by construction: `diamond` is null on every
          non-MLB card and `drive` is null on every MLB one. */}
      {live && x.diamond && (
        <>
          {/* THREE CELLS, LEFT TO RIGHT: outs and the half, the diamond, the
              count. lib/mlb/strip.js decides every word in them - this file
              writes no baseball vocabulary at all, which is why "changing
              sides" and the half-into-the-lead rule are testable. */}
          <div className="sv2-strip sv2-bb" data-baseball="1">
            <span className="st">{x.diamond.lead}{x.diamond.sub ? <small>{x.diamond.sub}</small> : null}</span>
            <Diamond bases={x.diamond.bases} />
            <span className="cnt">{x.diamond.count ? <><small>count</small>{x.diamond.count}</> : null}</span>
          </div>
          {/* THE PLAY SITS BENEATH THE STRIP, not inside it - the mock's own
              <p class="lp">. A scoring play is a sentence and the strip is a
              row of three columns; putting it in the third column is what
              turned it into an ellipsis on the football card. */}
          {x.diamond.lastPlay ? <p className="sv2-lp">{x.diamond.lastPlay}</p> : null}
        </>
      )}
      {live && x.drive && (
        <div className="sv2-strip" data-drive="1">
          {/* DOWN, DISTANCE, SPOT - and nothing else. "ALA ball" used to sit
              beside this; the volt dot on the team row above says it now. */}
          <span className="dd">{x.drive.label}{x.drive.spot ? <small>{x.drive.spot}</small> : null}</span>
          {x.drive.pct != null && <div className="field"><u style={{ left: 0, width: `${x.drive.pct}%` }} /><i style={{ left: `${x.drive.pct}%` }} /></div>}
          {x.drive.lastPlay ? <span className="lp">{x.drive.lastPlay}</span> : null}
        </div>
      )}
      {live && bar && (
        <div className="sv2-wp" data-winprob="epl"><div className="t"><span>Win prob</span><span>{bar.abbr} {bar.pct}%</span></div><div className="bar"><i style={{ width: `${bar.pct}%` }} /></div></div>
      )}
      <Stake stake={x.stake} g={g} boardOpen={boardOpen} signinHref={signinHref} signedIn={signedIn} />
      {final ? (
        <div className="sv2-foot">
          {/* THE FOOT IS THE GAME, NOT THE READER (addendum 6): the stat
              line and the box score. The pick result lives in the stake row
              and nowhere else, so a final never says it twice.

              BASEBALL'S IS THE WINNING PITCHER AND THE BAT OF THE NIGHT, per
              the mock - a different sentence from a different table, chosen
              by the sport rather than by a league branch inside the shaper. */}
          <span>{baseball ? (x.mlbFoot ? <b>{x.mlbFoot}</b> : 'Final') : (stat ? <b>{stat}</b> : 'Final')}</span>
          {x.hasStats ? <span className="go">Box score &rarr;</span> : null}
        </div>
      ) : !live && baseball ? (
        /* PRE-GAME BASEBALL IS THE PROBABLES AND THE LINE, and NOT a Pick'em
           call to action: there is no MLB board, so "Sign in to pick" would
           offer a game that cannot be picked. The generic foot below still
           serves the two football leagues and the EPL unchanged. */
        <div className="sv2-foot" data-pre="mlb">
          <span>{[x.probables, odds].filter(Boolean).join(' · ') || 'No line yet'}</span>
          {x.preview ? <span className="go">Preview &rarr;</span> : null}
        </div>
      ) : !live ? (
        <div className="sv2-foot">
          <span>{odds ?? 'No line yet'}</span>
          {/* GO rider 2: "Change pick" while picked and still open, "Preview"
              only with an article and no pick, otherwise no element at all. */}
          {!signedIn
            ? <span className="go">Sign in to pick</span>
            : x.stake?.pick && x.open
              ? <span className="go">Change pick →</span>
              : !x.stake?.pick && x.preview
                ? <span className="go">Preview →</span>
                : null}
        </div>
      ) : null}
    </a>
  );
}

export default function ScoresV2({ v, signedIn = false, isShell = false, zoneLabel = 'Eastern' }) {
  const signinHref = shellSigninHref('/scores', isShell);
  const pills = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB'], ['epl', 'EPL']];
  return (
    <div className="sv2" data-surface="ink">
      {v.liveCount > 0 && <LiveRefresh />}
      <div className="sv2-head">
        <div><h1>Scores</h1><div className="sv2-eb q">{weekdayOf(v.date, true)} · all times {zoneLabel}</div></div>
        <div className="sv2-eb" data-live-count={v.liveCount}>{v.liveCount > 0 ? `${v.liveCount} live` : ''}</div>
      </div>
      <div className="sv2-days" data-section="days">
        {v.days.map((d) => {
          const c = countLine(d.counts);
          return (
            <Link key={d.date} className={`sv2-day${d.on ? ' on' : ''}${c.live ? ' live' : ''}`} href={href({ date: d.date, sport: v.sport, mine: v.mine, top25: v.top25 })} data-date={d.date}>
              <small>{d.dow}</small><b>{d.day}</b><i>{c.text}</i>
            </Link>
          );
        })}
      </div>
      <div className="sv2-filt" data-section="pills">
        {pills.map(([k, label]) => (
          <Link key={k} className={`sv2-pill${v.sport === k ? ' on' : ''}`} href={href({ date: v.date, sport: k, mine: v.mine, top25: v.top25 })}>{label}</Link>
        ))}
        {/* THE FIFTH PILL, AND ONLY WHEN IT WOULD FIND SOMETHING (R5). No
            ranked CFB game on the picked day under the league filter in
            force, no pill - the reader is never offered a filter that
            empties the board. */}
        {v.rankedToday && (
          <Link className={`sv2-pill top25${v.top25 ? ' on' : ''}`} href={href({ date: v.date, sport: v.sport, mine: v.mine, top25: !v.top25 })} data-top25={v.top25 ? '1' : '0'}>Top 25</Link>
        )}
        <span className="sp" />
        {signedIn && <Link className={`sv2-pill mine${v.mine ? ' on' : ''}`} href={href({ date: v.date, sport: v.sport, mine: !v.mine, top25: v.top25 })} data-mine-count={v.mineCount}>Mine · {v.mineCount}</Link>}
      </div>
      {/* A NON-TODAY DAY COLLAPSES THE LIVE GAMES TO ONE LINE (DAY PICK
          LEADS relay item 2). The day the reader picked leads the page. */}
      {v.liveAway && (
        <Link className="sv2-liveaway" href="/scores" data-liveaway={v.liveAway.count}>
          {v.liveAway.count} live now <span>Back to today &rarr;</span>
        </Link>
      )}
      {v.groups.length === 0 && <p className="sv2-empty">No {v.top25 ? 'ranked ' : ''}games {v.mine ? 'with a stake ' : ''}on this day.</p>}
      {v.groups.map((grp) => (
        <section key={grp.key} className="sv2-group" data-group={grp.key}>
          <div className="sv2-gh"><h2>{grp.title}</h2><small>{grp.sub}</small></div>
          <div className="sv2-list">
            {grp.games.map((g) => <Card key={g.id} g={g} x={v.extras.get(g.id)} signedIn={signedIn} signinHref={signinHref} tz={v.tz} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
