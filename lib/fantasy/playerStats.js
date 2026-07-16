// lib/fantasy/playerStats.js - the ONE interface the draft room reads player
// season stats through. Lives in lib/fantasy/ with the rest of the sim server
// code (drafts / engine / grade / ffc / readWriter), not a second lib/sim/ dir.
//
// ============================================================================
// WHY THIS RETURNS null TODAY (recon, DEV, 2026-07-16)
// ============================================================================
// There is no NFL stat data in DEV, and no schema that could hold it:
//   · `players` is the SOCCER identity table (preferred_foot, international_caps,
//     club_name). It contains ZERO NFL players - the 400 rows whose position
//     reads 'DEF' are soccer DEFENDERS, not team defenses.
//   · `player_match_stats` is 0 rows AND soccer-shaped (goals/xg/tackles/saves).
//     No passing/rushing/receiving column exists anywhere in the database.
//   · `sim_player_pool.matched_player_id` - the future join from FFC's pool to
//     the editorial players table - is NULL on all 717 rows.
//   · 2025 NFL SCHEDULE rows do exist (285 matches, league_id 62, season_year
//     2025) from migration 044, but they carry no player box scores.
//
// So the room keys on ffcPlayerId: it is the only player identity the ADP pool
// has. Returning null is the honest answer, and the room renders a dim "stats
// land with the data backfill" state rather than inventing numbers.
//
// TODO(gridiron 2025 backfill session): when the NFL player + box-score ingestion
// lands (BDL via lib/gridiron/sync.js - note BDL_API_KEY is NOT in .env.local
// today, so no tier is wired yet), implement this function HERE and nothing in
// the room changes. The work is:
//   1. backfill NFL players into `players` (or a gridiron player table) and a
//      per-game stat table with real football columns;
//   2. populate sim_player_pool.matched_player_id (FFC name/team -> player id);
//   3. resolve ffcPlayerId -> matched_player_id -> season totals + game log and
//      return the SeasonStats shape below.
// This module is the single seam for that session. Do not scatter stat reads.
//
// ============================================================================
// SeasonStats shape (what the UI renders; the fixture mirrors it exactly)
// ============================================================================
//   {
//     season:  2025,
//     source:  'db' | 'fixture',
//     totals:  [{ label: 'PASS YDS', value: '4306' }, ...]   // position-appropriate
//     columns: ['OPP', 'CMP/ATT', 'YDS', 'TD', 'INT'],       // game-log headers
//     games:   [{ week: 1, values: ['@BAL', '22/34', '291', '2', '1'] }, ...]
//   }
// Returning null means "no stats known for this player" - NOT "zero stats".

/**
 * Season stats for one player of the sim's ADP pool, keyed by FFC player id.
 * @param {string} ffcPlayerId
 * @returns {Promise<null|object>} SeasonStats, or null when unknown (always, today).
 */
export async function getPlayerSeasonStats(ffcPlayerId) {
  // No NFL stat rows and no NFL stat schema in DEV - see the header block. This
  // is deliberately null, never fabricated: the room has an honest empty state.
  return null;
}
