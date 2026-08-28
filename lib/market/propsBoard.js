// lib/market/propsBoard.js — the full props board's read.
//
// Joins three things the earlier stages built and one the ingest wrote:
//   the PRICE          odds_markets prop rows
//   the PLAYER         propLinking, read-time, two-roster
//   THE STATS          propStats, three queries per page
//   the CHART          the player's own game logs, last 10
//
// FULLY SERVER-RENDERED. There is no client fetch on this board: FULL SEASON
// links to the player page's game-log section, which shipped yesterday and
// already renders every season we hold. The capability is relocated, not cut.
//
// UNLINKED ROWS READ IDENTICALLY MINUS THE CONTEXT, by ruling - same grammar,
// same sort position, no demotion. A missing chart is OUR gap, not the
// player's, and sorting on it would silently editorialize our own coverage.

import { sql } from '../db.js';
import { resolveProps, stripSide } from './propLinking.js';
import { loadLogs, hitRate, contextLine, MARKET_STATS } from './propStats.js';
import { MARKET_LEAGUES } from './reads.js';

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

const num = (v) => (v == null ? null : Number(v));

/**
 * THE BOARD. One page of priced prop rows with everything a row can honestly
 * carry attached.
 */
export async function propsBoard({
  league = 'all', group = 'all', sort = 'move', dir = null, q = '', game = null,
  boardOnly = false, moversOnly = false, limit = BOARD_PAGE,
} = {}) {
  const leagues = MARKET_LEAGUES.includes(league) ? [league] : MARKET_LEAGUES;

  const raw = await sql`
    SELECT l.slug AS league_slug, om.match_id, om.market_type, om.selection_label,
           om.selection_value, om.american_odds, om.implied_probability,
           om.movement_24h_prob, m.kickoff_at, m.slug AS match_slug,
           m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, h.name AS home_name,
           a.abbreviation AS away_abbr, a.name AS away_name
      FROM odds_markets om
      JOIN matches m ON m.id = om.match_id
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE om.is_current AND om.fetcher_version = 'odds-api-v4-props'
       AND l.slug = ANY(${leagues})
       AND m.status = 'scheduled' AND m.kickoff_at > now()`;

  const boardIds = await boardMatchIdSet();
  const links = await resolveProps(sql, raw);

  // PAIRED vs AS-OFFERED, derived from the rows themselves. A de-vigged O/U
  // always ships as a pair for one player; anytime markets and one-sided O/Us
  // have no counterpart. Same rule the /market band already uses.
  const pairCount = new Map();
  for (const r of raw) {
    const base = stripSide(r.selection_label);
    if (base === r.selection_label) continue;
    const k = `${r.match_id}|${r.market_type}|${base}`;
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }

  const groupOf = new Map();
  for (const g of MARKET_GROUPS) for (const m of g.markets) groupOf.set(m, g.key);

  let rows = raw.map((r) => {
    const base = stripSide(r.selection_label);
    const paired = pairCount.get(`${r.match_id}|${r.market_type}|${base}`) >= 2;
    const link = links.get(`${r.match_id}|${r.selection_label}`) ?? null;
    return {
      matchId: r.match_id,
      matchSlug: r.match_slug,
      leagueSlug: r.league_slug,
      marketType: r.market_type,
      marketLabel: MARKET_LABELS[r.market_type] ?? r.market_type,
      group: groupOf.get(r.market_type) ?? null,
      selection: base,
      side: r.selection_label === base ? null : r.selection_label.slice(base.length).trim(),
      line: r.selection_value,
      american: num(r.american_odds),
      // AS-OFFERED CARRIES NO IMPLIED %. It was never de-vigged; showing the
      // raw number in the de-vigged column would imply a normalisation that
      // did not happen.
      impliedPct: paired ? num(r.implied_probability) : null,
      asOffered: !paired,
      moveProb: num(r.movement_24h_prob),
      kickoffAt: r.kickoff_at,
      home: { abbr: r.home_abbr, name: r.home_name },
      away: { abbr: r.away_abbr, name: r.away_name },
      onBoard: boardIds.has(r.match_id),
      playerId: link?.playerId ?? null,
      marketRowLabel: SCORER_SUFFIX[r.market_type]
        ? `Scorer - ${SCORER_SUFFIX[r.market_type]}`
        : (MARKET_LABELS[r.market_type] ?? r.market_type),
    };
  });

  // A GAME SELECTION IS THE WHOLE SHEET for that match - every market, every
  // player - which is why it is not just another chip.
  if (game != null) rows = rows.filter((r) => r.matchId === Number(game));
  if (group !== 'all') rows = rows.filter((r) => r.group === group);
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

  // STATS BEFORE THE SLICE, because the sort is SERVER-SIDE and must return the
  // true top of the BOARD. Sorting by HIT over the loaded page would return the
  // best of forty arbitrary rows and call it the best on the board - the exact
  // difference between a table you can trust and one that flatters whatever
  // arrived first. It costs the same three queries either way: loadLogs is
  // keyed on distinct player ids, and the board's whole linked set is ~700.
  const ids = { nfl: [], cfb: [], epl: [] };
  for (const r of rows) if (r.playerId) ids[r.leagueSlug]?.push(r.playerId);
  for (const k of Object.keys(ids)) ids[k] = [...new Set(ids[k])];
  const logs = await loadLogs(ids);

  for (const r of rows) {
    const l = r.playerId ? logs.get(r.playerId) : null;
    // FIRST/LAST SCORER GET NO HIT RATE - see HIT_RATE_MARKETS. Price and
    // movement still render; HIT and AVG are dashes.
    const hr = l && HIT_RATE_MARKETS.has(r.marketType)
      ? hitRate(l, r.marketType, r.line) : null;
    r.hit = hr ? { cleared: hr.cleared, games: hr.games } : null;
    r.avg = hr ? hr.perGame : null;
    r.context = contextLine(hr);
    r.chart = l && hr ? chartSeries(l, r.marketType, hr) : null;
  }

  rows.sort(sorter(sort, dir));
  rows = rows.slice(0, limit);

  // The slug the name links to, for the page's rows only.
  const pageIds = [...new Set(rows.map((r) => r.playerId).filter((v) => v != null))];
  if (pageIds.length) {
    const slugs = new Map();
    for (const p of await sql`SELECT id, slug FROM players WHERE id = ANY(${pageIds})`) {
      slugs.set(p.id, p.slug);
    }
    for (const r of rows) r.playerSlug = r.playerId ? slugs.get(r.playerId) ?? null : null;
  }

  return { rows, total };
}

/**
 * The last N games as chart bars, with the priced line carried alongside.
 *
 * THE THRESHOLD LINE BELONGS HERE AND NOT ON THE PLAYER PAGE, and that is the
 * whole reason the two surfaces share barsFor but not this: a line compares
 * production to a PRICE, and this is the only surface where a price exists.
 */
export function chartSeries(logs, marketType, hr) {
  const spec = MARKET_STATS[marketType];
  if (!spec || !hr) return null;
  const season = hr.season;
  const games = logs.filter((r) => r.season === season).slice(0, CHART_GAMES);
  const points = games
    .map((r) => {
      let seen = false; let v = 0;
      for (const c of spec.cols) { if (r[c] != null) { seen = true; v += Number(r[c]); } }
      return seen ? { value: v, week: r.week, opponent: r.opponent ?? null } : null;
    })
    .filter(Boolean);
  if (!points.length) return null;
  return { points, line: hr.line, season, noun: spec.noun };
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
 * THE GAME DROPDOWN'S OPTIONS.
 *
 * BOARD GAMES FIRST, then kickoff order, grouped by league - the same
 * editorial rule the CFB band uses, for the same reason: the board is the one
 * thing we have an opinion about, and everything after it is chronology.
 */
export async function propsGames() {
  const rows = await sql`
    SELECT l.slug AS league_slug, m.id AS match_id, m.kickoff_at,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           count(*) AS selections
      FROM odds_markets om
      JOIN matches m ON m.id = om.match_id
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE om.is_current AND om.fetcher_version = 'odds-api-v4-props'
       AND m.status = 'scheduled' AND m.kickoff_at > now()
     GROUP BY 1, 2, 3, 4, 5
     ORDER BY l.slug, m.kickoff_at`;
  const boardIds = await boardMatchIdSet();
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
  });
  return rows
    .map((r) => ({
      matchId: r.match_id,
      leagueSlug: r.league_slug,
      onBoard: boardIds.has(r.match_id),
      selections: Number(r.selections),
      label: `${r.league_slug.toUpperCase()} · ${r.away_abbr ?? '?'} at ${r.home_abbr ?? '?'}`
        + ` · ${when.format(new Date(r.kickoff_at))}`
        + (boardIds.has(r.match_id) ? ' · Board' : ''),
      kickoffAt: r.kickoff_at,
    }))
    .sort((x, y) => (y.onBoard ? 1 : 0) - (x.onBoard ? 1 : 0)
      || x.leagueSlug.localeCompare(y.leagueSlug)
      || new Date(x.kickoffAt) - new Date(y.kickoffAt));
}

async function boardMatchIdSet() {
  const rows = await sql`
    SELECT DISTINCT (g->>'match_id')::int AS match_id
      FROM contests c CROSS JOIN LATERAL jsonb_array_elements(c.board) g
     WHERE c.board IS NOT NULL AND jsonb_typeof(c.board) = 'array'
       AND g->>'match_id' IS NOT NULL`;
  return new Set(rows.map((r) => r.match_id).filter((v) => Number.isFinite(v)));
}
