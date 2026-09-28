// lib/market/propsShape.js - the props board's constants and its PURE filter,
// sort and slice. Split out of propsBoard.js (static /market) because the
// board now filters in the browser, and the browser must not import the
// database driver that propsBoard.js reads rows with. propsBoard.js
// re-exports all of it, so no server caller changed an import.

export const BOARD_PAGE = 40;
export const CHART_GAMES = 10;

/** Vendor market key -> the chip a reader picks and the label a row wears. */
export const MARKET_GROUPS = Object.freeze([
  { key: 'pass', label: 'Pass', markets: ['player_pass_yds', 'player_pass_tds'] },
  { key: 'rush', label: 'Rush', markets: ['player_rush_yds'] },
  { key: 'rec', label: 'Recs', markets: ['player_receptions', 'player_reception_yds'] },
  { key: 'td', label: 'Anytime TD', markets: ['player_anytime_td', 'player_1st_td'] },
  { key: 'scorer', label: 'Scorer', markets: ['player_goal_scorer_anytime', 'player_first_goal_scorer', 'player_last_goal_scorer'] },
  { key: 'shots', label: 'Shots', markets: ['player_shots', 'player_shots_on_target'] },
  { key: 'assists', label: 'Assists', markets: ['player_assists'] },
]);

export const MARKET_LABELS = Object.freeze({
  player_pass_yds: 'Pass yds', player_pass_tds: 'Pass TDs',
  player_rush_yds: 'Rush yds', player_receptions: 'Recs',
  player_reception_yds: 'Rec yds', player_anytime_td: 'Anytime TD',
  player_1st_td: 'First TD', player_goal_scorer_anytime: 'Scorer',
  player_first_goal_scorer: 'First scorer', player_last_goal_scorer: 'Last scorer',
  player_shots: 'Shots', player_shots_on_target: 'Shots OT', player_assists: 'Assists',
});

export const SORTS = Object.freeze([
  ['move', '24h move'], ['implied', 'Implied %'], ['kickoff', 'Kickoff'],
]);

/**
 * THE TABLE'S COLUMNS. `key` is the URL's ?sort= value and `get` is the value
 * the server sorts on - one definition, so a header cannot advertise a sort
 * the sorter does not implement.
 *
 * `num: false` columns sort as text. Everything else sorts numerically with
 * NULL held out, because a dash is not a small number.
 */
export const TABLE_COLUMNS = Object.freeze([
  { key: 'player', label: 'Player', align: 'l', num: false, get: (r) => r.selection },
  { key: 'game', label: 'Game', align: 'l', num: false, get: (r) => `${r.away.abbr} ${r.home.abbr}` },
  { key: 'market', label: 'Market', align: 'l', num: false, get: (r) => r.marketRowLabel },
  { key: 'line', label: 'Line', num: true, get: (r) => (r.line == null ? null : Number(r.line)) },
  { key: 'price', label: 'Price', num: true, get: (r) => r.american },
  { key: 'implied', label: 'Imp%', num: true, get: (r) => r.impliedPct },
  { key: 'move', label: '24h', num: true, get: (r) => (r.moveProb == null ? null : Math.abs(r.moveProb)) },
  { key: 'hit', label: 'Hit', num: true, get: (r) => (r.hit ? r.hit.cleared / r.hit.games : null) },
  { key: 'avg', label: 'Avg', num: true, get: (r) => r.avg },
]);

/**
 * SCORER IS THREE MARKETS WEARING ONE CHIP, and the row has to say which.
 *
 * The chip groups anytime / first / last because a reader thinks "scorer"; the
 * MARKET column distinguishes them because they are different bets. A row that
 * said only "Scorer" for all three would price three questions identically.
 */
export const SCORER_SUFFIX = Object.freeze({
  player_goal_scorer_anytime: 'anytime',
  player_first_goal_scorer: 'first',
  player_last_goal_scorer: 'last',
});

/**
 * OUR LOGS ANSWER "DID HE SCORE", NOT "DID HE SCORE FIRST".
 *
 * player_match_stats carries goal_minutes and goal_types columns and BOTH ARE
 * EMPTY - 282 scoring rows, zero with a minute. Without a minute there is no
 * way to know which goal was first, so a hit rate on first/last scorer would
 * be a number we made up. Those rows carry price and movement and leave HIT and
 * AVG as dashes, exactly like an unlinked row, and for the same reason: the gap
 * is ours and the row says so rather than inventing a figure.
 *
 * If the provider ever populates goal_minutes this becomes a data question
 * again rather than a structural one.
 */
export const HIT_RATE_MARKETS = new Set([
  'player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_receptions',
  'player_reception_yds', 'player_anytime_td', 'player_1st_td',
  'player_goal_scorer_anytime', 'player_shots', 'player_shots_on_target', 'player_assists',
]);

/**
 * SHORT DISPLAY NAMES. The board's name column is ~220px and a card at phone
 * width is narrower still; "Francisco Evanilson de Lima Barbosa" truncates to
 * nonsense in both. The LINES board has the same defect live today with club
 * names, and it gets the same treatment.
 *
 * FIRST INITIAL PLUS SURNAME is the sportscast convention and survives at any
 * width. A single-token name is already short and is left alone - "Rodri" is
 * not improved by becoming "Rodri".
 */
export function shortName(full) {
  const raw = String(full ?? '').trim();
  if (!raw) return '';
  const parts = raw.split(/\s+/);
  if (parts.length < 2) return raw;
  const last = parts[parts.length - 1];
  // Keep a trailing generational suffix attached to the surname it belongs to.
  if (/^(jr|sr|ii|iii|iv)\.?$/i.test(last) && parts.length >= 3) {
    return `${parts[0][0]}. ${parts[parts.length - 2]} ${last}`;
  }
  return `${parts[0][0]}. ${last}`;
}

/**
 * SORTING IS LINK-BLIND. It never reads playerId, and the only way it sees a
 * hit rate is through the column the reader explicitly chose - a row without
 * one is not demoted, it lands where a NULL lands.
 *
 * A DASH IS NOT A SMALL NUMBER. Nulls sort LAST in both directions rather than
 * being treated as zero or as infinity: "no data" is not a worse score, it is
 * the absence of one, and flipping the arrow should not march the unmeasured
 * rows to the top.
 */
function sorter(sort, dir) {
  const col = TABLE_COLUMNS.find((c) => c.key === sort);
  // The default board order stays biggest-mover-first, which is what the board
  // shipped with and what a reader arriving cold is best served by.
  if (!col) return (a, b) => absMove(b) - absMove(a);
  const desc = dir ? dir === 'desc' : defaultDesc(col.key);
  return (a, b) => {
    const av = col.get(a);
    const bv = col.get(b);
    const an = av == null || av === '';
    const bn = bv == null || bv === '';
    if (an && bn) return 0;
    if (an) return 1;   // nulls last, in BOTH directions
    if (bn) return -1;
    const cmp = col.num ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
    return desc ? -cmp : cmp;
  };
}

const absMove = (r) => (r.moveProb == null ? -1 : Math.abs(r.moveProb));

/** Text reads better ascending; magnitudes read better descending. */
function defaultDesc(key) {
  return !['player', 'game', 'market', 'kickoff'].includes(key);
}

/**
 * PURE. The filters, the sort and the slice over propsBoardRows(), in the order
 * propsBoard has always applied them - so `total` (after the game, group, team,
 * market, board, movers and search filters) and `filtered` (after position and
 * hit rate too) mean what they always meant. Never mutates the rows it is given.
 */
export function propsBoardFrom(allRows, {
  group = 'all', sort = 'move', dir = null, q = '', game = null,
  boardOnly = false, moversOnly = false, limit = BOARD_PAGE,
  team = 'all', pos = 'all', marketType = 'all', minHitPct = 0,
} = {}) {
  let rows = [...(allRows ?? [])];
  // A GAME SELECTION IS THE WHOLE SHEET for that match - every market, every
  // player - which is why it is not just another chip.
  if (game != null) rows = rows.filter((r) => r.matchId === Number(game));
  if (group !== 'all') rows = rows.filter((r) => r.group === group);
  // A TEAM IS THE GAME'S TWO ABBREVIATIONS, not a text search. The `q` filter
  // below already matches team names, but it also matches player names, so a
  // reader picking a team chip would get every player whose surname contains
  // it. The chip is exact.
  if (team !== 'all') rows = rows.filter((r) => r.home.abbr === team || r.away.abbr === team);
  if (marketType !== 'all') rows = rows.filter((r) => r.marketType === marketType);
  if (boardOnly) rows = rows.filter((r) => r.onBoard);
  if (moversOnly) rows = rows.filter((r) => r.moveProb != null && Math.abs(r.moveProb) > 0);
  if (q) {
    // Player OR team, because a reader looking for "Chelsea" wants the game
    // and a reader looking for "Palmer" wants the person.
    const needle = q.toLowerCase();
    rows = rows.filter((r) => [r.selection, r.home.name, r.away.name, r.home.abbr, r.away.abbr]
      .some((v) => String(v ?? '').toLowerCase().includes(needle)));
  }

  const total = rows.length;

  // POSITION AND HIT RATE FILTER AFTER THE STATS, and they have to: a hit rate
  // does not exist until loadLogs has run, and a position belongs to a LINKED
  // player. Both are applied before the sort and the slice, so the index's
  // count and its top row are the truth about the filtered board rather than
  // about the first forty rows of it.
  if (pos !== 'all') {
    const want = String(pos).toUpperCase();
    rows = rows.filter((r) => String(r.position ?? '').toUpperCase() === want);
  }
  if (Number(minHitPct) > 0) {
    rows = rows.filter((r) => r.hit && r.hit.games > 0
      && (r.hit.cleared / r.hit.games) * 100 >= Number(minHitPct));
  }

  rows.sort(sorter(sort, dir));
  const filtered = rows.length;
  rows = rows.slice(0, limit);

  // `total` is the board before any filter, which the header has always shown;
  // `filtered` is what the reader is actually looking at, which the index's
  // count needs and the table never asked for.
  return { rows, total, filtered };
}
