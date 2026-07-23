/**
 * lib/gridiron/oddsIngest.js — fetch The Odds API -> join -> upsert odds_markets.
 *
 * One sport-level fetch (3 credits) yields every upcoming event; joinEventsToMatches
 * maps them to our scheduled matches; each matched event's h2h / spreads / totals
 * markets are consensus-medianed across US books, de-vigged (2-way), and written to
 * odds_markets under the SAME is_current-flip + previous-star movement pattern the
 * soccer refresh uses (history accumulates; nothing is deleted).
 *
 *   market_scope = 'match'
 *   market_type  = 'h2h' | 'spread' | 'total'
 *   consensus_method = 'median'   (written explicitly)
 *   fetcher_version  = 'odds-api-v4'
 *   selection_value carries the line for spread/total ('-3.5', 'O 47.5'); null for h2h
 *
 * The h2h de-vigged implied_probability is the number the gridiron match page will
 * read (see route/module notes) — same odds_markets is_current=true read path the
 * soccer match pages already use.
 */

import {
  consensusOdds2Way,
  devig2Way,
  consensusPoint,
  decimalToAmerican,
} from '../odds.js';
import { fetchSportOdds, SPORT_KEYS } from '../theOddsApi.js';
import { joinEventsToMatches } from './oddsJoin.js';

const FETCHER_VERSION = 'odds-api-v4';

// Per-book prices (and points) for a market, aligned so index i is the same book
// on both sides. A book contributes only if it prices BOTH outcomes.
function collectSides(event, marketKey, aName, bName) {
  const a = [];
  const b = [];
  const books = [];
  for (const bk of event.bookmakers ?? []) {
    const mkt = (bk.markets ?? []).find((m) => m.key === marketKey);
    if (!mkt || !Array.isArray(mkt.outcomes)) continue;
    const oa = mkt.outcomes.find((o) => o.name === aName);
    const ob = mkt.outcomes.find((o) => o.name === bName);
    if (!oa || !ob) continue;
    a.push({ price: Number(oa.price), point: oa.point });
    b.push({ price: Number(ob.price), point: ob.point });
    books.push(bk.title || bk.key);
  }
  return { a, b, books };
}

function fmtLine(n) {
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'PK';
  return `${n > 0 ? '+' : ''}${n}`;
}

// Upsert one priced selection with the is_current flip + baseline-carry movement.
// Keyed on (match_id, market_scope='match', market_type, selection_label).
async function upsertSelection(sql, {
  matchId, marketType, selectionLabel, selectionValue,
  decimalOdds, impliedPct, sourceBooks, stampBaseline,
}) {
  const americanOdds = decimalToAmerican(decimalOdds);
  if (americanOdds == null) return false;
  const numBooks = sourceBooks.length;

  const prior = (await sql`
    SELECT previous_american_odds, previous_implied_prob, previous_snapshot_at
    FROM odds_markets
    WHERE match_id = ${matchId}
      AND market_scope = 'match'
      AND market_type = ${marketType}
      AND selection_label = ${selectionLabel}
      AND is_current = true
    LIMIT 1`)[0];

  const establishBaseline = stampBaseline || !prior;

  if (establishBaseline) {
    await sql`
      WITH update_old AS (
        UPDATE odds_markets SET is_current = false
        WHERE match_id = ${matchId} AND market_scope = 'match'
          AND market_type = ${marketType} AND selection_label = ${selectionLabel}
          AND is_current = true
        RETURNING 1
      )
      INSERT INTO odds_markets (
        market_scope, market_type, match_id, selection_label, selection_value,
        american_odds, implied_probability, decimal_odds,
        source_books, num_books, consensus_method,
        previous_american_odds, previous_implied_prob,
        movement_24h_odds, movement_24h_prob, previous_snapshot_at,
        is_current, fetched_at, fetcher_version
      ) VALUES (
        'match', ${marketType}, ${matchId}, ${selectionLabel}, ${selectionValue},
        ${americanOdds}, ${impliedPct}, ${decimalOdds},
        ${sourceBooks}, ${numBooks}, 'median',
        ${americanOdds}, ${impliedPct},
        0, 0, now(),
        true, now(), ${FETCHER_VERSION}
      )`;
    return true;
  }

  const baselineAmerican = prior.previous_american_odds;
  const baselineImplied = Number(prior.previous_implied_prob);
  const movementAmerican = americanOdds - baselineAmerican;
  const movementImplied = Math.round((impliedPct - baselineImplied) * 100) / 100;

  await sql`
    WITH update_old AS (
      UPDATE odds_markets SET is_current = false
      WHERE match_id = ${matchId} AND market_scope = 'match'
        AND market_type = ${marketType} AND selection_label = ${selectionLabel}
        AND is_current = true
      RETURNING 1
    )
    INSERT INTO odds_markets (
      market_scope, market_type, match_id, selection_label, selection_value,
      american_odds, implied_probability, decimal_odds,
      source_books, num_books, consensus_method,
      previous_american_odds, previous_implied_prob,
      movement_24h_odds, movement_24h_prob, previous_snapshot_at,
      is_current, fetched_at, fetcher_version
    ) VALUES (
      'match', ${marketType}, ${matchId}, ${selectionLabel}, ${selectionValue},
      ${americanOdds}, ${impliedPct}, ${decimalOdds},
      ${sourceBooks}, ${numBooks}, 'median',
      ${baselineAmerican}, ${baselineImplied},
      ${movementAmerican}, ${movementImplied}, COALESCE(${prior.previous_snapshot_at}, now()),
      true, now(), ${FETCHER_VERSION}
    )`;
  return true;
}

// Build 2-way consensus + de-vig for one (a,b) market and upsert both selections.
async function upsertTwoWay(sql, {
  matchId, marketType, event, marketKey, aName, bName,
  aLabel, bLabel, lineForSide, stampBaseline,
}) {
  const { a, b, books } = collectSides(event, marketKey, aName, bName);
  if (!a.length || !b.length) return 0;
  const cons = consensusOdds2Way(a.map((x, i) => ({ a: x.price, b: b[i].price })));
  if (!cons) return 0;
  const dv = devig2Way(cons);
  if (!dv) return 0;

  let n = 0;
  const aWritten = await upsertSelection(sql, {
    matchId, marketType, selectionLabel: aLabel,
    selectionValue: lineForSide ? lineForSide(consensusPoint(a.map((x) => x.point))) : null,
    decimalOdds: cons.a, impliedPct: dv.a_pct, sourceBooks: books, stampBaseline,
  });
  const bWritten = await upsertSelection(sql, {
    matchId, marketType, selectionLabel: bLabel,
    selectionValue: lineForSide ? lineForSide(consensusPoint(b.map((x) => x.point))) : null,
    decimalOdds: cons.b, impliedPct: dv.b_pct, sourceBooks: books, stampBaseline,
  });
  if (aWritten) n += 1;
  if (bWritten) n += 1;
  return n;
}

async function upsertEventMarkets(sql, matchId, event, stampBaseline) {
  let upserted = 0;
  // h2h — home vs away, no line.
  upserted += await upsertTwoWay(sql, {
    matchId, marketType: 'h2h', event, marketKey: 'h2h',
    aName: event.home_team, bName: event.away_team,
    aLabel: event.home_team, bLabel: event.away_team,
    lineForSide: null, stampBaseline,
  });
  // spread — each side carries its own signed handicap.
  upserted += await upsertTwoWay(sql, {
    matchId, marketType: 'spread', event, marketKey: 'spreads',
    aName: event.home_team, bName: event.away_team,
    aLabel: event.home_team, bLabel: event.away_team,
    lineForSide: (pt) => fmtLine(pt), stampBaseline,
  });
  // total — over / under share the number.
  upserted += await upsertTwoWay(sql, {
    matchId, marketType: 'total', event, marketKey: 'totals',
    aName: 'Over', bName: 'Under',
    aLabel: 'Over', bLabel: 'Under',
    lineForSide: (pt) => (Number.isFinite(pt) ? `${pt}` : null), stampBaseline,
  });
  return upserted;
}

// ingestSportOdds(sql, { sport, leagueSlug, stampBaseline })
//   sport: 'nfl' | 'cfb' (maps to a The Odds API sport key)
//   -> summary { events, matched, unmatched, unmatchedSample, captured, upserted, budget }
export async function ingestSportOdds(sql, { sport, leagueSlug, stampBaseline = false }) {
  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) throw new Error(`ingestSportOdds: unknown sport '${sport}'`);

  const { events, budget } = await fetchSportOdds(sportKey);
  const join = await joinEventsToMatches(sql, { leagueSlug, sport, events });

  let upserted = 0;
  for (const { event, matchId } of join.matched) {
    upserted += await upsertEventMarkets(sql, matchId, event, stampBaseline);
  }

  return {
    events: join.stats.events,
    matched: join.stats.matched,
    unmatched: join.stats.unmatched,
    unmatchedSample: join.unmatched.slice(0, 8).map((u) => `${u.away} @ ${u.home}`),
    captured: join.stats.captured,
    upserted,
    budget,
  };
}
