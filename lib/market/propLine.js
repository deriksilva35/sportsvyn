// lib/market/propLine.js - which stat a prop market reads, and the line it is
// measured against. PURE (no database): split out of propStats.js so the
// client-rendered /market board can use lineFor without the driver.

/**
 * Market key -> how to read it out of a game row.
 *
 * `sum` markets add several columns because the market is about an event the
 * database records in pieces: an anytime touchdown is a rushing TD OR a
 * receiving TD, and asking only one would under-count every receiver.
 *
 * `line` is the implicit threshold for yes/no markets - "did he score" is
 * "more than half a touchdown", which is how the book prices it too.
 */
export const MARKET_STATS = Object.freeze({
  player_pass_yds: { league: 'gridiron', cols: ['pass_yds'], noun: 'pass yds' },
  player_pass_tds: { league: 'gridiron', cols: ['pass_td'], noun: 'pass TDs' },
  player_rush_yds: { league: 'gridiron', cols: ['rush_yds'], noun: 'rush yds' },
  player_receptions: { league: 'gridiron', cols: ['rec'], noun: 'recs' },
  player_reception_yds: { league: 'gridiron', cols: ['rec_yds'], noun: 'rec yds' },
  player_anytime_td: { league: 'gridiron', cols: ['rush_td', 'rec_td'], line: 0.5, noun: 'TDs', yesNo: true, event: 'a TD' },
  player_1st_td: { league: 'gridiron', cols: ['rush_td', 'rec_td'], line: 0.5, noun: 'TDs', yesNo: true, event: 'a TD' },
  player_goal_scorer_anytime: { league: 'epl', cols: ['goals'], line: 0.5, noun: 'goals', yesNo: true, event: 'scored' },
  player_first_goal_scorer: { league: 'epl', cols: ['goals'], line: 0.5, noun: 'goals', yesNo: true, event: 'scored' },
  player_last_goal_scorer: { league: 'epl', cols: ['goals'], line: 0.5, noun: 'goals', yesNo: true, event: 'scored' },
  player_shots: { league: 'epl', cols: ['shots'], noun: 'shots' },
  player_shots_on_target: { league: 'epl', cols: ['shots_on_target'], noun: 'shots on target' },
  player_assists: { league: 'epl', cols: ['assists'], noun: 'assists' },
});

/** The threshold a row is measured against: the priced line, or the market's. */
export function lineFor(marketType, selectionValue) {
  const spec = MARKET_STATS[marketType];
  if (!spec) return null;
  // Number(null) IS 0, AND 0 IS FINITE. Anytime markets carry a NULL
  // selection_value - there is no line to price against, the market IS the
  // line - so a bare Number() check returned 0 and every anytime row read
  // "cleared 0 TDs" instead of 0.5. The same scar as the career-totals column
  // and the props implied_probability, met a third time; null is checked
  // before it can become a number.
  if (selectionValue != null && selectionValue !== '') {
    const n = Number(selectionValue);
    if (Number.isFinite(n)) return n;
  }
  return spec.line ?? null;
}
