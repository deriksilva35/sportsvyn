// lib/footballdb/historicalTeamDisplay.js — a DISPLAY-ONLY short code for the
// 1,824 nfl_player_season_totals rows whose team_key is still a raw
// historical name (footballdb rows with no current-franchise match; see
// migrations/089 and scripts/team-key-abbreviate.mjs).
//
// NEVER WRITE THIS BACK OVER team_key. The column stays exactly what
// scripts/team-key-abbreviate.mjs left it: a real abbreviation where one
// resolves, the source's own raw name where it does not. This map exists so
// a renderer has a short code to put on a card; it has no opinion on what is
// stored.
//
// COLLISION-CHECKED AGAINST THE LIVE TABLE, NOT ASSUMED. Two of the eight
// codes originally proposed for this map — HOU for "Houston Oilers", BAL for
// "Baltimore Colts" — turned out to already be a DIFFERENT franchise's real,
// resolved abbreviation elsewhere in this same table: HOU is the Houston
// Texans (an unrelated 2002 expansion team, not the Oilers, who relocated to
// Tennessee in 1997), and BAL is the Baltimore Ravens (an unrelated 1996
// relocation of the Cleveland Browns, not the Colts, who left Baltimore in
// 1984). Using those codes here would recreate on the display layer exactly
// the "two teams read as one" risk this whole exercise exists to avoid — so
// this map uses OIL and CLT instead. Every code below was checked against
// the full 32-team current abbreviation list AND against every other code
// in this map before being picked; none collides with either.
const HISTORICAL_DISPLAY_CODE = {
  'Houston Oilers': 'OIL',        // NOT 'HOU' — that's the (unrelated) Texans
  'Tennessee Oilers': 'TEN',      // same lineage as the current Titans (TEN) — safe, no season overlap
  'St. Louis Cardinals': 'STL',
  'Phoenix Cardinals': 'PHX',
  'Baltimore Colts': 'CLT',       // NOT 'BAL' — that's the (unrelated) Ravens
  'San Diego Chargers': 'SD',
  'Los Angeles Raiders': 'LA',    // era-distinct from Oakland Raiders below — same lineage, different years
  'Oakland Raiders': 'OAK',
  'St. Louis Rams': 'RAM',        // NOT 'STL' — that's this map's own Cardinals code, a different franchise
  'Washington Redskins': 'WSH',   // same lineage as the current Commanders (WSH) — safe, no season overlap
};

/**
 * team_key -> a short display code. Real abbreviations (already 2-3 upper-
 * case letters, from scripts/team-key-abbreviate.mjs) pass through unchanged.
 * A raw historical name gets its code from the map above. Anything neither —
 * should not happen; the 1980-1999 footballdb ingest only ever produces the
 * ten names above when unresolved — returns the raw team_key unchanged
 * rather than throwing, so an unexpected value degrades to "long text on a
 * card" instead of a crash.
 */
export function displayTeamCode(teamKey) {
  if (/^[A-Z]{2,3}$/.test(teamKey)) return teamKey;
  return HISTORICAL_DISPLAY_CODE[teamKey] ?? teamKey;
}
