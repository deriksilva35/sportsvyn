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
  league = 'all', group = 'all', sort = 'move', q = '',
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
    };
  });

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

  rows.sort(sorter(sort));
  const total = rows.length;
  rows = rows.slice(0, limit);

  // THE STATS + CHART, for the page's rows only. Three queries, and only for
  // what is about to render.
  const ids = { nfl: [], cfb: [], epl: [] };
  for (const r of rows) if (r.playerId) ids[r.leagueSlug]?.push(r.playerId);
  for (const k of Object.keys(ids)) ids[k] = [...new Set(ids[k])];
  const logs = await loadLogs(ids);

  // The slug the name links to. One query for the page's linked players -
  // resolveProps returns ids, and a link needs the address.
  const allIds = [...new Set([...ids.nfl, ...ids.cfb, ...ids.epl])];
  const slugs = new Map();
  if (allIds.length) {
    for (const p of await sql`SELECT id, slug FROM players WHERE id = ANY(${allIds})`) {
      slugs.set(p.id, p.slug);
    }
  }

  for (const r of rows) {
    const l = r.playerId ? logs.get(r.playerId) : null;
    const hr = l ? hitRate(l, r.marketType, r.line) : null;
    r.context = contextLine(hr);
    r.chart = l ? chartSeries(l, r.marketType, hr) : null;
    r.playerSlug = r.playerId ? slugs.get(r.playerId) ?? null : null;
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

function sorter(sort) {
  if (sort === 'implied') {
    return (a, b) => (b.impliedPct ?? -1) - (a.impliedPct ?? -1);
  }
  if (sort === 'kickoff') {
    return (a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt);
  }
  // 24H MOVE, biggest absolute mover first. A NULL has not been observed to
  // move and sorts last - it is not a zero.
  return (a, b) => {
    const av = a.moveProb == null ? -1 : Math.abs(a.moveProb);
    const bv = b.moveProb == null ? -1 : Math.abs(b.moveProb);
    return bv - av;
  };
}

async function boardMatchIdSet() {
  const rows = await sql`
    SELECT DISTINCT (g->>'match_id')::int AS match_id
      FROM contests c CROSS JOIN LATERAL jsonb_array_elements(c.board) g
     WHERE c.board IS NOT NULL AND jsonb_typeof(c.board) = 'array'
       AND g->>'match_id' IS NOT NULL`;
  return new Set(rows.map((r) => r.match_id).filter((v) => Number.isFinite(v)));
}
