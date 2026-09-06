// lib/pickem/recordLine.js - the Pick'em row's rank+record small line. PURE.
//
// RECORDS ON THE ROW (relay 2c item 4): rank folded into the line as text
// ("#12 · 3-0") rather than a second visual badge beside the name. An
// absent record renders a bare '-' and nothing else - not "#12 · -", which
// would claim a record exists at all. A rank with no record (the common
// case - most teams are unranked) still shows the record alone; a record
// with no rank shows without the '#'.
export function recordLine(rank, record) {
  if (!record) return '-';
  return rank != null ? `#${rank} · ${record}` : record;
}
