// lib/odds.js — Match-winner (1X2) odds normalizer.
//
// Pure functions (no I/O) for the math + a thin I/O layer for fetch +
// upsert. The de-vigging step removes the bookmaker margin (overround)
// from the raw implied probabilities so the three sides sum to exactly
// 100% — that's the number we render and store.
//
// Storage layer follows migration 014: three rows per upsert
// (selection_label in {'home','draw','away'}) with market_scope='match',
// market_type='match_winner'. Re-running upserts the new snapshot, marks
// the prior row is_current=false, and computes movement deltas in a
// single CTE-driven statement per selection.

import { sql } from './db.js';
import { apiSports } from './apiSports.js';

// ============================================================================
// Pure math
// ============================================================================

// Implied probability from decimal odds. Pure: 1/odds.
export function decimalToImplied(decimalOdds) {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 0) return null;
  return 1 / decimalOdds;
}

// Decimal → American. d >= 2.0 → +((d-1)*100). d < 2.0 → -(100/(d-1)).
// Rounded to integer to match the `american_odds integer` column.
export function decimalToAmerican(decimalOdds) {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1.0) return null;
  if (decimalOdds >= 2.0) return Math.round((decimalOdds - 1) * 100);
  return Math.round(-100 / (decimalOdds - 1));
}

// Consensus (median per side) across an array of {home, draw, away} books.
// Median is robust to outliers (e.g. SBO's 2.82 on Arsenal in the PSG fixture).
export function consensusOdds(books) {
  if (!Array.isArray(books) || books.length === 0) return null;
  function medianOf(values) {
    const filtered = values.filter((v) => Number.isFinite(v));
    if (!filtered.length) return null;
    const sorted = [...filtered].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
  const home = medianOf(books.map((b) => Number(b.home)));
  const draw = medianOf(books.map((b) => Number(b.draw)));
  const away = medianOf(books.map((b) => Number(b.away)));
  if (home == null || draw == null || away == null) return null;
  return { home, draw, away };
}

// De-vig three decimal-odds selections → percentages summing to 100.00.
// raw_implied = 1/odds; devigged = raw / sum_of_raw.
export function devig({ home, draw, away }) {
  const iH = decimalToImplied(home);
  const iD = decimalToImplied(draw);
  const iA = decimalToImplied(away);
  if (iH == null || iD == null || iA == null) return null;
  const sum = iH + iD + iA;
  if (!(sum > 0)) return null;
  return {
    home_pct: (iH / sum) * 100,
    draw_pct: (iD / sum) * 100,
    away_pct: (iA / sum) * 100,
    overround_pct: (sum - 1) * 100,
  };
}

// ============================================================================
// Fetch
// ============================================================================

// fetchMatchWinnerOdds(fixtureApiId)
// Pulls /odds?fixture=X&bet=1 from API-Sports, extracts the 1X2 market
// across all bookmakers, takes the median consensus, de-vigs, and returns:
//   { priced: true,
//     home_pct, draw_pct, away_pct,           // de-vigged percentages
//     decimal: { home, draw, away },          // median consensus
//     american: { home, draw, away },         // converted to American
//     overround_pct, book_count, source_books, fetched_at, raw }
// When no bookmaker priced this fixture (the canonical "not priced yet"
// case), returns { priced: false, book_count: 0 } and writes nothing.
export async function fetchMatchWinnerOdds(fixtureApiId) {
  const resp = await apiSports.odds({ fixture: fixtureApiId, bet: 1 });
  const fixtureRow = (resp || [])[0];
  if (!fixtureRow || !Array.isArray(fixtureRow.bookmakers) || fixtureRow.bookmakers.length === 0) {
    return { priced: false, book_count: 0 };
  }

  const books = [];
  const sourceBooks = [];
  for (const b of fixtureRow.bookmakers) {
    const mw = (b.bets || []).find((bet) => bet.name === 'Match Winner' || bet.id === 1);
    if (!mw) continue;
    const values = mw.values || [];
    const home = Number(values.find((v) => /home|^1$/i.test(String(v.value)))?.odd);
    const draw = Number(values.find((v) => /draw|^X$/i.test(String(v.value)))?.odd);
    const away = Number(values.find((v) => /away|^2$/i.test(String(v.value)))?.odd);
    if (Number.isFinite(home) && Number.isFinite(draw) && Number.isFinite(away)) {
      books.push({ home, draw, away });
      sourceBooks.push(b.name);
    }
  }

  if (books.length === 0) {
    return { priced: false, book_count: 0 };
  }

  const consensus = consensusOdds(books);
  if (!consensus) return { priced: false, book_count: books.length };

  const devigged = devig(consensus);
  if (!devigged) return { priced: false, book_count: books.length };

  const american = {
    home: decimalToAmerican(consensus.home),
    draw: decimalToAmerican(consensus.draw),
    away: decimalToAmerican(consensus.away),
  };

  return {
    priced: true,
    home_pct: devigged.home_pct,
    draw_pct: devigged.draw_pct,
    away_pct: devigged.away_pct,
    overround_pct: devigged.overround_pct,
    decimal: consensus,
    american,
    book_count: books.length,
    source_books: sourceBooks,
    fetched_at: fixtureRow.update ?? null,
    raw: { update: fixtureRow.update, bookmakers: books.length },
  };
}

// ============================================================================
// Upsert — one CTE-driven statement per selection. Captures the previous
// snapshot's price/implied for movement, marks prior is_current=false, and
// inserts the new is_current=true row in a single round-trip.
// ============================================================================

const SELECTION_LABELS = ['home', 'draw', 'away'];

async function upsertOneSelection({ matchId, label, decimalOdds, americanOdds, impliedPct, sourceBooks }) {
  await sql`
    WITH prev AS (
      SELECT american_odds, implied_probability, fetched_at
      FROM odds_markets
      WHERE match_id = ${matchId}
        AND market_scope = 'match'
        AND market_type = 'match_winner'
        AND selection_label = ${label}
        AND is_current = true
      ORDER BY fetched_at DESC
      LIMIT 1
    ),
    update_old AS (
      UPDATE odds_markets
      SET is_current = false
      WHERE match_id = ${matchId}
        AND market_scope = 'match'
        AND market_type = 'match_winner'
        AND selection_label = ${label}
        AND is_current = true
      RETURNING 1
    )
    INSERT INTO odds_markets (
      market_scope, market_type, match_id, selection_label,
      american_odds, implied_probability, decimal_odds,
      source_books, num_books, consensus_method,
      previous_american_odds, previous_implied_prob,
      movement_24h_odds, movement_24h_prob, previous_snapshot_at,
      is_current, fetched_at
    )
    SELECT
      'match', 'match_winner', ${matchId}, ${label},
      ${americanOdds}, ${impliedPct}, ${decimalOdds},
      ${sourceBooks}, ${sourceBooks.length}, 'median',
      prev.american_odds, prev.implied_probability,
      ${americanOdds} - prev.american_odds,
      ${impliedPct} - prev.implied_probability,
      prev.fetched_at,
      true, now()
    FROM prev
    UNION ALL
    SELECT
      'match', 'match_winner', ${matchId}, ${label},
      ${americanOdds}, ${impliedPct}, ${decimalOdds},
      ${sourceBooks}, ${sourceBooks.length}, 'median',
      NULL, NULL, NULL, NULL, NULL,
      true, now()
    WHERE NOT EXISTS (SELECT 1 FROM prev)
      AND (SELECT count(*) FROM update_old) >= 0
  `;
}

export async function upsertMatchWinnerOdds(matchId, fixtureApiId) {
  const data = await fetchMatchWinnerOdds(fixtureApiId);
  if (!data.priced) {
    return { priced: false, book_count: data.book_count, written: 0 };
  }

  const decimals = { home: data.decimal.home, draw: data.decimal.draw, away: data.decimal.away };
  const americans = { home: data.american.home, draw: data.american.draw, away: data.american.away };
  const implieds = { home: data.home_pct, draw: data.draw_pct, away: data.away_pct };

  for (const label of SELECTION_LABELS) {
    // Round implied to 2 decimals to fit numeric(5,2)
    const impliedPct = Math.round(implieds[label] * 100) / 100;
    await upsertOneSelection({
      matchId,
      label,
      decimalOdds: decimals[label],
      americanOdds: americans[label],
      impliedPct,
      sourceBooks: data.source_books,
    });
  }

  return {
    priced: true,
    written: 3,
    book_count: data.book_count,
    home_pct: implieds.home,
    draw_pct: implieds.draw,
    away_pct: implieds.away,
    fetched_at: data.fetched_at,
  };
}
