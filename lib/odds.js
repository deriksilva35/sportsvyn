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
// Two-way consensus + de-vig (gridiron: h2h / spread / total — no draw)
// ============================================================================
// Deliberately separate from the 3-way soccer path above. NFL/CFB markets are
// binary (home/away, favorite/dog, over/under), so consensus + de-vig run over
// exactly two outcomes. Same median-consensus + proportional-de-vig methodology.
// (Shared `median` helper is defined + exported below, reused from the soccer path.)

// consensusOdds2Way(books): books = [{ a, b }] decimal prices per book. Medians
// each side independently (a book missing a side is filtered per-side). null if
// either side has no finite price.
export function consensusOdds2Way(books) {
  if (!Array.isArray(books) || books.length === 0) return null;
  const a = median(books.map((x) => Number(x.a)));
  const b = median(books.map((x) => Number(x.b)));
  if (a == null || b == null) return null;
  return { a, b };
}

// devig2Way({ a, b }): proportional de-vig over two decimal-odds outcomes.
// raw_i = 1/odds; pct_i = raw_i / sum. overround_pct = (sum - 1) * 100.
export function devig2Way({ a, b }) {
  const iA = decimalToImplied(a);
  const iB = decimalToImplied(b);
  if (iA == null || iB == null) return null;
  const sum = iA + iB;
  if (!(sum > 0)) return null;
  return {
    a_pct: (iA / sum) * 100,
    b_pct: (iB / sum) * 100,
    overround_pct: (sum - 1) * 100,
  };
}

// consensusPoint(points): median line for spreads/totals (e.g. the -3.5 handicap
// or the 47.5 total). Alias of median() named for call-site clarity.
export function consensusPoint(points) {
  return median(points);
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
// Pure: parse the 1X2 market out of an API-Sports fixture-odds row (works
// whether the call was bet-filtered or the full unfiltered payload).
function parseMatchWinner(fixtureRow) {
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

  if (books.length === 0) return { priced: false, book_count: 0 };

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

export async function fetchMatchWinnerOdds(fixtureApiId) {
  const resp = await apiSports.odds({ fixture: fixtureApiId, bet: 1 });
  return parseMatchWinner((resp || [])[0]);
}

// Median of an array of finite numbers (null if none). Exported for the 2-way
// gridiron consensus (consensusOdds2Way / consensusPoint) above.
export function median(values) {
  const f = (values ?? []).filter((v) => Number.isFinite(v));
  if (!f.length) return null;
  const s = [...f].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// Parse Goals Over/Under (bet 5): group by line, keep only lines priced by
// >= 3 books on BOTH sides, median-consensus each side, two-way de-vig.
const MIN_TOTALS_BOOKS = 3;
function parseTotals(fixtureRow) {
  if (!fixtureRow || !Array.isArray(fixtureRow.bookmakers)) return [];
  const lines = new Map(); // line -> { over: [], under: [] }
  for (const b of fixtureRow.bookmakers) {
    const t = (b.bets || []).find((x) => x.id === 5 || x.name === 'Goals Over/Under');
    if (!t) continue;
    for (const v of (t.values || [])) {
      const m = String(v.value).match(/^(Over|Under)\s+([\d.]+)$/i);
      if (!m) continue;
      const side = m[1].toLowerCase();
      const line = m[2];
      const dec = Number(v.odd);
      if (!Number.isFinite(dec)) continue;
      if (!lines.has(line)) lines.set(line, { over: [], under: [] });
      lines.get(line)[side].push(dec);
    }
  }
  const out = [];
  for (const [line, { over, under }] of lines) {
    if (over.length < MIN_TOTALS_BOOKS || under.length < MIN_TOTALS_BOOKS) continue;
    const od = median(over);
    const ud = median(under);
    const oa = decimalToAmerican(od);
    const ua = decimalToAmerican(ud);
    if (od == null || ud == null || oa == null || ua == null) continue;
    const iO = 1 / od;
    const iU = 1 / ud;
    const sum = iO + iU;
    out.push({
      line,
      over:  { decimal: od, american: oa, implied: (iO / sum) * 100, books: over.length },
      under: { decimal: ud, american: ua, implied: (iU / sum) * 100, books: under.length },
    });
  }
  return out;
}

// Parse Anytime Goal Scorer (bet 92): median price per player. Single-sided
// (no opposite to de-vig against), so implied % is 1/decimal AS OFFERED and
// still carries the book margin. Scorer markets are thin pre-kickoff (often a
// single book), so the min-books floor is 1 -- see MIN_SCORER_BOOKS.
const MIN_SCORER_BOOKS = 1;
function parseScorers(fixtureRow) {
  if (!fixtureRow || !Array.isArray(fixtureRow.bookmakers)) return [];
  const players = new Map(); // name -> [decimals]
  for (const b of fixtureRow.bookmakers) {
    const s = (b.bets || []).find((x) => x.id === 92 || x.name === 'Anytime Goal Scorer');
    if (!s) continue;
    for (const v of (s.values || [])) {
      const name = String(v.value).trim();
      const dec = Number(v.odd);
      if (!name || !Number.isFinite(dec)) continue;
      if (!players.has(name)) players.set(name, []);
      players.get(name).push(dec);
    }
  }
  const out = [];
  for (const [player, decs] of players) {
    if (decs.length < MIN_SCORER_BOOKS) continue;
    const dec = median(decs);
    const am = decimalToAmerican(dec);
    if (dec == null || am == null) continue;
    out.push({ player, decimal: dec, american: am, implied: (1 / dec) * 100, books: decs.length });
  }
  out.sort((a, b) => b.implied - a.implied); // most likely first
  return out;
}

// ONE unfiltered fixture-odds call -> match_winner + totals + scorers. Request
// count is unchanged vs the old bet=1 fetch: still one API call per fixture.
export async function fetchAllMarketsForFixture(fixtureApiId) {
  const resp = await apiSports.odds({ fixture: fixtureApiId });
  const row = (resp || [])[0];
  return {
    matchWinner: parseMatchWinner(row),
    totals: parseTotals(row),
    scorers: parseScorers(row),
  };
}

// ============================================================================
// Upsert — two write modes for Option-B daily-baseline movement:
//
//   stampBaseline = false  (HOURLY REFRESH)
//     Read the prior current row's previous_* columns (the baseline).
//     Carry them forward into the new row. movement_24h_* = new current
//     minus baseline. The baseline stays put across hourly refreshes.
//
//   stampBaseline = true   (DAILY BASELINE STAMP)
//     Set previous_* to today's new current values, previous_snapshot_at
//     = now(), movement_24h_* = 0. The 24-hour reference point resets.
//
//   First-ever insert (no prior row) is always a baseline establishment:
//     same shape as stampBaseline=true.
//
// Each selection is written in one CTE statement that marks the old
// is_current row false and inserts the new is_current=true row.
// ============================================================================

const SELECTION_LABELS = ['home', 'draw', 'away'];

async function upsertOneSelection({ matchId, label, decimalOdds, americanOdds, impliedPct, sourceBooks, stampBaseline }) {
  // Read the prior current row's BASELINE (previous_*), not its current.
  // Carrying the baseline forward is what makes hourly refresh preserve
  // the 24-hour reference point.
  const priorRows = await sql`
    SELECT previous_american_odds, previous_implied_prob, previous_snapshot_at
    FROM odds_markets
    WHERE match_id = ${matchId}
      AND market_scope = 'match'
      AND market_type = 'match_winner'
      AND selection_label = ${label}
      AND is_current = true
    LIMIT 1
  `;
  const prior = priorRows[0];

  // Baseline establishment: first insert (no prior) OR explicit daily stamp.
  // Otherwise carry the existing baseline forward.
  const establishBaseline = stampBaseline || !prior;

  if (establishBaseline) {
    // previous_* = current, movement = 0, previous_snapshot_at = now()
    await sql`
      WITH update_old AS (
        UPDATE odds_markets SET is_current = false
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
      ) VALUES (
        'match', 'match_winner', ${matchId}, ${label},
        ${americanOdds}, ${impliedPct}, ${decimalOdds},
        ${sourceBooks}, ${sourceBooks.length}, 'median',
        ${americanOdds}, ${impliedPct},
        0, 0,
        now(),
        true, now()
      )
    `;
    return;
  }

  // Hourly refresh — carry baseline forward, compute movement vs it.
  const baselineAmerican = prior.previous_american_odds;
  const baselineImplied = Number(prior.previous_implied_prob);
  const movementAmerican = americanOdds - baselineAmerican;
  const movementImpliedRaw = impliedPct - baselineImplied;
  const movementImplied = Math.round(movementImpliedRaw * 100) / 100;
  const baselineAt = prior.previous_snapshot_at;

  await sql`
    WITH update_old AS (
      UPDATE odds_markets SET is_current = false
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
    ) VALUES (
      'match', 'match_winner', ${matchId}, ${label},
      ${americanOdds}, ${impliedPct}, ${decimalOdds},
      ${sourceBooks}, ${sourceBooks.length}, 'median',
      ${baselineAmerican}, ${baselineImplied},
      ${movementAmerican}, ${movementImplied},
      COALESCE(${baselineAt}, now()),
      true, now()
    )
  `;
}

export async function upsertMatchWinnerOdds(matchId, fixtureApiId, options = {}) {
  const stampBaseline = options.stampBaseline === true;
  // Reuse a pre-fetched payload (from fetchAllMarketsForFixture) when provided
  // so the refresh cron makes ONE API call per fixture; else fetch bet=1.
  const data = options.marketData ?? await fetchMatchWinnerOdds(fixtureApiId);
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
      stampBaseline,
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
    stamped_baseline: stampBaseline,
  };
}

// ============================================================================
// Secondary markets (totals, anytime scorer) — info-only on the board (no
// model, no tag). Same is_current snapshot lifecycle as match_winner: demote
// the matching current row, insert the new one is_current=true. No 24h
// movement columns (those are the tag chip's concern); "since open" comes from
// the retained history via MIN(fetched_at), same as match_winner.
// ============================================================================

function round2(n) { return Math.round(Number(n) * 100) / 100; }

async function upsertSecondaryMarket({
  matchId, marketType, selectionLabel, selectionValue,
  americanOdds, impliedPct, decimalOdds, sourceBooksCount,
}) {
  await sql`
    WITH old AS (
      UPDATE odds_markets SET is_current = false
      WHERE match_id = ${matchId}
        AND market_scope = 'match'
        AND market_type = ${marketType}
        AND selection_label = ${selectionLabel}
        AND selection_value IS NOT DISTINCT FROM ${selectionValue}
        AND is_current = true
      RETURNING 1
    )
    INSERT INTO odds_markets (
      market_scope, market_type, match_id, selection_label, selection_value,
      american_odds, implied_probability, decimal_odds,
      num_books, consensus_method, is_current, fetched_at
    ) VALUES (
      'match', ${marketType}, ${matchId}, ${selectionLabel}, ${selectionValue},
      ${americanOdds}, ${impliedPct}, ${decimalOdds},
      ${sourceBooksCount}, 'median', true, now()
    )
  `;
}

// upsertTotalsOdds(matchId, totals) — totals = parseTotals() output. Two rows
// per line (over/under), selection_value = the line ('2.5').
export async function upsertTotalsOdds(matchId, totals) {
  if (!Array.isArray(totals) || totals.length === 0) return { written: 0 };
  let written = 0;
  for (const t of totals) {
    for (const side of ['over', 'under']) {
      const s = t[side];
      await upsertSecondaryMarket({
        matchId, marketType: 'total', selectionLabel: side, selectionValue: t.line,
        americanOdds: s.american, impliedPct: round2(s.implied),
        decimalOdds: round2(s.decimal), sourceBooksCount: s.books,
      });
      written += 1;
    }
  }
  return { written };
}

// upsertScorerOdds(matchId, scorers) — scorers = parseScorers() output. One row
// per player, selection_label = the player-name string (no player_id link).
export async function upsertScorerOdds(matchId, scorers) {
  if (!Array.isArray(scorers) || scorers.length === 0) return { written: 0 };
  let written = 0;
  for (const p of scorers) {
    await upsertSecondaryMarket({
      matchId, marketType: 'anytime_scorer', selectionLabel: p.player, selectionValue: null,
      americanOdds: p.american, impliedPct: round2(p.implied),
      decimalOdds: round2(p.decimal), sourceBooksCount: p.books,
    });
    written += 1;
  }
  return { written };
}
