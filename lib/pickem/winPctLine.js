// lib/pickem/winPctLine.js - the Pick'em row's win % line. PURE and client-safe.
//
// WIN % REPLACES THE SPREAD on the time line (wed-1): "PACKERS 64%", the
// favourite's display name and its de-vigged moneyline chance to win
// (homeWinPct in lib/pickem/view.js, from getH2hOdds for the football leagues
// and from the feed's moneylines for the NBA, lib/pickem/nbaFeed.js).
//
// NOTHING IS INVENTED, and the spread is never a fallback: no moneyline
// (home_win_pct null) is no line at all.
//
// EXACTLY 50% SHOWS NOTHING. A coin flip names no favourite, and a "64%" style
// line that said "HOME 50%" would pick a side for the reader. The same rule the
// board already followed.
//
// Callers gate on the game being pre-lock; this function only reads the wire.
export function winPctLine(g) {
  const h = g?.home_win_pct;
  if (h == null || !Number.isFinite(Number(h))) return null;
  const home = Number(h);
  if (home === 50) return null;
  const homeFav = home > 50;
  return { name: homeFav ? g.home : g.away, pct: Math.max(home, 100 - home) };
}

export function winPctText(g) {
  const l = winPctLine(g);
  return l ? `${l.name} ${l.pct}%` : null;
}
