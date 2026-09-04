// lib/footballdb/teamKey.js — the ONE canonical form of a footballdb
// team_key (ruling).
//
// EXACTLY ONE FORM, PRODUCED BY ONE FUNCTION. Before this, two different
// writers each had their own idea of team_key's shape: scripts/footballdb-
// import.mjs always wrote the raw workbook name, while scripts/team-key-
// abbreviate.mjs UPDATED an existing row's team_key to an abbreviation
// afterward, keyed by row id. Every subsequent full re-ingest then tried an
// INSERT ... ON CONFLICT (nfl_player_id, season_year, team_key) against the
// RAW name again - a conflict-key MISS against the now-abbreviated existing
// row - creating a genuine duplicate every time. Measured: 8,390 same-team
// duplicate pairs on DEV before this fix. canonicalTeamKey() is now the ONLY
// place a team_key value is decided, called by the ingest BEFORE the
// conflict key is built, so a re-run always computes the identical key a
// prior run already wrote - true idempotence, not two builders drifting.
//
// CANONICAL FORM: the current-franchise abbreviation when a resolver can
// find one, otherwise the raw era name UNCHANGED. Houston Oilers, Baltimore
// Colts, and the other pre-current-franchise names stay literal - there is
// no current teams row to resolve them against, and inventing one would be
// exactly the lineage-table guess migrations/089 already refused. DISPLAY
// (lib/footballdb/historicalTeamDisplay.js's displayTeamCode()) is a
// SEPARATE concern - it turns a raw era name into a short code for a card,
// at READ time; canonicalTeamKey() decides what gets STORED, at WRITE time.
// A name already in historicalTeamDisplay's map still comes back raw from
// this function - the two modules do not share logic, on purpose.

/**
 * @param name        the raw team name as parsed from the source (or
 *                     already-canonical, e.g. re-running against a row this
 *                     function already touched).
 * @param resolver     (name: string) => abbreviation | null|undefined - the
 *                     caller's own case-insensitive name -> teams.abbreviation
 *                     lookup. Injected so this file stays PURE and testable
 *                     without a DB.
 * @returns the canonical team_key: an existing 2-3 letter abbreviation
 *          unchanged (no-op - the resolver is never even called), the
 *          resolver's match if one exists, or the raw name unchanged if not.
 */
export function canonicalTeamKey(name, resolver) {
  if (/^[A-Z]{2,3}$/.test(name)) return name;
  const abbr = resolver(name);
  return abbr ?? name;
}
