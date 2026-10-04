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
import {
  BOARD_PAGE, CHART_GAMES, MARKET_GROUPS, MARKET_LABELS, SCORER_SUFFIX, HIT_RATE_MARKETS, propsBoardFrom,
} from './propsShape.js';

// The constants, shortName and the pure filter live in ./propsShape.js.
export * from './propsShape.js';

const num = (v) => (v == null ? null : Number(v));

/**
 * THE BOARD. One page of priced prop rows with everything a row can honestly
 * carry attached.
 */
/**
 * THE BOARD'S ROWS FOR ONE LEAGUE CHOICE, before any filter - every database
 * read the board makes, done once for the whole set. Split out of propsBoard
 * (25 Sep) so /market can cache it per league: the filters are the URL's, a
 * scraper was walking thousands of combinations of them, and every one of them
 * re-ran these queries. The stats (hit rate, position, the chart) are per row
 * and do not depend on which other rows survive a filter, so computing them
 * for the whole set gives each row exactly what the filtered pass did.
 */
export async function propsBoardRows(league = 'all') {
  const leagues = MARKET_LEAGUES.includes(league) ? [league] : MARKET_LEAGUES;

  // THE SLATE IS LIVE GAMES AND GAMES STILL TO COME. A prop on a game that has
  // kicked off is still the last thing the books said about it, and dropping it
  // the moment the ball is in the air emptied the board through the exact hours
  // a reader is watching. A FINAL IS STILL OUT: once the game is over the price
  // is history, and the result belongs on the game page, not on a market board.
  // The consensus number itself does not update once play starts, so every
  // surface that draws it stamps the live rows "pre-kick" rather than implying
  // a live price. propsGames() below carries the identical predicate, so the
  // game selector lists exactly the games the board can show.
  const raw = await sql`
    SELECT l.slug AS league_slug, om.match_id, om.market_type, om.selection_label,
           om.selection_value, om.american_odds, om.implied_probability,
           om.movement_24h_prob, om.num_books,
           m.kickoff_at, m.slug AS match_slug, m.status AS match_status,
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
       AND (m.status = 'live'
            OR (m.status = 'scheduled' AND m.kickoff_at > now()))`;

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
      // THE BOOK COUNT, for the index's "N books" line. It is hidden at 1 by
      // the renderer, not here: "1 book" is a true number and a misleading
      // phrase - it reads as a consensus when it is one shop's price.
      numBooks: r.num_books == null ? null : Number(r.num_books),
      kickoffAt: r.kickoff_at,
      matchStatus: r.match_status,
      home: { abbr: r.home_abbr, name: r.home_name },
      away: { abbr: r.away_abbr, name: r.away_name },
      onBoard: boardIds.has(r.match_id),
      playerId: link?.playerId ?? null,
      marketRowLabel: SCORER_SUFFIX[r.market_type]
        ? `Scorer - ${SCORER_SUFFIX[r.market_type]}`
        : (MARKET_LABELS[r.market_type] ?? r.market_type),
    };
  });

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

  // ONE PLAYERS READ FOR THE WHOLE LINKED SET, and it MOVED here rather than
  // being added: the slug lookup used to run after the slice, for the page's
  // rows only. The index filters on POSITION, which has to be known before the
  // filter and therefore before the slice - so the same query now answers both
  // questions for every linked row. Still one query, just earlier and wider.
  const linkedIds = [...new Set(rows.map((r) => r.playerId).filter((v) => v != null))];
  if (linkedIds.length) {
    const meta = new Map();
    for (const p of await sql`
      SELECT p.id, p.slug, p.position, t.abbreviation AS team_abbr
        FROM players p LEFT JOIN teams t ON t.id = p.current_team_id
       WHERE p.id = ANY(${linkedIds})`) {
      meta.set(p.id, p);
    }
    for (const r of rows) {
      const m = r.playerId ? meta.get(r.playerId) : null;
      r.playerSlug = m?.slug ?? null;
      r.position = m?.position ?? null;
      // THE PLAYER'S OWN TEAM, AND ONLY WHEN IT IS ONE OF THESE TWO.
      // resolveProp deliberately does not record which roster carried a label -
      // it resolves against both - so the side comes from the player's current
      // team instead, and a value that is not in this game (stale, null, a
      // transfer) becomes null rather than a guess. A row that cannot say
      // whose player it is says nothing.
      const abbr = m?.team_abbr ?? null;
      r.teamAbbr = abbr && (abbr === r.home.abbr || abbr === r.away.abbr) ? abbr : null;
    }
  }

  for (const r of rows) {
    const l = r.playerId ? logs.get(r.playerId) : null;
    // FIRST/LAST SCORER GET NO HIT RATE - see HIT_RATE_MARKETS. Price and
    // movement still render; HIT and AVG are dashes.
    const hr = l && HIT_RATE_MARKETS.has(r.marketType)
      ? hitRate(l, r.marketType, r.line) : null;
    r.hit = hr ? { cleared: hr.cleared, games: hr.games } : null;
    r.avg = hr ? hr.perGame : null;
    // THE SEASON THE HIT RATE MEASURED, so the wire (lib/market/propsWire.js)
    // can rebuild the context sentence without shipping it.
    r.season = hr ? hr.season : null;
    r.context = contextLine(hr);
    r.chart = l && hr ? chartSeries(l, r.marketType, hr) : null;
  }

  return rows;
}

export async function propsBoard({
  league = 'all', group = 'all', sort = 'move', dir = null, q = '', game = null,
  boardOnly = false, moversOnly = false, limit = BOARD_PAGE,
  // THE INDEX'S FOUR (Player Props Part B). All optional and all default to
  // the board's existing behaviour, so every caller that shipped before this
  // reads identically.
  //   team        an abbreviation on either side of the game
  //   pos         players.position, resolved for LINKED rows only
  //   marketType  ONE of the 13 priced types - narrower than `group`, which
  //               bundles three scorer markets under one chip
  //   minHitPct   a percentage over GAMES PLAYED, not over five
  team = 'all', pos = 'all', marketType = 'all', minHitPct = 0,
} = {}) {
  return propsBoardFrom(await propsBoardRows(league), {
    group, sort, dir, q, game, boardOnly, moversOnly, limit, team, pos, marketType, minHitPct,
  });
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
 * THE CARD'S LAST FIVE, WHICH IS NOT chartSeries's LAST TEN.
 *
 * Two deliberate differences from the board's chart, and both were ruled:
 *
 * IT CROSSES A SEASON, LABELLED. chartSeries filters to hr.season because the
 * board's context line is a claim about one season ("2025: cleared it in 11 of
 * 17") and a chart under it must not mix years. The CARD asks a different
 * question - the last five he played - and in CFB week 3 the honest answer to
 * that reaches back into 2025. It crosses, and `seasons` names every year in
 * the window so the caption can say so. Crossing SILENTLY is the one option
 * that was refused.
 *
 * A DNP SURVIVES AS A POINT WITH NO VALUE. chartSeries drops unmeasured games
 * entirely; that is right for a board row with 34px of space and wrong for a
 * card, where a missing week is information. The point rides with value null
 * and the renderer draws an outline - he was not measured, he did not fail.
 * The hit rate is still computed by hitRate() over the measured games only, so
 * an outline never enters a denominator.
 *
 * @returns { points: [{value, week, season, opponent}], line, seasons, crossed }
 */
export function cardSeries(logs, marketType, line, n = 5) {
  const spec = MARKET_STATS[marketType];
  if (!spec || !logs?.length || line == null) return null;
  // logs arrive newest-first from loadLogs; take the newest n and draw them
  // oldest-first, the direction a reader reads a run of games in.
  const window = logs.slice(0, n);
  if (!window.length) return null;
  const points = window.map((r) => {
    let seen = false; let v = 0;
    for (const c of spec.cols) { if (r[c] != null) { seen = true; v += Number(r[c]); } }
    return { value: seen ? v : null, week: r.week ?? null, season: r.season ?? null, opponent: r.opponent ?? null };
  }).reverse();
  const seasons = [...new Set(points.map((p) => p.season).filter((x) => x != null))].sort();
  return { points, line: Number(line), seasons, crossed: seasons.length > 1, noun: spec.noun };
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
       AND (m.status = 'live'
            OR (m.status = 'scheduled' AND m.kickoff_at > now()))
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
