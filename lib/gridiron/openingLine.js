// lib/gridiron/openingLine.js - THE OPENING SPREAD per match (scores-v4, ruling b).
//
// The earliest spread snapshot odds_markets holds for a match, oriented to the
// home side exactly as getSpreadHome orients the current one (same scope, same
// pinned fetcher, same shapeSpreadRows) - so "DEN -3.5 · opened -2.5" compares
// two numbers from one pipeline, never two pipelines.
//
// ONE READ FOR EVERY MATCH, NOT PER SLATE. odds_markets keeps every hourly
// snapshot (1.49M rows on PROD, 29 Sep) and has no index on match_id outside
// is_current, so any match-filtered read of history is a sequential scan -
// measured at 2.2 s for 132 matches. The cost is the same for one match or
// seven hundred, so this reads them all once and the page caches the map
// (lib/gridiron/openingCache.js). An opening line never changes after it is
// written, which is what makes a long cache honest.
import { sql as defaultSql } from '../db.js';
import { shapeSpreadRows } from './oddsReader.js';

const SPREAD_FETCHER = 'odds-api-v4';

/** Map(matchId -> opening home-based spread), for every match with history. */
export async function openingSpreads({ db = defaultSql } = {}) {
  const rows = await db`
    SELECT DISTINCT ON (o.match_id) o.match_id, o.selection_label, o.selection_value,
           h.name AS home_name, a.name AS away_name
      FROM odds_markets o
      JOIN matches m ON m.id = o.match_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE o.market_scope = 'match'
       AND o.market_type = 'spread'
       AND o.fetcher_version = ${SPREAD_FETCHER}
       AND o.selection_value IS NOT NULL
     ORDER BY o.match_id, o.fetched_at ASC, o.id ASC`;
  return shapeSpreadRows(rows);
}
