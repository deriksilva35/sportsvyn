// lib/market/propStats.js — THE STATS context line behind a priced prop.
//
// "2025: cleared 1.5 pass TDs in 11 of 17 · 2.1/game" — our own game logs
// answering the question the price implies, in the observation voice. It says
// what happened. It never says what to do about it.
//
// THREE QUERIES PER PAGE, NEVER PER ROW. A board page can hold fifty rows and
// the naive shape is fifty round trips. Instead the page's linked player_ids
// are collected once and each stat table is asked once:
//
//     nfl_player_game_stats   via the nfl_players bdl bridge
//     cfb_player_game_stats   player_id direct
//     player_match_stats      player_id direct   (EPL)
//
// The LINE varies per row, so the "cleared" count cannot be a SQL FILTER
// against a constant - the logs come back once and each row's threshold is
// applied in JS over the rows it needs. Three queries, fifty answers.
//
// EVERY MARKET MAPS TO A COLUMN WE ACTUALLY HOLD, or it gets no context line.
// A market with no honest stat behind it renders context-free rather than
// borrowing a neighbouring column that means something else.

import { sql } from '../db.js';

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

/**
 * One game's value for a market — the sum of its columns.
 *
 * ABSENT STAYS ABSENT. If EVERY column is null the game was not measured and
 * returns null, which drops it from the denominator; a player who was not
 * recorded did not fail to clear anything. But a game where one column is
 * null and another is 3 is a real 3 - a receiver with no rushing row rushed
 * for nothing, not for unknown.
 */
export function valueOf(row, cols) {
  let seen = false;
  let total = 0;
  for (const c of cols) {
    const v = row?.[c];
    if (v == null) continue;
    seen = true;
    total += Number(v);
  }
  return seen ? total : null;
}

/**
 * The hit rate for one row against one player's logs.
 *
 * @returns { season, games, cleared, perGame } or null when there is nothing
 *          honest to say - no logs, no mapped market, or no line.
 */
export function hitRate(logs, marketType, selectionValue) {
  const spec = MARKET_STATS[marketType];
  if (!spec || !logs?.length) return null;
  const line = lineFor(marketType, selectionValue);
  if (line == null) return null;

  // THE MOST RECENT SEASON WITH ROWS, not a career blend. "Cleared it in 11 of
  // 17" means a season; averaging four of them would answer a question nobody
  // asked and would flatter a player whose last year was his worst.
  const season = logs[0]?.season ?? null;
  const inSeason = logs.filter((r) => r.season === season);
  const values = inSeason.map((r) => valueOf(r, spec.cols)).filter((v) => v != null);
  if (!values.length) return null;

  const cleared = values.filter((v) => v > line).length;
  const total = values.reduce((a, v) => a + v, 0);
  return {
    season,
    games: values.length,
    cleared,
    perGame: total / values.length,
    line,
    noun: spec.noun,
    yesNo: spec.yesNo === true,
    event: spec.event ?? null,
  };
}

/**
 * THE SENTENCE. Observation voice, and the words that would make it advice -
 * play, take, bet, lean - appear nowhere in this file by construction.
 *
 * "2025: cleared 1.5 pass TDs in 11 of 17 · 2.1/game"
 */
export function contextLine(hr) {
  if (!hr) return null;
  // EPL MATCHES CARRY NO season_year - it is null on all 370 of them, because
  // a soccer season is "2026-27" and does not fit an integer year. Printing it
  // raw produced "null: cleared 0.5 shots on target in 1 of 1", which is the
  // Number(null) family in its string form: a missing value rendered as the
  // word for missing. With no season to name, the sentence simply does not
  // name one.
  const lead = hr.season == null ? '' : `${hr.season}: `;
  // TWO SENTENCES, BECAUSE THERE ARE TWO QUESTIONS. An over/under market asks
  // "how often has he beaten this number" and the per-game average is the
  // context for it. A yes/no market - anytime TD, anytime scorer - asks only
  // "how often does this happen at all", and reporting "cleared 0.5 TDs ·
  // 0.3/game" answers it in a dialect nobody speaks. The mock writes these
  // differently and it is right to.
  if (hr.yesNo) {
    return `${lead}${hr.event} in ${hr.cleared} of ${hr.games} games`;
  }
  return `${lead}cleared ${hr.line} ${hr.noun} in ${hr.cleared} of ${hr.games} · ${hr.perGame.toFixed(1)}/game`;
}

const GRIDIRON_COLS = ['pass_yds', 'pass_td', 'rush_td', 'rush_yds', 'rec', 'rec_yds', 'rec_td'];
const EPL_COLS = ['goals', 'assists', 'shots', 'shots_on_target'];

/**
 * BATCH: every log a page needs, in three queries.
 *
 * @param ids { nfl: [playerId], cfb: [playerId], epl: [playerId] }
 * @returns Map playerId -> logs[] (newest first)
 */
export async function loadLogs(ids) {
  const out = new Map();
  const push = (pid, row) => {
    if (!out.has(pid)) out.set(pid, []);
    out.get(pid).push(row);
  };

  if (ids.nfl?.length) {
    const rows = await sql`
      SELECT p.id AS player_id, m.season_year AS season, m.week,
             s.pass_yds, s.pass_td, s.rush_td, s.rush_yds, s.rec, s.rec_yds, s.rec_td
        FROM nfl_player_game_stats s
        JOIN nfl_players np ON np.id = s.nfl_player_id
        JOIN players p ON p.external_ids->>'bdl_player_id' = np.bdl_player_id::text
        JOIN matches m ON m.id = s.match_id
       WHERE p.id = ANY(${ids.nfl}) AND m.season_year IS NOT NULL
       ORDER BY p.id, m.season_year DESC, m.kickoff_at DESC`;
    for (const r of rows) push(r.player_id, r);
  }
  if (ids.cfb?.length) {
    const rows = await sql`
      SELECT g.player_id, g.season, g.week, g.opponent,
             g.pass_yds, g.pass_td, g.rush_td, g.rush_yds, g.rec, g.rec_yds, g.rec_td
        FROM cfb_player_game_stats g
       WHERE g.player_id = ANY(${ids.cfb})
       ORDER BY g.player_id, g.season DESC, g.week DESC`;
    for (const r of rows) push(r.player_id, r);
  }
  if (ids.epl?.length) {
    // SHORT CHARTS ARE HONEST CHARTS. Two matchweeks is what exists; the
    // section says two rather than padding to look like a season.
    const rows = await sql`
      SELECT s.player_id, m.season_year AS season, m.week,
             s.goals, s.assists, s.shots, s.shots_on_target
        FROM player_match_stats s
        JOIN matches m ON m.id = s.match_id
       WHERE s.player_id = ANY(${ids.epl})
       ORDER BY s.player_id, m.kickoff_at DESC`;
    for (const r of rows) push(r.player_id, r);
  }
  return out;
}

export { GRIDIRON_COLS, EPL_COLS };
