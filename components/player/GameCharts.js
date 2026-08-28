// components/player/GameCharts.js — the game chart, transcribed from
// docs/design/sportsvyn-market-mock-v0_5-props-board.html.
//
// THE CHART GRAMMAR IS THE MOCK'S: one bar per game, NEWEST FIRST, the value
// above the bar and the opponent below it. Heights scale to the player's own
// best game in the window, so the shape reads as "how has he been going"
// rather than as a comparison against some absolute nobody asked about.
//
// NO THRESHOLD LINE HERE, BY RULING, AND IT IS THE ONE DELIBERATE DEPARTURE
// FROM THE MOCK. The dashed volt line is the props board's device: it exists to
// put a PRICE beside production, and the board is where that comparison
// belongs. A player page charts pure production - there is no line to draw
// because there is no market being discussed, and drawing one would import a
// betting frame into a page that is just a record of what a player did. The
// mock's .over brightness step goes with it: over/under is a property of a
// line, and with no line there is nothing to be over.
//
// A ZERO IS A FLOOR SLIVER, NEVER A GAP. A game in which a player recorded
// nothing is a fact about that game, and a bar of no height would read as a
// game that did not happen. Absent is different again: a NULL stat renders no
// bar at all and the game keeps its slot in the table below.
//
// THE BAR MATH LIVES IN lib/gridiron/gameChart.js. JSX cannot be imported by
// node --test, so logic left in this file would be untestable by construction.

import { barsFor } from '@/lib/gridiron/gameChart';

export default function GameCharts({ games, charts, seasonLabel, levelNote }) {
  const built = (charts ?? [])
    .map((col) => ({ col, bars: barsFor(games, col) }))
    .filter((c) => c.bars);
  if (!built.length) return null;

  return (
    <section className="gp-mod" id="gamecharts">
      <div className="gp-modeb">
        <span>Game chart</span>
        <span className="gp-ctx">{seasonLabel}</span>
      </div>
      {/* THE LEVEL NOTE IS THE ROOKIE RULE. A player whose latest logs are from
          a different level charts that level, and says so with the team and
          season - unlabeled cross-code data would show a rookie's college
          production as though it were his professional record. */}
      {levelNote ? <p className="gp-chart-level">{levelNote}</p> : null}
      {built.map(({ col, bars }) => (
        <div className="gp-chartwrap" key={col.key}>
          <div className="gp-chart-lab">{col.label}</div>
          <div className="gp-chart">
            {bars.map((b) => (
              <div className="gp-bar" key={b.key} style={{ height: `${b.height}px` }}>
                <span className="v">{b.value}</span>
                <span className="op">{b.opponent}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
