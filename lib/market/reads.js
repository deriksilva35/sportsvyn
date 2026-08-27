// lib/market/reads.js - /market's reads. ALL READS, ZERO WRITES.
//
// ONE SURFACE, ONE SOURCE. Everything here comes from odds_markets rows written
// by The Odds API ingest (fetcher_version 'odds-api-v4'). The OTHER soccer feed
// - API-Sports, behind /api/cron/refresh-odds - also writes this table, and its
// rows are World Cup and international-friendlies history. They are filtered
// out, not because the data is bad but because two vendors' consensus numbers
// are not comparable and must never end up averaged into one price.
//
// LEAGUE SCOPING GOES THROUGH match_id, NEVER league_id.
//
//   odds_markets.league_id IS NULL ON EVERY MATCH-SCOPE ROW. It is populated
//   only on futures rows, which have no match_id. A GROUP BY league_id over
//   match markets therefore returns a single bucket named (null) holding two
//   million rows - which is not an error, it is a plausible-looking wrong
//   answer, and that is worse. The join is matches -> leagues, and a test pins
//   that no match-scope read in this file names league_id.

import { sql } from '../db.js';

// The three leagues /market covers, in the order their bands render.
export const MARKET_LEAGUES = Object.freeze(['cfb', 'nfl', 'epl']);

// Soccer prices the draw. Gridiron does not, and the difference is structural
// rather than cosmetic - it decides how many rows a card's h2h block has and
// which de-vig the ingest had to use.
export const THREE_WAY = Object.freeze(['epl']);

const FETCHER = 'odds-api-v4';

/**
 * COUNTED, NEVER HARDCODED. The "median of N books" line is a claim about how
 * the number in front of the reader was made, so N is the real count of
 * distinct bookmakers in the rows being shown, per league. It differs by
 * league (the recon found nfl 7, cfb 5, epl 9) and it will drift as books come
 * and go; a literal would be a lie the moment one does.
 */
export async function bookCounts() {
  const rows = await sql`
    SELECT l.slug, count(DISTINCT b) AS books
      FROM odds_markets om
      JOIN matches m ON m.id = om.match_id
      JOIN leagues l ON l.id = m.league_id,
      LATERAL unnest(om.source_books) AS b
     WHERE om.is_current
       AND om.fetcher_version = ${FETCHER}
     GROUP BY l.slug`;
  const out = new Map();
  for (const r of rows) out.set(r.slug, Number(r.books));
  return out;
}

/**
 * THE PRICED SLATE, one row per (match, market_type, selection).
 *
 * Scheduled games only: a price on a game that has kicked off is not a price,
 * it is a fossil. The ingest already freezes at kickoff by only joining
 * scheduled matches; this restates it on the read side so a stale is_current
 * row can never surface as a live market.
 */
export async function pricedSlate({ leagues = MARKET_LEAGUES, limitPerLeague = 24 } = {}) {
  const rows = await sql`
    SELECT l.slug AS league_slug, m.id AS match_id, m.slug AS match_slug,
           m.kickoff_at, m.week, m.season_phase,
           h.name AS home_name, h.abbreviation AS home_abbr,
           a.name AS away_name, a.abbreviation AS away_abbr,
           om.market_type, om.selection_label, om.selection_value,
           om.american_odds, om.implied_probability,
           om.movement_24h_prob, om.movement_24h_odds
      FROM odds_markets om
      JOIN matches m ON m.id = om.match_id
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE om.is_current
       AND om.market_scope = 'match'
       AND om.fetcher_version = ${FETCHER}
       AND l.slug = ANY(${leagues})
       AND m.status = 'scheduled'
       AND m.kickoff_at > now()
     ORDER BY m.kickoff_at ASC, om.market_type, om.id`;
  return groupToCards(rows, limitPerLeague);
}

/**
 * BOARD GAMES FIRST, within CFB.
 *
 * contests.board is a jsonb array whose entries key on match_id - the same
 * shape lib/pickem/entry.js and settle.js read. Board membership is the only
 * editorial ordering on this page; everything else is kickoff order, because
 * the board is a record of what the market is doing and has no other opinion
 * about which game matters.
 */
export async function boardMatchIds() {
  const rows = await sql`
    SELECT DISTINCT (g->>'match_id')::int AS match_id
      FROM contests c
      CROSS JOIN LATERAL jsonb_array_elements(c.board) g
     WHERE c.board IS NOT NULL
       AND jsonb_typeof(c.board) = 'array'
       AND g->>'match_id' IS NOT NULL`;
  return new Set(rows.map((r) => r.match_id).filter((v) => Number.isFinite(v)));
}

// Fold the flat selection rows into one card per match.
function groupToCards(rows, limitPerLeague) {
  const byMatch = new Map();
  for (const r of rows) {
    let card = byMatch.get(r.match_id);
    if (!card) {
      card = {
        matchId: r.match_id,
        slug: r.match_slug,
        leagueSlug: r.league_slug,
        kickoffAt: r.kickoff_at,
        week: r.week,
        seasonPhase: r.season_phase,
        home: { name: r.home_name, abbreviation: r.home_abbr },
        away: { name: r.away_name, abbreviation: r.away_abbr },
        threeWay: THREE_WAY.includes(r.league_slug),
        h2h: [],
        spread: [],
        total: [],
      };
      byMatch.set(r.match_id, card);
    }
    const sel = {
      label: r.selection_label,
      value: r.selection_value,
      american: r.american_odds == null ? null : Number(r.american_odds),
      impliedPct: r.implied_probability == null ? null : Number(r.implied_probability),
      // The 24h stamp, set daily at the 00:00-UTC tick. NULL means "no baseline
      // yet", which is a different fact from "did not move" and renders as a
      // dash rather than as a zero.
      moveProb: r.movement_24h_prob == null ? null : Number(r.movement_24h_prob),
      moveOdds: r.movement_24h_odds == null ? null : Number(r.movement_24h_odds),
    };
    if (card[r.market_type]) card[r.market_type].push(sel);
  }

  const byLeague = new Map();
  for (const slug of MARKET_LEAGUES) byLeague.set(slug, []);
  for (const card of byMatch.values()) {
    orderH2h(card);
    const bucket = byLeague.get(card.leagueSlug);
    if (bucket) bucket.push(card);
  }
  for (const [slug, list] of byLeague) byLeague.set(slug, list.slice(0, limitPerLeague));
  return byLeague;
}

/**
 * H2H ROW ORDER. Favourite first on a two-way card - the shorter price is the
 * story. On a three-way card the DRAW SITS IN THE MIDDLE regardless of its
 * price, because 1X2 is a conventional order that soccer readers already know,
 * and re-sorting it by probability would make the middle row mean nothing.
 */
function orderH2h(card) {
  if (!card.h2h.length) return;
  if (card.threeWay) {
    const draw = card.h2h.filter((s) => s.label === 'Draw');
    const sides = card.h2h.filter((s) => s.label !== 'Draw');
    sides.sort((x, y) => (y.impliedPct ?? 0) - (x.impliedPct ?? 0));
    card.h2h = sides.length === 2 && draw.length ? [sides[0], draw[0], sides[1]] : [...sides, ...draw];
    return;
  }
  card.h2h.sort((x, y) => (y.impliedPct ?? 0) - (x.impliedPct ?? 0));
}

/** TITLE FUTURES. These DO carry league_id - they have no match to join to. */
export async function futuresBoards({ topN = 5 } = {}) {
  const rows = await sql`
    SELECT l.slug AS league_slug, om.selection_label, om.american_odds,
           om.implied_probability
      FROM odds_markets om
      JOIN leagues l ON l.id = om.league_id
     WHERE om.is_current
       AND om.market_scope = 'futures'
       AND om.fetcher_version = ${FETCHER}
     ORDER BY l.slug, om.implied_probability DESC NULLS LAST`;
  const byLeague = new Map();
  for (const r of rows) {
    if (!byLeague.has(r.league_slug)) byLeague.set(r.league_slug, []);
    byLeague.get(r.league_slug).push({
      label: r.selection_label,
      american: r.american_odds == null ? null : Number(r.american_odds),
      impliedPct: r.implied_probability == null ? null : Number(r.implied_probability),
    });
  }
  return [...byLeague.entries()].map(([slug, all]) => ({
    leagueSlug: slug, priced: all.length, top: all.slice(0, topN),
  }));
}

/** The freshest thing on the page, for the SNAPSHOT stamp. */
export async function latestSnapshotAt() {
  const r = await sql`
    SELECT max(fetched_at) AS at FROM odds_markets
     WHERE is_current AND fetcher_version = ${FETCHER}`;
  return r[0]?.at ?? null;
}

/**
 * MOVERS ONLY. Any selection on the card whose 24h probability move is
 * non-zero. NULL is not zero - a market with no baseline yet has not been
 * observed to hold still, it has not been observed at all.
 */
export function hasMovement(card) {
  return [...card.h2h, ...card.spread, ...card.total]
    .some((s) => s.moveProb != null && Math.abs(s.moveProb) > 0);
}
