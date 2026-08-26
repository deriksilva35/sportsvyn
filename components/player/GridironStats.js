// components/player/GridironStats.js - season totals and the game log.
//
// ONE TABLE GRAMMAR, DIFFERENT COLUMNS. A quarterback and a safety get the same
// header/row/career carpentry; only the column vocabulary changes, and it comes
// from lib/gridiron/playerStats.js where it is checked against columns that
// actually exist. The fork is data, not layout.
//
// The career row is computed by careerFrom() - the same pure function the tests
// check against hand-run SQL - rather than by a second aggregate query, so the
// row on the page cannot disagree with the rows above it.

import { formatStat, careerFrom, columnSetName } from '@/lib/gridiron/playerStats';

const SET_LABEL = { passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving',
  kicking: 'Kicking', defense: 'Defense' };

// The grid is sized from the column count so a five-column passing table and a
// four-column defensive one both line up rather than one of them wrapping.
const gridStyle = (n) => ({ gridTemplateColumns: `64px 1fr repeat(${n}, minmax(56px, 66px))` });

function Head({ columns, first, second }) {
  return (
    <div className="gp-shead" style={gridStyle(columns.length)}>
      <span>{first}</span><span>{second}</span>
      {columns.map((c) => <span key={c.key}>{c.label}</span>)}
    </div>
  );
}

export function SeasonTotals({ seasons, columns }) {
  if (!seasons?.length) return null;
  const career = careerFrom(seasons, columns);
  const years = seasons.map((s) => s.season).filter((y) => y != null);
  const span = years.length ? `${Math.min(...years)}-${Math.max(...years)}` : '';
  const name = SET_LABEL[columnSetName(columns)] ?? '';

  return (
    <section className="gp-mod" id="totals">
      <div className="gp-modeb">
        <span>Season totals</span>
        <span className="gp-ctx">{[name, span].filter(Boolean).join(' · ')}</span>
      </div>
      <Head columns={columns} first="Season" second="" />
      {seasons.map((s) => (
        <div className="gp-srow" key={s.season} style={gridStyle(columns.length)}>
          <span className="gp-yr">{s.season}</span>
          <span className="gp-lab" />
          {columns.map((c) => (
            <span className="gp-n" key={c.key}>{formatStat(c, s[c.key])}</span>
          ))}
        </div>
      ))}
      <div className="gp-srow career" style={gridStyle(columns.length)}>
        <span className="gp-yr" />
        <span className="gp-lab">Career<span className="gp-sub">{span}</span></span>
        {columns.map((c) => (
          <span className="gp-n" key={c.key}>{formatStat(c, career[c.key])}</span>
        ))}
      </div>
    </section>
  );
}

export function GameLog({ games, columns, seasonLabel }) {
  if (!games?.length) return null;
  return (
    <section className="gp-mod" id="gamelog">
      <div className="gp-modeb">
        <span>Game log</span>
        <span className="gp-ctx">{seasonLabel}</span>
      </div>
      <Head columns={columns} first="Wk" second="Game" />
      {games.map((g, i) => (
        <div className="gp-srow" key={`${g.season}-${g.week}-${i}`} style={gridStyle(columns.length)}>
          <span className="gp-yr">{g.week ?? '—'}</span>
          <span className="gp-lab">
            {g.opponent}
            {g.result && <span className="gp-sub">{g.result}</span>}
          </span>
          {columns.map((c) => (
            <span className="gp-n" key={c.key}>{formatStat(c, g[c.key])}</span>
          ))}
        </div>
      ))}
    </section>
  );
}

/** The single serif line that stands in for a table, never a scaffolded one. */
export function EmptyLog({ line }) {
  return (
    <section className="gp-mod" id="gamelog">
      <div className="gp-modeb"><span>Game log</span></div>
      <p className="gp-emptyline">{line}</p>
    </section>
  );
}
