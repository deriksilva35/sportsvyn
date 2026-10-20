// lib/daily/cardLine.js - THE ONE FORMATTER for a Daily player's stat line (tue-2).
//
// "3224 yds · 25 TD" -> "3,224 yds · 25 TD · 19.2/wk". PURE (no db, no clock), so
// the result screen, the Results page and the morning email print the same line.
// Games played and a kicker's XP are stored on each daily_boards.best_roster entry
// and board card player (lib/daily/boardShape.js); when `games` is missing the line
// simply has no /wk, and a kicker without `xp` has no XP - never a guessed 17.

/** meta: the season line (metaFor); p: { position, points, games, xp }. -> string | null */
export function cardLine(meta, { position = null, points = null, games = null, xp = null } = {}) {
  const t = String(meta ?? '').trim();
  const bits = t ? [t.replace(/\d{4,}/g, (d) => Number(d).toLocaleString('en-US'))] : [];
  // A KICKER'S XP only when the source row has it.
  if (position === 'PK' && xp != null && bits.length) bits.push(`${Number(xp)} XP`);
  // THE WEEKLY AVERAGE: season points / games played, 1 decimal.
  const g = Number(games);
  if (points != null && games != null && Number.isFinite(g) && g > 0) bits.push(`${(Number(points) / g).toFixed(1)}/wk`);
  return bits.length ? bits.join(' · ') : null;
}
