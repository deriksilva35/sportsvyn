// components/scores/ScoresV2.js - the Scores tab v2 (docs/design/mocks/scores-tab-v0_2.html).
// A server component: it draws what lib/gridiron/scoresV2.js read. Day strip
// and pills are links (the page re-renders for the picked day and league);
// LiveRefresh mounts only when a card is live. Signed out: no Mine, no stake
// rows, "Sign in to pick" instead of "Pick".

import Link from 'next/link';
import StandaloneTime from '@/components/StandaloneTime';
import TeamMark from '@/components/team/TeamMark';
import LiveRefresh from '@/components/scores/LiveRefresh';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { LEAGUE_LABEL, abbrOf, cardVariant, countLine, pickTone, statLineText, oddsLine, eplBar, weekdayOf } from '@/lib/gridiron/scoresV2Shape';

// THE SITE'S STRAIGHT APOSTROPHE, everywhere on this tab (GO rider 1).
const PICKEM = "Pick'em";

const href = ({ date, sport = 'all', mine = false }) => {
  const p = new URLSearchParams();
  if (date) p.set('date', date);
  if (sport !== 'all') p.set('sport', sport);
  if (mine) p.set('mine', '1');
  const q = p.toString();
  return q ? `/scores?${q}` : '/scores';
};

function liveLabel(g) {
  const ls = g.liveState ?? {};
  if (g.leagueSlug === 'epl') {
    const p = ls.period ?? null; const el = ls.elapsed ?? null;
    return p === 'HT' ? 'HT' : el != null ? `${el}'${ls.extra ? `+${ls.extra}` : ''}` : 'Live';
  }
  const q = ls.period ?? null; const c = ls.clock ?? null;
  return q ? `Q${q}${c ? ` · ${c}` : ''}` : 'Live';
}

function TeamRow({ t, score, trail, record, pick, pct, scored }) {
  const ab = abbrOf(t);
  return (
    <div className={`sv2-team${trail ? ' trail' : ''}`}>
      <TeamMark primary={t.colors?.primary} secondary={t.colors?.secondary} abbr={ab} size={24} title={t.name} />
      <span className="ab">{ab}</span>
      <span className="nm">{t.shortName ?? t.name}{record ? <span className="rec">{record}</span> : null}</span>
      {pick ? <span className="pk">Your pick</span> : null}
      {scored ? <b className="n">{score ?? 0}</b> : pct != null ? <b className="n pct">{pct}%</b> : null}
    </div>
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
      <TeamRow t={g.away} score={g.awayScore} trail={scored ? homeLeads : false} record={x.record.away} pick={pickAbbr != null && pickAbbr === g.away.abbreviation} pct={pctFor('away')} scored={scored} />
      <TeamRow t={g.home} score={g.homeScore} trail={scored ? awayLeads : false} record={x.record.home} pick={pickAbbr != null && pickAbbr === g.home.abbreviation} pct={pctFor('home')} scored={scored} />
      {live && x.drive && (
        <div className="sv2-strip" data-drive="1">
          <span className="dd">{x.drive.label}{x.drive.spot ? <small>{x.drive.spot}</small> : null}</span>
          <span className="ball">{x.drive.offenseAbbr ? `${x.drive.offenseAbbr} ball` : ''}</span>
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
              and nowhere else, so a final never says it twice. */}
          <span>{stat ? <b>{stat}</b> : 'Final'}</span>
          {x.hasStats ? <span className="go">Box score &rarr;</span> : null}
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
  const pills = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['epl', 'EPL']];
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
            <Link key={d.date} className={`sv2-day${d.on ? ' on' : ''}${c.live ? ' live' : ''}`} href={href({ date: d.date, sport: v.sport, mine: v.mine })} data-date={d.date}>
              <small>{d.dow}</small><b>{d.day}</b><i>{c.text}</i>
            </Link>
          );
        })}
      </div>
      <div className="sv2-filt" data-section="pills">
        {pills.map(([k, label]) => (
          <Link key={k} className={`sv2-pill${v.sport === k ? ' on' : ''}`} href={href({ date: v.date, sport: k, mine: v.mine })}>{label}</Link>
        ))}
        <span className="sp" />
        {signedIn && <Link className={`sv2-pill mine${v.mine ? ' on' : ''}`} href={href({ date: v.date, sport: v.sport, mine: !v.mine })} data-mine-count={v.mineCount}>Mine · {v.mineCount}</Link>}
      </div>
      {/* A NON-TODAY DAY COLLAPSES THE LIVE GAMES TO ONE LINE (DAY PICK
          LEADS relay item 2). The day the reader picked leads the page. */}
      {v.liveAway && (
        <Link className="sv2-liveaway" href="/scores" data-liveaway={v.liveAway.count}>
          {v.liveAway.count} live now <span>Back to today &rarr;</span>
        </Link>
      )}
      {v.groups.length === 0 && <p className="sv2-empty">No games {v.mine ? 'with a stake ' : ''}on this day.</p>}
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
