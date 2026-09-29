// lib/gridiron/openingLine.js - THE OPENING SPREAD per match (scores-v4, ruling b).
//
// The earliest spread snapshot odds_markets holds for a match, oriented to the
// home side exactly as getSpreadHome orients the current one (same scope, same
// pinned fetcher, same shapeSpreadRows) - so "DEN -3.5 · opened -2.5" compares
// two numbers from one pipeline, never two pipelines.
//
// PER SLATE, BY MATCH ID. odds_markets keeps every hourly snapshot (1.49M rows
// on PROD, 29 Sep). Its only match_id index was partial on is_current, so a
// read of history was a sequential scan (2.2 s for 132 matches) - which is why
// the first version read every match at once and cached it for an hour.
// migrations/117 adds (match_id, fetched_at): the earliest snapshot of each
// slate match is now an index range, so the read is scoped to the ids on the
// page and cached for five minutes (openingCache.js). An opening line never
// changes once written; the short cache only lets a newly priced match show
// its "opened" quickly.
import { sql as defaultSql } from '../db.js';
import { shapeSpreadRows } from './oddsReader.js';

const SPREAD_FETCHER = 'odds-api-v4';

/** Map(matchId -> opening home-based spread) for the given matches. */
export async function openingSpreads(matchIds, { db = defaultSql } = {}) {
  const ids = [...new Set((matchIds ?? []).filter((x) => x != null))].sort((a, b) => a - b);
  if (!ids.length) return new Map();
  // ONE INDEX PROBE PER MATCH (LATERAL ... LIMIT 1), not a DISTINCT ON over
  // the slate's history. Measured on PROD after 117, 201 slate matches: the
  // DISTINCT ON form still planned a parallel seq scan (1,654 ms - the slate's
  // history is ~143k rows); this form reads each match's snapshots in
  // fetched_at order and stops at the first spread row: 2.5 ms, same 137
  // answers.
  const rows = await db`
    SELECT x.match_id, x.selection_label, x.selection_value,
           h.name AS home_name, a.name AS away_name
      FROM unnest(${ids}::int[]) AS mid(id)
      CROSS JOIN LATERAL (
        SELECT o.match_id, o.selection_label, o.selection_value
          FROM odds_markets o
         WHERE o.match_id = mid.id
           AND o.market_scope = 'match'
           AND o.market_type = 'spread'
           AND o.fetcher_version = ${SPREAD_FETCHER}
           AND o.selection_value IS NOT NULL
         ORDER BY o.fetched_at ASC, o.id ASC
         LIMIT 1
      ) x
      JOIN matches m ON m.id = x.match_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id`;
  return shapeSpreadRows(rows);
}
