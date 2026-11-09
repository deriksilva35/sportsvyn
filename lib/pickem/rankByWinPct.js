// lib/pickem/rankByWinPct.js - "Rank by win %" on the confidence board. PURE, client-safe.
//
// Input rows: { id, locked, confidence, pick: 'home'|'away'|null, winPct: {home, away} | null }.
// Output: { [id]: confidence } for EVERY row.
//
// RULES (pickem-rank):
//  - a LOCKED row keeps its number; the numbers the UNLOCKED rows hold are
//    redistributed among them (the set is preserved), biggest number to the
//    biggest win %;
//  - a row with a pick ranks by the PICKED side's win % (an underdog pick ranks
//    low); an unpicked row ranks by the favourite's (the larger side);
//  - a row with no line (winPct null / non-finite) takes the lowest numbers, in
//    its current order; ties keep the current order (stable).
// It never touches picks.
export function sidePct(winPct, pick) {
  const h = winPct?.home == null ? NaN : Number(winPct.home);
  const a = winPct?.away == null ? NaN : Number(winPct.away);
  const home = Number.isFinite(h) ? h : (Number.isFinite(a) ? 100 - a : NaN);
  if (!Number.isFinite(home)) return null;
  const away = Number.isFinite(a) ? a : 100 - home;
  if (pick === 'home') return home;
  if (pick === 'away') return away;
  return Math.max(home, away);
}

export function rankByWinPct(rows) {
  const out = {};
  const open = [];
  for (const r of rows) {
    if (r.locked) out[r.id] = r.confidence;
    else open.push(r);
  }
  const current = [...open].sort((x, y) => y.confidence - x.confidence);   // biggest number first
  const numbers = current.map((r) => r.confidence);                          // already descending
  const scored = current.map((r) => ({ r, pct: sidePct(r.winPct, r.pick) }));
  const withLine = scored.filter((s) => s.pct != null);
  const noLine = scored.filter((s) => s.pct == null);
  // Array#sort is stable: ties keep current order.
  withLine.sort((x, y) => y.pct - x.pct);
  [...withLine, ...noLine].forEach((s, i) => { out[s.r.id] = numbers[i]; });
  return out;
}
