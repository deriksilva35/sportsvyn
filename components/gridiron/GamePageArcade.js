// components/gridiron/GamePageArcade.js - the gridiron game page under the
// ARCADE theme (game-page-arcade, Derik's ruling wed-8; design: the "NFL game
// page under arcade" artifact, boards Live and Final).
//
// A PURE FUNCTION OF ONE OBJECT: lib/gridiron/gamePageArcadeView.js reads,
// this draws. The modules and their order are the view's `modules` list
// (lib/gridiron/gamePageArcade.js arcadeModules), so the order per state lives
// in one tested place and this file only knows how to draw each one.
//
// THE CARD IS THE BOARD'S CARD: CardFace from components/scores/ScoreboardV4.js,
// the same component /scores mounts inside its drawer - here inside a plain
// <article>, navy in every state, with no drawer and no Recap link.
//
// NO PROSE. No brief, no recap headline, no article link, no win-probability
// gloss, no explanatory note: the page is numbers, plays and names.

import Link from 'next/link';
import { CardFace } from '@/components/scores/ScoreboardV4';
import AlertBell from '@/components/alerts/AlertBell';
import OddsStrip from '@/components/gridiron/OddsStrip';
import PropsPanel from '@/components/gridiron/PropsPanel';
import ArcadeChips from '@/components/gridiron/ArcadeChips';
import { cardVariant } from '@/lib/gridiron/scoresV2Shape';
import { whenLabel } from '@/lib/gridiron/gamePageArcade';

function Card({ view, now, tz, alerts = null }) {
  const { g, x } = view;
  const variant = cardVariant(g);
  return (
    <article className={`sv4-card ${variant} gpa-card`} data-variant={variant} data-league={g.leagueSlug} data-slug={g.slug} data-gpa="card">
      <CardFace g={g} x={x} signedIn={view.yours.signedIn} signinHref={view.signinHref} tz={tz} now={now} onPage
        topRight={alerts ? <AlertBell compact={false} signedIn={alerts.signedIn} match={alerts.match} liveActivity={alerts.liveActivity} /> : null} />
    </article>
  );
}

function Box({ label, children, tag = null, right = null, mod, className = '' }) {
  return (
    <section className={`gpa-box ${className}`.trim()} data-gpa={mod} aria-label={label}>
      <div className="gpa-bh">
        <span className="gpa-kick">{label}{tag}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

export function WinProb({ wp }) {
  if (!wp) return null;
  return (
    <Box label="Win probability" mod="winprob" tag={<span className="gpa-cal">Calibrating</span>}
      right={wp.now ? <b className={`gpa-wpnow${wp.stale ? ' stale' : ''}`} data-wpnow="1">{wp.now}</b> : null}>
      {wp.path ? (
        <svg className="gpa-curve" viewBox="0 0 358 64" width="100%" height="64" role="img"
          aria-label={`Win probability over the game, ${wp.homeAbbr} at the top`}>
          <line className="mid" x1="0" y1="32" x2="358" y2="32" />
          {wp.marks.map((m) => <line key={m} className="q" x1={m} y1="0" x2={m} y2="64" />)}
          <polyline className="ln" points={wp.path} />
          {wp.dot ? <circle className="dot" cx={wp.dot.split(',')[0]} cy={wp.dot.split(',')[1]} r="4.5" /> : null}
        </svg>
      ) : null}
      {wp.path ? (
        <div className="gpa-axis" aria-hidden="true">
          <span>Q1</span><span>Q2</span><span>Q3</span><span>Q4</span>{wp.ot ? <span>OT</span> : null}
          <span className="sides"><b>{wp.homeAbbr}</b> top · {wp.awayAbbr} bottom</span>
        </div>
      ) : null}
    </Box>
  );
}

/**
 * "PLAY THIS GAME" OFFERS ONLY WHAT IS STILL OPEN for this match (thu-5):
 * Pick'em until its kickoff, the Weekly and the Draft until their locks
 * (lib/gridiron/inYourGames.js openGames). Nothing open, no card - signed in
 * or out.
 */
function PlayCard({ href, signedIn, open }) {
  if (!open?.length || !href) return null;
  const names = open.map((o) => o.label).join(' · ');
  return (
    <Link className="gpa-play" href={href} data-gpa="play" data-play-card="1" data-offers={open.map((o) => o.kind).join(' ')}>
      <span className="t">Play this game</span>
      <span className="s">{signedIn ? names : `Sign in to play · ${names}`}</span>
      <span className="go" aria-hidden="true">&rsaquo;</span>
    </Link>
  );
}

/** Signed out: the Play card, if anything is open. Signed in: the reader's rows, then the Play card if anything is still open. */
export function InYourGames({ yours }) {
  const { rows, signedIn, playHref, open = [] } = yours;
  return (
    <div data-gpa="yours">
      {rows.length ? (
        <section className="gpa-yours" aria-label="In your games">
          <span className="gpa-pill">In your games</span>
          {rows.map((r) => (
            <Link key={r.kind} className="gpa-yrow" href={r.href} data-kind={r.kind}>
              <span className="l"><b>{r.label}</b><span>{r.line}</span></span>
              <span className="v">{r.value}</span>
            </Link>
          ))}
        </section>
      ) : null}
      <PlayCard href={playHref} signedIn={signedIn} open={open} />
    </div>
  );
}

export function PlaysList({ plays, allHref }) {
  return (
    <div className="gpa-plays" id="gpa-plays" data-gpa="plays">
      <ol>
        {plays.latest.map((p, i) => (
          <li key={i}>
            <span className="w">{p.when}</span>
            <span className="b">{p.abbr ? <b>{p.abbr}</b> : null}<span>{p.text}</span></span>
            {/* THE RUNNING SCORE (nba-card): basketball's rows carry the score
                after a scoring play; football's carry none and draw nothing. */}
            {p.score ? <span className="s" data-score="1">{p.score}</span> : null}
          </li>
        ))}
      </ol>
      {!plays.all && plays.total > plays.latest.length
        ? <Link className="gpa-all" href={allHref} data-all-plays={plays.total}>All plays · {plays.total} &rsaquo;</Link>
        : null}
    </div>
  );
}

/** ONE LINE EACH (thu-5): "Q1 8:47 · CHI · C.Keenum 8-yd TD pass to L.Burden · PHI 0 - CHI 7". */
export function ScoringPlays({ list, g }) {
  const ab = (side) => (side === 'home' ? g.home : g.away)?.abbreviation ?? '';
  return (
    <Box label="Scoring plays" mod="scoring" right={<span className="gpa-sub">{list.length}</span>}>
      <ol className="gpa-scoring">
        {list.map((s, i) => (
          <li key={i} data-side={s.side} title={s.text ?? undefined}>
            <span className="w">{whenLabel(s.period, s.clock)}</span>
            <b className="t">{ab(s.side)}</b>
            <span className="tx">{s.summary}</span>
            <span className="sc">{ab('away')} {s.awayScore} - {ab('home')} {s.homeScore}</span>
          </li>
        ))}
      </ol>
    </Box>
  );
}

export function Leaders({ rows, g }) {
  const cell = (l) => (l ? <span className="pl"><b>{l.name}</b><span>{l.line}</span></span> : <span className="pl none">–</span>);
  return (
    <Box label="Leaders" mod="leaders" className="gpa-leaders">
      <div className="gpa-lrow head"><span /><span>{g.away?.abbreviation}</span><span className="r">{g.home?.abbreviation}</span></div>
      {rows.map((r) => (
        <div key={r.cat} className="gpa-lrow" data-cat={r.cat}>
          <span className="cat">{r.cat}</span>{cell(r.away)}<span className="r">{cell(r.home)}</span>
        </div>
      ))}
    </Box>
  );
}

function BoxTables({ teams }) {
  return (
    <div className="gpa-boxsc" data-gpa="box" id="gpa-box">
      {teams.map((t) => (
        <div key={t.side} className="team">
          {t.tables.filter((tb) => tb.primary !== false).map((tb) => (
            <table key={tb.group} className="gpa-tbl">
              <thead><tr><th scope="col">{t.abbr} {tb.label}</th>{tb.headings.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {tb.rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`}><th scope="row">{r.name}</th>{r.cells.map((c, j) => <td key={j}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ))}
    </div>
  );
}

function TeamStats({ box, g }) {
  const sides = [g.away, g.home].filter((t) => box[t?.id]);
  const keys = [...new Set(sides.flatMap((t) => Object.keys(box[t.id] ?? {})))];
  const v = (x) => (x == null ? '–' : typeof x === 'object' ? Object.values(x).filter((y) => y != null).join('-') : String(x));
  return (
    <table className="gpa-tbl" data-gpa="teamstats">
      <thead><tr><th scope="col" />{sides.map((t) => <th key={t.id} scope="col">{t.abbreviation}</th>)}</tr></thead>
      <tbody>{keys.map((k) => <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th>{sides.map((t) => <td key={t.id}>{v(box[t.id]?.[k])}</td>)}</tr>)}</tbody>
    </table>
  );
}

export default function GamePageArcade({ view, now = new Date(), tz = 'America/New_York', alerts = null }) {
  const { g } = view;
  const allHref = `/${g.leagueSlug}/game/${g.slug}?plays=all#gpa-plays`;
  const draw = {
    card: () => <Card view={view} now={now} tz={tz} alerts={alerts} />,
    market: () => (view.odds ? <div className="gpa-market" data-gpa="market"><OddsStrip odds={view.odds} leagueSlug={g.leagueSlug} matchId={g.id} /></div> : null),
    winprob: () => <WinProb wp={view.winprob} />,
    yours: () => <InYourGames yours={view.yours} />,
    chips: () => (
      <ArcadeChips panels={view.chips} nodes={{
        plays: <PlaysList plays={view.plays} allHref={allHref} />,
        box: view.box.length ? <BoxTables teams={view.box} /> : null,
        stats: (
          <div data-gpa="stats">
            {view.leaders.length ? <Leaders rows={view.leaders} g={g} /> : null}
            {view.teamBox ? <TeamStats box={view.teamBox} g={g} /> : null}
          </div>
        ),
        market: (
          <div data-gpa="livemarket">
            {view.market.closing ? <p className="gpa-closing" data-closing="1">{view.market.closing}</p> : null}
            {view.market.propsCard ? <PropsPanel card={view.market.propsCard} leagueSlug={g.leagueSlug} matchId={g.id} /> : null}
          </div>
        ),
      }} />
    ),
    scoring: () => <ScoringPlays list={view.scoring} g={g} />,
    leaders: () => <Leaders rows={view.leaders} g={g} />,
    // THE NBA FINAL'S THREE (nba-card, thu-37). Never in a gridiron module list
    // (lib/gridiron/gamePageArcade.js arcadeModules), so the NFL page is unchanged.
    teamstats: () => (view.teamBox ? <Box label="Team stats" mod="teamstats-box"><TeamStats box={view.teamBox} g={g} /></Box> : null),
    fullbox: () => (view.boxHref ? <Link className="gpa-all gpa-fullbox" href={view.boxHref} data-gpa="fullbox">Full box score &rsaquo;</Link> : null),
    box: () => (view.box.length ? <Box label="Box score" mod="box-full"><BoxTables teams={view.box} /></Box> : null),
  };
  return (
    <div className="gpa" data-state={view.state} data-league={view.league} data-modules={view.modules.join(' ')}>
      <div className="gpa-crumb">
        <Link href="/scores">&lsaquo; Scores</Link>
        <span aria-hidden="true">·</span>
        <span>{view.crumb}</span>
        {view.simulated ? <span className="gpa-simtag">replay</span> : null}
      </div>
      {view.modules.map((m) => <div key={m} className="gpa-mod" data-mod={m}>{draw[m]()}</div>)}
    </div>
  );
}
