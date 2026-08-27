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
  devigField,
  median,
} from '../odds.js';
import { fetchSportOdds, fetchSportOutrights, SPORT_KEYS, SPORT_FUTURES_KEYS } from '../theOddsApi.js';
import { joinEventsToMatches, resolveTeamId } from './oddsJoin.js';
import { normalizeName } from './nameMatch.js';

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

// Per-book prices for an N-outcome market, aligned so index i is the same book
// across every outcome. A book contributes only if it prices ALL of them - the
// same all-or-nothing rule collectSides applies to two.
function collectField(event, marketKey, names) {
  const cols = names.map(() => []);
  const books = [];
  for (const bk of event.bookmakers ?? []) {
    const mkt = (bk.markets ?? []).find((m) => m.key === marketKey);
    if (!mkt) continue;
    const found = names.map((n) => (mkt.outcomes ?? []).find((o) => o.name === n));
    if (found.some((o) => !o || !(Number(o.price) > 0))) continue;
    found.forEach((o, i) => cols[i].push(Number(o.price)));
    books.push(bk.title);
  }
  return { cols, books };
}

// THREE-OUTCOME h2h (1X2). SOCCER PRICES THE DRAW, and that is not a variant of
// a two-way market - it is a third thing that can happen. devig2Way cannot
// express it: normalising two of three outcomes would silently redistribute the
// draw's probability into the two sides and report a home price that no book
// ever offered. devigField normalises the whole field, which is the same
// function the futures outrights already use.
async function upsertThreeWay(sql, { matchId, marketType, event, marketKey, names, stampBaseline }) {
  const { cols, books } = collectField(event, marketKey, names);
  if (cols.some((c) => c.length === 0)) return 0;
  const cons = cols.map((c) => median(c));
  const pcts = devigField(cons);
  if (!pcts) return 0;
  let n = 0;
  for (let i = 0; i < names.length; i += 1) {
    const written = await upsertSelection(sql, {
      matchId, marketType, selectionLabel: names[i], selectionValue: null,
      decimalOdds: cons[i], impliedPct: pcts[i], sourceBooks: books, stampBaseline,
    });
    if (written) n += 1;
  }
  return n;
}

async function upsertEventMarkets(sql, matchId, event, stampBaseline, { threeWay = false } = {}) {
  let upserted = 0;
  // h2h — home vs away, no line. Three-way where the draw is priced.
  upserted += threeWay
    ? await upsertThreeWay(sql, {
      matchId, marketType: 'h2h', event, marketKey: 'h2h',
      // Provider outcome names, verbatim: the two clubs and the literal 'Draw'.
      names: [event.home_team, 'Draw', event.away_team], stampBaseline,
    })
    : await upsertTwoWay(sql, {
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
//   sport: 'nfl' | 'cfb' | 'epl' (maps to a The Odds API sport key)
//   -> summary { events, matched, unmatched, unmatchedSample, captured, upserted, budget }
export async function ingestSportOdds(sql, { sport, leagueSlug, stampBaseline = false }) {
  const sportKey = SPORT_KEYS[sport];
  // The draw is a priced outcome in soccer and does not exist in gridiron.
  const threeWay = sport === 'epl';
  if (!sportKey) throw new Error(`ingestSportOdds: unknown sport '${sport}'`);

  const { events, budget, attempts } = await fetchSportOdds(sportKey);
  const join = await joinEventsToMatches(sql, { leagueSlug, sport, events });

  let upserted = 0;
  for (const { event, matchId } of join.matched) {
    upserted += await upsertEventMarkets(sql, matchId, event, stampBaseline, { threeWay });
  }

  return {
    events: join.stats.events,
    matched: join.stats.matched,
    unmatched: join.stats.unmatched,
    unmatchedSample: join.unmatched.slice(0, 8).map((u) => `${u.away} @ ${u.home}`),
    captured: join.stats.captured,
    upserted,
    budget,
    // Only recorded when the call did NOT succeed first time. A key that is
    // absent on every healthy run makes the ones that carry it findable, and
    // keeps the common summary unchanged.
    ...(attempts > 1 ? { attempts } : {}),
  };
}

// ============================================================================
// Futures (championship winner) — market_scope='futures', league-wide, no match
// ============================================================================

// Collect the outright field: outcome name -> [decimal prices across books].
export function collectOutrightField(events) {
  const byName = new Map();
  const books = new Set();
  for (const ev of events ?? []) {
    for (const bk of ev.bookmakers ?? []) {
      const mkt = (bk.markets ?? []).find((m) => m.key === 'outrights');
      if (!mkt) continue;
      books.add(bk.title || bk.key);
      for (const o of mkt.outcomes ?? []) {
        if (o?.name == null) continue;
        if (!byName.has(o.name)) byName.set(o.name, []);
        byName.get(o.name).push(Number(o.price));
      }
    }
  }
  return { byName, books: [...books] };
}

// Upsert one futures selection with an is_current flip. Movement is DAY-OVER-DAY
// (vs the PRIOR edition's actual value) since futures ingest runs once/day — the
// prior current row IS "the prior edition", so previous_* carries its value and
// movement_24h_* = today - prior edition. Keyed on (league_id, market_scope=
// 'futures', market_type='championship_winner', selection_label). match_id NULL.
async function upsertFutureSelection(sql, {
  leagueId, teamId, selectionLabel, decimalOdds, impliedPct, numBooks, sourceBooks,
}) {
  const americanOdds = decimalToAmerican(decimalOdds);
  if (americanOdds == null || impliedPct == null) return false;
  const MT = 'championship_winner';
  // decimal_odds is numeric(6,3) (max 999.999); a longshot title price (decimal
  // >= 1000, common in a ~130-way CFB field) overflows it. The display reads
  // american + implied, not decimal, so store NULL rather than migrate the column.
  const safeDecimal = Number.isFinite(decimalOdds) && decimalOdds < 1000 ? decimalOdds : null;

  // The prior edition's OWN current values (not its baseline) — movement is vs it.
  const prior = (await sql`
    SELECT american_odds, implied_probability, fetched_at
    FROM odds_markets
    WHERE league_id = ${leagueId} AND market_scope = 'futures'
      AND market_type = ${MT} AND selection_label = ${selectionLabel} AND is_current = true
    LIMIT 1`)[0];
  const prevAm = prior ? prior.american_odds : americanOdds;
  const prevImp = prior ? Number(prior.implied_probability) : impliedPct;
  const mvAm = americanOdds - prevAm;
  const mvImp = Math.round((impliedPct - prevImp) * 100) / 100;

  await sql`
    WITH old AS (
      UPDATE odds_markets SET is_current = false
      WHERE league_id = ${leagueId} AND market_scope = 'futures'
        AND market_type = ${MT} AND selection_label = ${selectionLabel} AND is_current = true
      RETURNING 1
    )
    INSERT INTO odds_markets (
      market_scope, market_type, league_id, team_id, match_id, selection_label,
      american_odds, implied_probability, decimal_odds,
      source_books, num_books, consensus_method,
      previous_american_odds, previous_implied_prob,
      movement_24h_odds, movement_24h_prob, previous_snapshot_at,
      is_current, fetched_at, fetcher_version
    ) VALUES (
      'futures', ${MT}, ${leagueId}, ${teamId}, NULL, ${selectionLabel},
      ${americanOdds}, ${impliedPct}, ${safeDecimal},
      ${sourceBooks}, ${numBooks}, 'median',
      ${prevAm}, ${prevImp},
      ${mvAm}, ${mvImp}, COALESCE(${prior?.fetched_at ?? null}, now()),
      true, now(), ${FETCHER_VERSION}
    )`;
  return true;
}

// ingestSportFutures(sql, { sport, leagueSlug, stampBaseline })
//   -> { field, matched, unmatched, unmatchedSample, upserted, budget }
// De-vig is over the FULL field (incl. any "Field"/"Other" outcome), so the stored
// named-team pcts correctly account for the residual probability mass; only the
// resolved teams are written.
export async function ingestSportFutures(sql, { sport, leagueSlug }) {
  const sportKey = SPORT_FUTURES_KEYS[sport];
  if (!sportKey) throw new Error(`ingestSportFutures: unknown sport '${sport}'`);

  const { events, budget, attempts } = await fetchSportOutrights(sportKey);
  // Spread into EVERY return below, including the early ones: a run that
  // retried and then bailed on a missing league is still a run that saw a blip,
  // and that is exactly the signal we are trying not to lose.
  const retried = attempts > 1 ? { attempts } : {};
  const league = (await sql`SELECT id FROM leagues WHERE slug = ${leagueSlug} LIMIT 1`)[0];
  if (!league) return { field: 0, matched: 0, unmatched: 0, unmatchedSample: [], upserted: 0, budget, ...retried };
  const leagueId = league.id;

  const teamRows = await sql`SELECT id, name FROM teams WHERE league_id = ${leagueId}`;
  const teamsByNorm = new Map();
  for (const t of teamRows) teamsByNorm.set(normalizeName(t.name), t.id);
  const teamNormsDesc = [...teamsByNorm.keys()].sort((a, b) => b.length - a.length);

  const { byName, books } = collectOutrightField(events);
  const names = [...byName.keys()];
  const medians = names.map((n) => median(byName.get(n)));
  const pcts = devigField(medians);
  if (!pcts) return { field: names.length, matched: 0, unmatched: names.length, unmatchedSample: [], upserted: 0, budget, ...retried };

  let upserted = 0;
  const unmatched = [];
  for (let i = 0; i < names.length; i++) {
    const teamId = resolveTeamId(sport, names[i], teamsByNorm, teamNormsDesc);
    if (teamId == null || medians[i] == null || pcts[i] == null) { unmatched.push(names[i]); continue; }
    const ok = await upsertFutureSelection(sql, {
      leagueId, teamId, selectionLabel: names[i],
      decimalOdds: medians[i], impliedPct: pcts[i],
      numBooks: byName.get(names[i]).length, sourceBooks: books,
    });
    if (ok) upserted += 1;
  }
  return {
    field: names.length,
    matched: names.length - unmatched.length,
    unmatched: unmatched.length,
    unmatchedSample: unmatched.slice(0, 8),
    upserted,
    budget,
    ...retried,
  };
}
