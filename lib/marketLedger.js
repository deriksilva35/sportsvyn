// lib/marketLedger.js — The Ledger: freeze tags at kickoff, grade at the
// whistle, and read the public grade sheet. Powers the /market Ledger section.
//
// FREEZE: when a tagged match goes live (status live|final), snapshot every
// non-fair 1X2 selection (generous | rich | wide) with its CLOSING price
// (is_current odds — refresh-odds excludes live matches, so the current row IS
// the close), de-vigged implied %, model %, gap, tag, and the team-power
// edition_number (model provenance). Idempotent via the UNIQUE index
// (ON CONFLICT DO NOTHING) + a NOT EXISTS match guard, so it is a safe
// every-minute sweep and self-heals a missed kickoff tick (catch-up).
//
// GRADE: when a match is final, record regulation_result from the AUTHORITATIVE
// 90-minute score (API-Sports score.fulltime — matches.home_score/away_score
// hold the AFTER-ET score per lib/syncFixture.js, so they cannot be trusted for
// a 90-minute market). A tag HIT is unified by gap direction:
//   gap > 0 (generous, or wide-positive) hits when the selection HIT;
//   gap < 0 (rich,     or wide-negative) hits when the selection MISSED.
// wide is graded but EXCLUDED from public stats.

import { sql } from './db.js';
import { apiSports } from './apiSports.js';
import { getTopN, getCurrentEdition } from './rankings.js';
import { computeMatchProbabilities, computeTotalsProbabilities, evaluatePrice } from './matchProbability.js';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

// ============================================================================
// FREEZE + GRADE sweep — called from poll-live each minute.
// ============================================================================
export async function freezeAndGradeLedger({ leagueSlug = WC_LEAGUE_SLUG } = {}) {
  const frozen = await freezeSweep(leagueSlug);
  const graded = await gradeSweep(leagueSlug);
  return { frozen, graded };
}

async function freezeSweep(leagueSlug) {
  // Ratings + edition provenance (current team-power edition).
  const [rankRows, edition] = await Promise.all([
    getTopN({ listSlug: 'team-power', leagueSlug, limit: 48 }),
    getCurrentEdition({ listSlug: 'team-power', leagueSlug }),
  ]);
  const ratingByTeam = new Map(rankRows.map((r) => [r.team_id, r.score]));
  const editionNumber = edition?.edition_number ?? null;

  // Live/final matches with a closing 1X2 line. Idempotency is per-row via the
  // UNIQUE (match_id, market_type, selection_label) + ON CONFLICT DO NOTHING, so
  // match_winner and totals freeze independently (no match-level guard).
  const rows = await sql`
    SELECT
      m.id AS match_id, m.kickoff_at, m.home_team_id, m.away_team_id,
      o.selection_label,
      o.implied_probability::float AS market_pct,
      o.american_odds,
      o.decimal_odds::float AS decimal_odds
    FROM matches m
    JOIN leagues lg ON lg.id = m.league_id
    JOIN odds_markets o
      ON o.match_id = m.id AND o.is_current = true
     AND o.market_scope = 'match' AND o.market_type = 'match_winner'
    WHERE lg.slug = ${leagueSlug}
      AND m.status IN ('live', 'final')
    ORDER BY m.id
  `;

  // Group by match so we compute the model once per fixture.
  const byMatch = new Map();
  for (const r of rows) {
    if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, { info: r, sels: [] });
    byMatch.get(r.match_id).sels.push(r);
  }

  let frozen = 0;
  for (const { info, sels } of byMatch.values()) {
    const model = computeMatchProbabilities(
      ratingByTeam.get(info.home_team_id),
      ratingByTeam.get(info.away_team_id),
    );
    if (!model) continue; // no rating -> cannot tag; leave unfrozen
    for (const s of sels) {
      const modelPct = s.selection_label === 'home' ? model.home
        : s.selection_label === 'away' ? model.away
          : model.draw;
      const { gap, tag } = evaluatePrice(modelPct, s.market_pct);
      if (tag === 'fair') continue; // fair is not tracked
      const res = await sql`
        INSERT INTO market_tag_ledger (
          match_id, market_type, selection_label,
          price_american, price_decimal, implied_pct, model_pct, gap, tag,
          edition_number, kickoff_at
        ) VALUES (
          ${info.match_id}, 'match_winner', ${s.selection_label},
          ${s.american_odds}, ${s.decimal_odds}, ${round2(s.market_pct)},
          ${round2(modelPct)}, ${round2(gap)}, ${tag},
          ${editionNumber}, ${info.kickoff_at}
        )
        ON CONFLICT (match_id, market_type, selection_label) DO NOTHING
        RETURNING id
      `;
      if (res.length) frozen += 1;
    }
  }

  // Totals tail-line tags (1.5 / 3.5 only — the calibrated lines). The line is
  // encoded in selection_label ('over_1.5') because the ledger UNIQUE has no
  // selection_value column, so 'over_1.5' and 'over_3.5' stay distinct rows.
  const totalRows = await sql`
    SELECT
      m.id AS match_id, m.kickoff_at, m.home_team_id, m.away_team_id,
      o.selection_label, o.selection_value AS line,
      o.implied_probability::float AS market_pct,
      o.american_odds, o.decimal_odds::float AS decimal_odds
    FROM matches m
    JOIN leagues lg ON lg.id = m.league_id
    JOIN odds_markets o
      ON o.match_id = m.id AND o.is_current = true
     AND o.market_scope = 'match' AND o.market_type = 'total'
     AND o.selection_value IN ('1.5', '3.5')
    WHERE lg.slug = ${leagueSlug} AND m.status IN ('live', 'final')
    ORDER BY m.id
  `;
  const totByKey = new Map();
  for (const r of totalRows) {
    const key = `${r.match_id}|${r.line}`;
    if (!totByKey.has(key)) totByKey.set(key, { info: r });
    totByKey.get(key)[r.selection_label] = r;
  }
  for (const pair of totByKey.values()) {
    if (!pair.over || !pair.under) continue;
    const model = computeTotalsProbabilities(
      ratingByTeam.get(pair.info.home_team_id),
      ratingByTeam.get(pair.info.away_team_id),
      Number(pair.info.line),
    );
    if (!model) continue;
    for (const side of ['over', 'under']) {
      const s = pair[side];
      const modelPct = side === 'over' ? model.over : model.under;
      const { gap, tag } = evaluatePrice(modelPct, s.market_pct);
      if (tag === 'fair') continue;
      const res = await sql`
        INSERT INTO market_tag_ledger (
          match_id, market_type, selection_label,
          price_american, price_decimal, implied_pct, model_pct, gap, tag,
          edition_number, kickoff_at
        ) VALUES (
          ${pair.info.match_id}, 'total_goals', ${`${side}_${pair.info.line}`},
          ${s.american_odds}, ${s.decimal_odds}, ${round2(s.market_pct)},
          ${round2(modelPct)}, ${round2(gap)}, ${tag},
          ${editionNumber}, ${pair.info.kickoff_at}
        )
        ON CONFLICT (match_id, market_type, selection_label) DO NOTHING
        RETURNING id
      `;
      if (res.length) frozen += 1;
    }
  }

  return frozen;
}

async function gradeSweep(leagueSlug) {
  // Matches that are final with at least one ungraded frozen row.
  const pending = await sql`
    SELECT DISTINCT m.id AS match_id, m.external_ids->>'api_sports' AS api
    FROM market_tag_ledger l
    JOIN matches m ON m.id = l.match_id
    JOIN leagues lg ON lg.id = m.league_id
    WHERE lg.slug = ${leagueSlug}
      AND m.status = 'final'
      AND l.result IS NULL
  `;

  let graded = 0;
  for (const p of pending) {
    const apiId = Number(p.api);
    if (!Number.isInteger(apiId) || apiId <= 0) continue;
    // Authoritative 90-minute result (NOT the stored after-ET score).
    let ft;
    try {
      const resp = await apiSports.fixture(apiId);
      ft = (resp || [])[0]?.score?.fulltime;
    } catch {
      continue; // transient API error -> retry next sweep
    }
    if (!ft || ft.home == null || ft.away == null) continue;
    const regulationResult = ft.home > ft.away ? 'home' : ft.home < ft.away ? 'away' : 'draw';
    const totalGoals = ft.home + ft.away;

    // Grade every ungraded row for this match.
    const rows = await sql`
      SELECT id, market_type, selection_label, gap
      FROM market_tag_ledger
      WHERE match_id = ${p.match_id} AND result IS NULL
    `;
    for (const r of rows) {
      let result;
      let regResult = null;
      if (r.market_type === 'total_goals') {
        // selection_label = 'over_1.5' | 'under_3.5'. .5 lines -> no push.
        const [side, lineStr] = r.selection_label.split('_');
        const line = Number(lineStr);
        const hit = side === 'over' ? totalGoals > line : totalGoals < line;
        result = hit ? 'hit' : 'miss';
      } else {
        // match_winner: hit unified by gap direction. gap>0 (generous /
        // wide-positive) -> hit on HIT; gap<0 (rich / wide-negative) -> on MISS.
        const selectionHit = r.selection_label === regulationResult;
        result = ((Number(r.gap) > 0) === selectionHit) ? 'hit' : 'miss';
        regResult = regulationResult;
      }
      const upd = await sql`
        UPDATE market_tag_ledger
           SET regulation_result = ${regResult}, result = ${result}, graded_at = now()
         WHERE id = ${r.id} AND result IS NULL
        RETURNING id
      `;
      if (upd.length) graded += 1;
    }
  }
  return graded;
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// ============================================================================
// READER — the public grade sheet. wide is EXCLUDED (generous/rich only).
// ============================================================================
export async function getLedger({ leagueSlug = WC_LEAGUE_SLUG } = {}) {
  const rows = await sql`
    SELECT
      l.match_id, l.market_type, l.selection_label,
      l.price_american, l.implied_pct::float AS implied_pct,
      l.model_pct::float AS model_pct, l.gap::float AS gap, l.tag,
      l.kickoff_at, l.regulation_result, l.result,
      m.slug, m.stage,
      ht.abbreviation AS home_abbr, ht.name AS home_name,
      at.abbreviation AS away_abbr, at.name AS away_name
    FROM market_tag_ledger l
    JOIN matches m ON m.id = l.match_id
    JOIN teams ht ON ht.id = m.home_team_id
    JOIN teams at ON at.id = m.away_team_id
    WHERE l.tag IN ('generous', 'rich')
    ORDER BY l.kickoff_at DESC NULLS LAST, l.match_id DESC, l.selection_label
  `;

  const tagged = rows.length;
  const graded = rows.filter((r) => r.result != null);
  const landed = graded.filter((r) => r.result === 'hit').length;
  // "What the prices implied": market's own expected hit rate for these bets --
  // implied% for a generous bet (backing the selection), 100-implied% for a
  // rich bet (fading it). Averaged over all tagged rows.
  const impliedExpectation = tagged
    ? rows.reduce((s, r) => s + (r.tag === 'generous' ? r.implied_pct : 100 - r.implied_pct), 0) / tagged
    : null;

  return {
    stats: {
      tagged,
      graded: graded.length,
      landed,
      hit_rate_pct: graded.length ? Math.round((landed / graded.length) * 100) : null,
      implied_expectation_pct: impliedExpectation != null ? Math.round(impliedExpectation) : null,
    },
    rows,
  };
}
