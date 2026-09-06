// lib/pickem/recordLine.js - the Pick'em row's rank+record small line. PURE.
//
// RECORDS ON THE ROW (relay 2c item 4): rank folded into the line as text
// ("#12 · 3-0") rather than a second visual badge beside the name. A rank
// with no record (the common case - most teams are unranked) still shows
// the record alone; a record with no rank shows without the '#'.
//
// '0-0' vs '-' IS THE ROW'S OWN ABSENCE, NOT THIS FUNCTION'S (relay 2c-fix
// item 2): recordMapFor() (lib/pickem/entry.js) now passes through a real
// team_records row even at 0-0 - the row EXISTING is the fact worth
// showing, before that team's first game as much as after it. `record`
// only arrives falsy here when recordMapFor() found no row for that team
// AT ALL, which is the one case this function renders as '-' - never "#12 ·
// -", which would claim a record exists when none does.
export function recordLine(rank, record) {
  if (!record) return '-';
  return rank != null ? `#${rank} · ${record}` : record;
}
