// lib/matchProbability.js — independent pre-match win probability (Davidson)
// plus the /market model-vs-market board reader.
//
// PURE layer (no I/O): computeMatchProbabilities + evaluatePrice. The
// constants are LOCKED by the Davidson three-outcome fit over 95 completed
// WC matches (2026-07-07): k and nu only, NO host term (host was not
// identified in the fit — sign-unstable on 14 host matches, so it is dropped).
//
// This number is PRICE-INDEPENDENT by construction: it is computed from
// Sportsvyn's own team-power ratings, never from the odds. That is the whole
// point — it is compared AGAINST the de-vigged market number on the board.
//
// I/O layer (getModelBoard): joins scheduled-match consensus odds
// (odds_markets, is_current match_winner) to the current team-power edition
// ratings, computes the model %, and tags each selection. Read-only.

import { sql } from './db.js';
import { getTopN } from './rankings.js';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

// Davidson fit — 95 matches, 2026-07-07. No host term.
export const MODEL_PARAMS = { k: 0.499, nu: 1.153 };

// Tag bands, in points of (model% − market%). Locked with the fit.
export const FAIR_BAND = 3.5;          // |gap| < 3.5            -> fair
export const WIDE_BAND = 8;            // |gap| > 8              -> wide
export const GENEROUS_GUARD_PCT = 80;  // never 'generous' above this model%

// ============================================================================
// PURE — no I/O
// ============================================================================

// computeMatchProbabilities(homeRating, awayRating[, params])
// Davidson three-outcome: strength pi_i = 10^(k * rating_i);
//   P(home) = pi_h / D, P(away) = pi_a / D,
//   P(draw) = nu * sqrt(pi_h * pi_a) / D,  D = pi_h + pi_a + nu*sqrt(pi_h*pi_a).
// Returns { home, draw, away } as PERCENTAGES (0-100), or null when a rating
// is missing. Evaluated in log10 space so large strengths never overflow.
export function computeMatchProbabilities(homeRating, awayRating, params = MODEL_PARAMS) {
  if (!Number.isFinite(homeRating) || !Number.isFinite(awayRating)) return null;
  const { k, nu } = params;
  const sH = k * homeRating;                    // log10 strength, home
  const sA = k * awayRating;                    // log10 strength, away
  const sD = Math.log10(nu) + 0.5 * (sH + sA);  // log10 draw term
  const M = Math.max(sH, sA, sD);
  const eH = 10 ** (sH - M);
  const eA = 10 ** (sA - M);
  const eD = 10 ** (sD - M);
  const Z = eH + eA + eD;
  return { home: (eH / Z) * 100, draw: (eD / Z) * 100, away: (eA / Z) * 100 };
}

// evaluatePrice(modelPct, marketPct) -> { gap, tag }
// gap = model - market (model side positive). Locked bands:
//   |gap| < 3.5        -> 'fair'
//   3.5 <= |gap| <= 8  -> 'generous' (gap>0) | 'rich' (gap<0)
//   |gap| > 8          -> 'wide' (model-market disagreement, disclosed as NOT
//                          value — at that distance the model is more often
//                          the limitation than the price).
// GUARD: never 'generous' when modelPct > 80 (calibration unproven above 80)
// -> downgrade to 'fair'. The guard does not touch 'wide' — a wide row is a
// disagreement disclosure, not a value claim, so it stands.
export function evaluatePrice(modelPct, marketPct) {
  const gap = modelPct - marketPct;
  const mag = Math.abs(gap);
  let tag;
  if (mag < FAIR_BAND) tag = 'fair';
  else if (mag <= WIDE_BAND) tag = gap > 0 ? 'generous' : 'rich';
  else tag = 'wide';
  if (tag === 'generous' && modelPct > GENEROUS_GUARD_PCT) tag = 'fair';
  return { gap, tag };
}

// Poisson fit for total goals, 97 matches, 2026-07-08. Walk-forward CALIBRATED
// at the TAIL lines (over/under 1.5 and 3.5); the main line is no-skill (~0.25
// Brier, degrades out-of-sample) — see the totals projection. Tags therefore
// ship only on 1.5 and 3.5; the main line stays market information.
export const TOTALS_PARAMS = { mu: 0.249, beta: 0.237 };

function poissonCDF(k, lambda) {
  // P(X <= k) for X ~ Poisson(lambda). Iterative, no factorial overflow.
  let p = Math.exp(-lambda);
  let sum = p;
  for (let i = 1; i <= k; i++) { p *= lambda / i; sum += p; }
  return sum;
}

// computeTotalsProbabilities(homeRating, awayRating, line[, params])
// Team goals ~ independent Poisson; total ~ Poisson(lambda_h + lambda_a) with
// lambda_i = exp(mu + beta*(r_i - r_j)). Returns { over, under } as PERCENTAGES
// for the given .5 line (over = P(total > line) = P(total >= floor(line)+1)),
// or null if a rating is missing.
export function computeTotalsProbabilities(homeRating, awayRating, line, params = TOTALS_PARAMS) {
  if (!Number.isFinite(homeRating) || !Number.isFinite(awayRating)) return null;
  const { mu, beta } = params;
  const lambda = Math.exp(mu + beta * (homeRating - awayRating))
    + Math.exp(mu + beta * (awayRating - homeRating));
  const over = (1 - poissonCDF(Math.floor(line), lambda)) * 100;
  return { over, under: 100 - over };
}

// ============================================================================
// I/O — the board reader
// ============================================================================

const SELECTION_ORDER = { home: 0, away: 1, draw: 2 };

// getModelBoard({ leagueSlug }) -> flat array of selection rows for the /market
// board. One row per (scheduled match × priced selection). Each row carries the
// de-vigged market %, the American + decimal price, the model %, the signed gap,
// the tag, and the opening American price (earliest snapshot) for "since open".
// Matches with no is_current match_winner odds never appear (INNER JOIN), and
// matches whose teams lack a current rating are skipped (can't model).
export async function getModelBoard({ leagueSlug = WC_LEAGUE_SLUG } = {}) {
  // Ratings from the current team-power edition, keyed by team_id (same source
  // getTopN uses — is_current + published edition only).
  const rankRows = await getTopN({ listSlug: 'team-power', leagueSlug, limit: 48 });
  const ratingByTeam = new Map(rankRows.map((r) => [r.team_id, r.score]));

  const rows = await sql`
    SELECT
      m.id AS match_id, m.slug, m.kickoff_at, m.stage, m.group_code,
      ht.id AS home_id, ht.abbreviation AS home_abbr, ht.name AS home_name,
      at.id AS away_id, at.abbreviation AS away_abbr, at.name AS away_name,
      o.selection_label,
      o.implied_probability::float AS market_pct,
      o.american_odds,
      o.decimal_odds::float AS decimal_odds,
      o.geofence_blocked,
      (SELECT oo.american_odds
         FROM odds_markets oo
        WHERE oo.match_id = m.id
          AND oo.market_scope = 'match'
          AND oo.market_type = 'match_winner'
          AND oo.selection_label = o.selection_label
        ORDER BY oo.fetched_at ASC
        LIMIT 1) AS open_american
    FROM matches m
    JOIN leagues lg ON lg.id = m.league_id
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    JOIN odds_markets o
      ON o.match_id = m.id
     AND o.is_current = true
     AND o.market_scope = 'match'
     AND o.market_type = 'match_winner'
    WHERE lg.slug = ${leagueSlug}
      AND m.status = 'scheduled'
    ORDER BY m.kickoff_at ASC, m.id ASC
  `;

  const out = [];
  for (const r of rows) {
    // Geofence: dormant today (column is always null). Wire the filter so it's
    // ready — a real impl checks the VIEWER's state; this stub drops a selection
    // that is blocked anywhere. No-op while geofence_blocked stays null/empty.
    if (Array.isArray(r.geofence_blocked) && r.geofence_blocked.length > 0) continue;

    const model = computeMatchProbabilities(
      ratingByTeam.get(r.home_id),
      ratingByTeam.get(r.away_id),
    );
    if (!model) continue; // no current rating for a side -> can't model

    const modelPct =
      r.selection_label === 'home' ? model.home
        : r.selection_label === 'away' ? model.away
          : model.draw;
    const { gap, tag } = evaluatePrice(modelPct, r.market_pct);

    out.push({
      match_id: r.match_id,
      slug: r.slug,
      kickoff_at: r.kickoff_at,
      stage: r.stage,
      group_code: r.group_code,
      home_abbr: r.home_abbr,
      home_name: r.home_name,
      away_abbr: r.away_abbr,
      away_name: r.away_name,
      selection: r.selection_label,
      market_pct: r.market_pct,
      american: r.american_odds,
      decimal: r.decimal_odds,
      open_american: r.open_american,
      model_pct: modelPct,
      gap,
      tag,
    });
  }

  out.sort((a, b) => {
    const ta = new Date(a.kickoff_at).getTime();
    const tb = new Date(b.kickoff_at).getTime();
    if (ta !== tb) return ta - tb;
    if (a.match_id !== b.match_id) return a.match_id - b.match_id;
    return SELECTION_ORDER[a.selection] - SELECTION_ORDER[b.selection];
  });
  return out;
}

// ============================================================================
// MARKET INFO readers (no model, no tag): totals main line + scorer prices.
// ============================================================================

// getTotalsBoard() -> totals rows for The Board:
//   · MAIN line (over% nearest even) per match -> info-only (MARKET chip, dash
//     model/gap). Renders always.
//   · TAIL lines 1.5 and 3.5 (where the Poisson model is walk-forward
//     calibrated) -> the over/under pair renders ONLY when a side carries a
//     non-fair tag; both sides render for context (the mirror is the opposite
//     tag, or fair under the 80% guard). Model % populated.
const TOTALS_TAIL_LINES = new Set(['1.5', '3.5']);
export async function getTotalsBoard({ leagueSlug = WC_LEAGUE_SLUG } = {}) {
  const rankRows = await getTopN({ listSlug: 'team-power', leagueSlug, limit: 48 });
  const ratingByTeam = new Map(rankRows.map((r) => [r.team_id, r.score]));

  const rows = await sql`
    SELECT
      m.id AS match_id, m.slug, m.kickoff_at, m.stage,
      m.home_team_id, m.away_team_id,
      ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
      o.selection_label, o.selection_value AS line,
      o.implied_probability::float AS market_pct,
      o.american_odds, o.decimal_odds::float AS decimal_odds,
      (SELECT oo.american_odds FROM odds_markets oo
        WHERE oo.match_id = m.id AND oo.market_scope = 'match'
          AND oo.market_type = 'total' AND oo.selection_label = o.selection_label
          AND oo.selection_value = o.selection_value
        ORDER BY oo.fetched_at ASC LIMIT 1) AS open_american
    FROM matches m
    JOIN leagues lg ON lg.id = m.league_id
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    JOIN odds_markets o
      ON o.match_id = m.id AND o.is_current = true
     AND o.market_scope = 'match' AND o.market_type = 'total'
    WHERE lg.slug = ${leagueSlug} AND m.status = 'scheduled'
    ORDER BY m.kickoff_at ASC, m.id ASC
  `;

  // Group over/under by (match, line).
  const pairByKey = new Map();
  for (const r of rows) {
    const key = `${r.match_id}|${r.line}`;
    if (!pairByKey.has(key)) pairByKey.set(key, { match_id: r.match_id, line: r.line, meta: r });
    pairByKey.get(key)[r.selection_label] = r;
  }
  const linesByMatch = new Map();
  for (const pair of pairByKey.values()) {
    if (!pair.over || !pair.under) continue;
    if (!linesByMatch.has(pair.match_id)) linesByMatch.set(pair.match_id, []);
    linesByMatch.get(pair.match_id).push(pair);
  }

  const shape = (r, selection, extra = {}) => ({
    match_id: r.match_id, slug: r.slug, kickoff_at: r.kickoff_at, stage: r.stage,
    home_abbr: r.home_abbr, away_abbr: r.away_abbr,
    market_type: 'total', selection, line: r.line,
    market_pct: r.market_pct, american: r.american_odds, decimal: r.decimal_odds,
    open_american: r.open_american, ...extra,
  });

  const out = [];
  for (const pairs of linesByMatch.values()) {
    // Main line = over% nearest even -> info-only.
    let main = null;
    for (const p of pairs) {
      const d = Math.abs(p.over.market_pct - 50);
      if (!main || d < main.d) main = { d, p };
    }
    out.push(shape(main.p.over, 'over', { kind: 'main' }), shape(main.p.under, 'under', { kind: 'main' }));

    // Tail lines (excluding the main line) -> tagged when the model has a read.
    const rH = ratingByTeam.get(main.p.meta.home_team_id);
    const rA = ratingByTeam.get(main.p.meta.away_team_id);
    for (const p of pairs) {
      if (!TOTALS_TAIL_LINES.has(p.line) || p.line === main.p.line) continue;
      const model = computeTotalsProbabilities(rH, rA, Number(p.line));
      if (!model) continue;
      const overEval = evaluatePrice(model.over, p.over.market_pct);
      const underEval = evaluatePrice(model.under, p.under.market_pct);
      if (overEval.tag === 'fair' && underEval.tag === 'fair') continue; // no read
      out.push(
        shape(p.over, 'over', { kind: 'tail', model_pct: model.over, gap: overEval.gap, tag: overEval.tag }),
        shape(p.under, 'under', { kind: 'tail', model_pct: model.under, gap: underEval.gap, tag: underEval.tag }),
      );
    }
  }
  out.sort((a, b) => {
    const ta = new Date(a.kickoff_at).getTime();
    const tb = new Date(b.kickoff_at).getTime();
    if (ta !== tb) return ta - tb;
    if (a.match_id !== b.match_id) return a.match_id - b.match_id;
    if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
    if (a.line !== b.line) return Number(a.line) - Number(b.line);
    return a.selection === 'over' ? -1 : 1;
  });
  return out;
}

// getScorerPrices() -> per scheduled match, the top-N anytime-scorer prices by
// implied. Single-sided AS OFFERED (implied still carries the book margin).
export async function getScorerPrices({ leagueSlug = WC_LEAGUE_SLUG, perMatch = 5 } = {}) {
  const rows = await sql`
    SELECT
      m.id AS match_id, m.slug, m.kickoff_at,
      ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
      o.selection_label AS player,
      o.implied_probability::float AS implied,
      o.american_odds, o.decimal_odds::float AS decimal_odds, o.num_books,
      (SELECT oo.american_odds FROM odds_markets oo
        WHERE oo.match_id = m.id AND oo.market_scope = 'match'
          AND oo.market_type = 'anytime_scorer' AND oo.selection_label = o.selection_label
        ORDER BY oo.fetched_at ASC LIMIT 1) AS open_american
    FROM matches m
    JOIN leagues lg ON lg.id = m.league_id
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    JOIN odds_markets o
      ON o.match_id = m.id AND o.is_current = true
     AND o.market_scope = 'match' AND o.market_type = 'anytime_scorer'
    WHERE lg.slug = ${leagueSlug} AND m.status = 'scheduled'
    ORDER BY m.kickoff_at ASC, m.id ASC, o.implied_probability DESC
  `;
  const byMatch = new Map();
  for (const r of rows) {
    if (!byMatch.has(r.match_id)) {
      byMatch.set(r.match_id, {
        match_id: r.match_id, slug: r.slug, kickoff_at: r.kickoff_at,
        home_abbr: r.home_abbr, away_abbr: r.away_abbr, players: [],
      });
    }
    const g = byMatch.get(r.match_id);
    // Book count for the block label — the most any listed player is priced by
    // (scorer markets are single-book-thin pre-kickoff).
    if (r.num_books != null && r.num_books > (g.num_books ?? 0)) g.num_books = r.num_books;
    if (g.players.length < perMatch) {
      g.players.push({
        player: r.player, implied: r.implied, books: r.num_books,
        american: r.american_odds, decimal: r.decimal_odds, open_american: r.open_american,
      });
    }
  }
  return [...byMatch.values()];
}
