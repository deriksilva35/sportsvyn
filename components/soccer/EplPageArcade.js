// components/soccer/EplPageArcade.js - the EPL match page under the ARCADE
// theme (thu-24). A pure function of lib/soccer/eplPageArcade.js's view, drawn
// in the gridiron game page's grammar (components/gridiron/GamePageArcade.js):
// the board's own CardFace inside a plain <article>, then boxed modules in the
// view's order. No prose: minutes, names and numbers.

import Link from 'next/link';
import { CardFace } from '@/components/scores/ScoreboardV4';
import { cardVariant } from '@/lib/gridiron/scoresV2Shape';
import { standingsHref } from '@/lib/soccer/leagues';

function Box({ label, mod, right = null, children, className = '' }) {
  return (
    <section className={`gpa-box ${className}`.trim()} data-gpa={mod} aria-label={label}>
      <div className="gpa-bh"><span className="gpa-kick">{label}</span>{right}</div>
      {children}
    </section>
  );
}

export function Moments({ list }) {
  return (
    <Box label="Goals and cards" mod="moments" right={<span className="gpa-sub">{list.filter((m) => m.kind === 'goal').length}</span>}>
      <ol className="gpa-scoring epl-moments">
        {list.map((m, i) => (
          <li key={i} data-side={m.side} data-kind={m.kind}>
            <span className="w">{m.when}</span>
            <b className="t">{m.abbr}</b>
            <span className="tx">{m.kind === 'red' ? <i className="epl-rc" aria-hidden="true" /> : null}{m.text}</span>
            <span className="sc">{m.score ?? ''}</span>
          </li>
        ))}
      </ol>
    </Box>
  );
}

export function TeamStats({ rows, g }) {
  return (
    <Box label="Team stats" mod="stats">
      <table className="gpa-tbl epl-stats">
        <thead><tr><th scope="col">{g.home?.abbreviation}</th><th scope="col" /><th scope="col">{g.away?.abbreviation}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.home}</td>
              <th scope="row">{r.label}</th>
              <td>{r.away}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

export function TopPlayers({ players, g }) {
  const cell = (p) => (p ? <span className="pl"><b>{p.name}</b><span>{p.line}</span></span> : <span className="pl none">–</span>);
  const n = Math.max(players.home.length, players.away.length);
  return (
    <Box label="Top players" mod="players" className="gpa-leaders">
      <div className="gpa-lrow head"><span /><span>{g.home?.abbreviation}</span><span className="r">{g.away?.abbreviation}</span></div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="gpa-lrow" data-rank={i + 1}>
          <span className="cat">{i + 1}</span>{cell(players.home[i])}<span className="r">{cell(players.away[i])}</span>
        </div>
      ))}
    </Box>
  );
}

export default function EplPageArcade({ view, now = new Date(), tz = null }) {
  const { g, x } = view;
  const variant = cardVariant(g);
  const draw = {
    card: () => (
      <article className={`sv4-card ${variant} gpa-card`} data-variant={variant} data-league={g.leagueSlug} data-slug={g.slug} data-gpa="card">
        <CardFace g={g} x={x} signedIn={false} signinHref="/signin" tz={tz} now={now} onPage />
      </article>
    ),
    moments: () => <Moments list={view.moments} />,
    stats: () => <TeamStats rows={view.compare} g={g} />,
    players: () => <TopPlayers players={view.players} g={g} />,
  };
  return (
    <div className="gpa" data-state={view.state} data-league={g.leagueSlug} data-modules={view.modules.join(' ')}>
      <div className="gpa-crumb">
        <Link href={`/scores?sport=${g.leagueSlug}`}>&lsaquo; Scores</Link>
        <span aria-hidden="true">·</span>
        <span>{view.crumb}</span>
        <span aria-hidden="true">·</span>
        <Link href={standingsHref(g.leagueSlug)}>Table</Link>
      </div>
      {view.modules.map((m) => <div key={m} className="gpa-mod" data-mod={m}>{draw[m]()}</div>)}
    </div>
  );
}
