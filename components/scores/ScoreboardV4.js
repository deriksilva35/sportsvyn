// components/scores/ScoreboardV4.js - the arcade Scoreboard (scores-v4).
//
// Rendered by app/scores/page.js ONLY under data-theme="arcade"; the dark page
// keeps ScoresV2, untouched, and /nfl/scores and /cfb/scores keep ScoresView.
// Mock: the Design canvas's board A (Marquee), rulings mon-16 (a)-(f).
//
// A SERVER COMPONENT that draws what lib/gridiron/scoresV2.js read - the same
// reader, the same extras, the same Yours band - plus the narrowing and the
// foot lines lib/scores/v4.js decides. Every link on the page is built by
// v4Href there, so the chip grammar is one function with one test.
//
// ORDER, top to bottom: the head, the Yours strip (pinned above the day rail,
// exactly withYoursBand's band), the day rail with its counts, the chip row
// (sport pills, then ● Live · Yours · Top 25 · Close · Tonight; it scrolls
// sideways), the conference picker on CFB, then the groups.

import Link from 'next/link';
import StandaloneTime from '@/components/StandaloneTime';
import ZoneLabel from '@/components/scores/ZoneLabel';
import TeamMark from '@/components/team/TeamMark';
import { pairHasHeadgear } from '@/lib/teams/headgear';
import LiveRefresh from '@/components/scores/LiveRefresh';
import ExpandCard, { ExpandLine } from '@/components/scores/ExpandCard';
import { liveWinProbView } from '@/components/gridiron/LiveWinProb';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { orderFor } from '@/lib/gridiron/teamOrder';
import { possessionSide } from '@/lib/gridiron/possession';
import { shortOf, BASEBALL, sportOf } from '@/lib/live/vocabulary';
import { LEAGUE_LABEL, abbrOf, cardVariant, countLine, pickTone, statLineText, weekdayOf } from '@/lib/gridiron/scoresV2Shape';
import { SPORTS, sportChipShown, hrefs, applyView, chipCounts, oddsFoot, winProbRead, firstDownPct, leaderOf, fieldLine } from '@/lib/scores/v4';

const PICKEM = "Pick'em";

/** The clock pill's words - V2's liveLabel, the same reading. */
export function liveLabel(g) {
  const ls = g.liveState ?? {};
  if (sportOf(g.leagueSlug) === BASEBALL) return shortOf(ls, BASEBALL) ?? 'Live';
  if (g.leagueSlug === 'epl') {
    const p = ls.period ?? null; const el = ls.elapsed ?? null;
    return p === 'HT' ? 'HT' : el != null ? `${el}'${ls.extra ? `+${ls.extra}` : ''}` : 'Live';
  }
  const q = ls.period ?? null; const c = ls.clock ?? null;
  return q ? `${Number(q) >= 5 ? 'OT' : `Q${q}`}${c ? ` · ${c}` : ''}` : 'Live';
}

function Team({ g, side, x, variant, ball, headgear, dressed, lead }) {
  const t = side === 'home' ? g.home : g.away;
  const ab = abbrOf(t);
  const score = side === 'home' ? g.homeScore : g.awayScore;
  const scored = variant !== 'upcoming';
  const rank = x.rank?.[side] ?? null;
  const record = x.record?.[side] ?? null;
  const meta = [rank != null ? `#${rank}` : null, record].filter(Boolean).join(' · ');
  const pick = x.stake?.pick?.abbr != null && x.stake.pick.abbr === ab;
  const tone = !scored || lead == null ? '' : lead === side ? ' lead' : ' trail';
  return (
    <div className={`sv4-team${tone}`} data-side={side}>
      <TeamMark primary={dressed ? t.colors?.primary : null} secondary={dressed ? t.colors?.secondary : null} abbr={ab}
        size={variant === 'live' ? 36 : 30} title={t.name} headgearKey={t.abbreviation ?? null}
        leagueSlug={g.leagueSlug} headgear={headgear} />
      <div className="who">
        <div className="nm">
          <span className="n">{t.shortName ?? t.name}</span>
          {ball ? <span className="ball" role="img" aria-label={`${ab} ball`} /> : null}
          {pick ? <span className="pk">Your pick</span> : null}
        </div>
        <div className="meta"><span className="ab">{ab}</span>{meta ? ` · ${meta}` : ''}</div>
      </div>
      {scored ? <b className="sc">{score ?? 0}</b> : null}
    </div>
  );
}

function Diamond({ bases }) {
  if (!bases) return null;
  const sq = (on, cls) => <i className={`d-b ${cls}${on ? ' on' : ''}`} />;
  return (
    <span className="sv4-diamond" role="img"
      aria-label={[bases.first && '1st', bases.second && '2nd', bases.third && '3rd'].filter(Boolean).join(', ') || 'bases empty'}>
      {sq(bases.second, 'b2')}{sq(bases.third, 'b3')}{sq(bases.first, 'b1')}
    </span>
  );
}

function Stake({ stake, g, boardOpen, signedIn }) {
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
  return <div className="sv4-stake" data-stake="1">{chips}</div>;
}

/**
 * THE CARD'S FACE, UNWRAPPED (game-page-arcade, wed-8). /scores mounts it
 * inside ExpandCard (Card, below); the game page mounts the SAME component in
 * its own <article> - one face, not a copy. `onPage` is the game page's five
 * differences and nothing else: the quarter line score sits on the face once
 * the game has started, the stake chips stay on the board (the page has its
 * own In your games module), the last play rides the face when no field can
 * be drawn, the
 * final foot carries the closing line (x.closing) where the board has its
 * link, and the pre-game foot is the line alone (the page's In your games
 * module is where a pick is made). With `onPage` false the markup is the
 * board's, byte for byte.
 */
export function CardFace({ g, x, signedIn, signinHref, tz, now, onPage = false }) {
  const variant = cardVariant(g);
  const live = variant === 'live', final = variant === 'final';
  const baseball = sportOf(g.leagueSlug) === BASEBALL;
  const lead = leaderOf(g);
  const ball = possessionSide({
    leagueSlug: g.leagueSlug, status: g.status, possession: x.drive?.offenseAbbr ?? null,
    homeAbbr: abbrOf(g.home), awayAbbr: abbrOf(g.away), liveState: g.liveState,
  });
  const headgear = pairHasHeadgear(g.leagueSlug, g.away?.abbreviation ?? null, g.home?.abbreviation ?? null);
  const dressed = Boolean(g.away?.colors && g.home?.colors);
  const gameHref = gameHrefOf(g);
  const odds = oddsFoot(g, { spreadHome: x.spreadHome, total: x.total, openHome: x.openHome ?? null });
  const wp = live ? winProbRead(g, liveWinProbView(g.liveState, now)) : null;
  const boardOpen = !live && !final && (g.leagueSlug === 'nfl' || g.leagueSlug === 'cfb');
  const moment = final ? (baseball ? x.mlbFoot ?? null : statLineText(x.stat, g.leagueSlug)) : null;
  const field = fieldLine(x.drive);
  const tick = live && field.named ? firstDownPct(x.drive) : null;
  const where = `${LEAGUE_LABEL[g.leagueSlug] ?? ''}${g.network ? ` · ${g.network}` : ''}`;
  const bell = x.stake?.alerts ? (live ? 'Alerts on' : 'Alerts') : null;
  return (
    <>
      <div className="sv4-lbl">
        {live
          ? <span className="clock"><i className="dot" />{liveLabel(g)}</span>
          : final
            ? <span className="fin">Final · {g.etWeekday ?? weekdayOf(g.kickoffAt.slice(0, 10))}</span>
            : <span className="ko"><StandaloneTime iso={g.kickoffAt} serverTz={tz} />{g.network ? ` · ${g.network}` : ''}</span>}
        <span className="where">{live || final ? where : LEAGUE_LABEL[g.leagueSlug]}{bell ? <span className="bell"> · {bell}</span> : null}</span>
      </div>
      {orderFor(g.leagueSlug).map((side) => (
        <Team key={side} g={g} side={side} x={x} variant={variant} ball={ball === side}
          headgear={headgear} dressed={dressed} lead={lead} />
      ))}
      {onPage && x.line && variant !== 'upcoming' ? <ExpandLine line={x.line} /> : null}
      {/* THE STARTERS SIT UNDER THE TEAMS they pitch for (tue-4), not in the
          foot beside the line: "RHP Z. Wheeler vs LHP C. Sale" is who is
          playing, and the foot is the market. Pre-game baseball only. */}
      {baseball && !live && !final && x.probables ? <p className="sv4-prob" data-probables="1">{x.probables}</p> : null}
      {live && x.drive && (
        <div className="sv4-field" data-drive="1">
          {/* mon-21. THE SITUATION FIRST: down & distance · spot, the strip
              under it (ball + first-down tick), then the last play on ONE line.
              NO DOWN (a turnover, a score): the last snap's spot alone, the
              strip still drawn from it and no tick - nothing is claimed about
              a down that cannot be named. */}
          {field.line ? <div className="sit" data-sit={field.named ? 'down' : 'spot'}><span>{field.line}</span></div> : null}
          {field.pct != null && (
            <div className="track">
              <u style={{ width: `${field.pct}%` }} />
              {tick != null ? <em style={{ left: `${tick}%` }} aria-hidden="true" /> : null}
              <i style={{ left: `${field.pct}%` }} />
            </div>
          )}
          {x.drive.lastPlay ? <p className="lp" title={x.drive.lastPlay}>{x.drive.lastPlay}</p> : null}
        </div>
      )}
      {/* THE GAME PAGE'S LAST PLAY when the field cannot be drawn (thu-5): no
          down to name means no x.drive, but the page has no drive module any
          more, so its card still says what just happened. Page only. */}
      {onPage && live && !x.drive && x.lastPlay ? (
        <div className="sv4-field" data-drive="0"><p className="lp" title={x.lastPlay}>{x.lastPlay}</p></div>
      ) : null}
      {live && x.diamond && (
        <div className="sv4-bb" data-baseball="1">
          <span className="st">{x.diamond.lead}{x.diamond.sub ? <small>{x.diamond.sub}</small> : null}</span>
          <Diamond bases={x.diamond.bases} />
          <span className="cnt">{x.diamond.count ? <><small>count</small>{x.diamond.count}</> : null}</span>
          {x.diamond.lastPlay ? <p className="lp">{x.diamond.lastPlay}</p> : null}
        </div>
      )}
      {onPage ? null : <Stake stake={x.stake} g={g} boardOpen={boardOpen} signedIn={signedIn} />}
      {live ? (
        (odds || wp) ? (
          <div className="sv4-foot">
            <span>{odds}</span>
            {wp ? <b className={`wp${wp.stale ? ' stale' : ''}`} data-winprob="nfl">{wp.abbr} {wp.pct}% win</b> : null}
          </div>
        ) : null
      ) : final ? (
        <div className="sv4-foot">
          {/* NO MOMENT, NO WORD: the pill already says Final. */}
          <span className="moment">{moment ?? ''}</span>
          {/* ON THE GAME PAGE the link is the page itself, so the foot carries
              the closing line instead - metadata.market_prior, or nothing. */}
          {onPage
            ? (x.closing ? <span className="close" data-closing="1">{x.closing}</span> : null)
            : <Link className="go" href={gameHref}>{x.hasStats ? 'Box score' : 'Recap'} &rarr;</Link>}
        </div>
      ) : baseball ? (
        <div className="sv4-foot" data-pre="mlb">
          <span>{odds ?? 'No line yet'}</span>
          {x.preview ? <Link className="go" href={x.preview}>Preview &rarr;</Link> : null}
        </div>
      ) : (
        <div className="sv4-foot">
          <span>{odds ?? 'No line yet'}</span>
          {onPage ? null : !signedIn
            ? <Link className="go" href={signinHref}>Sign in to pick</Link>
            : x.stake?.pick && x.open
              ? <Link className="go" href={`/pickem/${g.leagueSlug}`}>Change pick &rarr;</Link>
              : !x.stake?.pick && x.preview
                ? <Link className="go" href={x.preview}>Preview &rarr;</Link>
                : null}
        </div>
      )}
    </>
  );
}

// EPL's page is its own match center (thu-24); /match/<epl slug> 308s there anyway.
const gameHrefOf = (g) => (g.leagueSlug === 'epl' ? `/epl/match/${g.slug}` : `/${g.leagueSlug}/game/${g.slug}`);

export function Card(props) {
  const { g } = props;
  const variant = cardVariant(g);
  const live = variant === 'live';
  const label = `${g.away?.shortName ?? g.away?.name} at ${g.home?.shortName ?? g.home?.name}`;
  return (
    // THE WHOLE CARD IS THE TAP TARGET (step 2): ExpandCard stretches a button
    // under the face, so the links on it (No pick yet, Recap, Sign in) still
    // work, and a tap anywhere else opens the drawer. EPL keeps no drawer - it
    // left the arcade chip row - and stays one link to its match page.
    <ExpandCard
      articleProps={{ className: `sv4-card ${variant}`, 'data-variant': variant, 'data-league': g.leagueSlug, 'data-slug': g.slug }}
      league={g.leagueSlug} slug={g.slug} live={live} label={label} gameHref={gameHrefOf(g)}
      line={props.x.line ?? null} expandable={g.leagueSlug !== 'epl'}>
      <CardFace {...props} />
    </ExpandCard>
  );
}

/** "No ranked games with a stake close right now." - the words for an empty board. */
export function emptyLine(v, view) {
  const where = view === 'close' ? 'close right now' : view === 'live' ? 'live right now' : view === 'tonight' ? 'still to start today' : 'on this day';
  return ['No', v.top25 ? 'ranked' : null, 'games', v.mine ? 'with a stake' : null, where].filter(Boolean).join(' ') + '.';
}

function Group({ grp, ...rest }) {
  return (
    <section className={`sv4-group${grp.key === 'yours' ? ' yours' : ''}`} data-group={grp.key}>
      <div className="sv4-gh"><h2>{grp.title}</h2><small>{grp.sub}</small></div>
      <div className="sv4-list">
        {grp.games.map((g) => <Card key={g.id} g={g} x={rest.v.extras.get(g.id)} {...rest} />)}
      </div>
    </section>
  );
}

export default function ScoreboardV4({ v, view = null, conf = null, signedIn = false, isShell = false, zoneLabel = 'Eastern', now = new Date() }) {
  const signinHref = shellSigninHref('/scores', isShell);
  const state = { date: v.date === v.today ? null : v.date, sport: v.sport, view, conf, mine: v.mine, top25: v.top25 };
  const h = hrefs(state);
  const ctx = { today: v.today, tz: v.tz, now };
  const counts = chipCounts(v.groups, ctx);
  const narrowed = applyView(v.groups, { view, conf, ...ctx });
  const yours = narrowed.groups.find((grp) => grp.key === 'yours') ?? null;
  const rest = narrowed.groups.filter((grp) => grp.key !== 'yours');
  const onDay = v.days.find((d) => d.on)?.counts ?? null;
  const slate = onDay ? onDay.live + onDay.final + onDay.scheduled : 0;
  const shown = (k) => counts[k] > 0 || view === k;
  const cardProps = { v, signedIn, signinHref, tz: v.tz, now };
  return (
    <div className="sv4" data-surface="ink">
      {v.liveCount > 0 && <LiveRefresh />}
      <div className="sv4-head">
        <h1>Scoreboard</h1>
        <div className="sv4-sub" data-live-count={v.liveCount}>
          {v.liveCount > 0 ? `${v.liveCount} live · ` : ''}{slate} on the slate
        </div>
      </div>
      <div className="sv4-eb">{weekdayOf(v.date, true)} · all times <ZoneLabel initial={zoneLabel} /></div>

      {yours && <Group grp={yours} {...cardProps} />}

      <div className="sv4-days" data-section="days">
        {v.days.map((d) => {
          const c = countLine(d.counts);
          return (
            <Link key={d.date} className={`sv4-day${d.on ? ' on' : ''}${c.live ? ' live' : ''}`} href={h.day(d.date === v.today ? null : d.date)} data-date={d.date}>
              <small>{d.dow}</small><b>{d.day}</b><i>{c.text}</i>
            </Link>
          );
        })}
      </div>

      <div className="sv4-chips" data-section="chips">
        {SPORTS.filter(([k]) => sportChipShown(k, { leagues: v.leagues, selected: v.sport })).map(([k, label]) => (
          <Link key={k} className={`sv4-chip${v.sport === k ? ' on' : ''}`} href={h.sport(k)} data-chip={`sport:${k}`}>{label}</Link>
        ))}
        <span className="sep" aria-hidden="true" />
        {shown('live') && <Link className={`sv4-chip live${view === 'live' ? ' on' : ''}`} href={h.view('live')} data-chip="live"><i className="dot" />Live {counts.live}</Link>}
        {signedIn && <Link className={`sv4-chip${v.mine ? ' on' : ''}`} href={h.mine()} data-chip="mine" data-mine-count={v.mineCount}>Yours {v.mineCount}</Link>}
        {v.rankedToday && <Link className={`sv4-chip${v.top25 ? ' on' : ''}`} href={h.top25()} data-chip="top25">Top 25</Link>}
        {shown('close') && <Link className={`sv4-chip${view === 'close' ? ' on' : ''}`} href={h.view('close')} data-chip="close">Close {counts.close}</Link>}
        {shown('tonight') && <Link className={`sv4-chip${view === 'tonight' ? ' on' : ''}`} href={h.view('tonight')} data-chip="tonight">Tonight {counts.tonight}</Link>}
      </div>

      {v.sport === 'cfb' && narrowed.confs.length > 0 && (
        <div className="sv4-chips sv4-conf" data-section="conf">
          {narrowed.confs.map((c) => (
            <Link key={c} className={`sv4-chip${narrowed.conf === c ? ' on' : ''}`} href={h.conf(c)} data-chip={`conf:${c}`}>{c}</Link>
          ))}
        </div>
      )}

      {v.liveAway && (
        <Link className="sv4-liveaway" href="/scores" data-liveaway={v.liveAway.count}>
          <i className="dot" />{v.liveAway.count} live now <span>Back to today &rarr;</span>
        </Link>
      )}
      {rest.length === 0 && !yours && <p className="sv4-empty">{emptyLine(v, view)}</p>}
      {rest.map((grp) => <Group key={grp.key} grp={grp} {...cardProps} />)}
    </div>
  );
}
