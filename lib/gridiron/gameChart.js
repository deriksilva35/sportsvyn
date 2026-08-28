// lib/gridiron/gameChart.js — the bar math behind the player page's game chart.
//
// SEPARATE FROM THE COMPONENT BECAUSE JSX CANNOT BE TESTED. components/player/
// GameCharts.js cannot be imported by node --test, so logic placed there is
// untestable by construction - the same reason topMovers lives beside
// cardLists rather than inside a panel. The component decides what a bar looks
// like; this decides how tall it is and what it says.

const FLOOR_PX = 2;
const TRACK_PX = 54;

/**
 * "vs BUF" / "at KC" -> "BUF" / "@KC". A bar is 30px wide; the word is spent,
 * the direction is kept, because home and away is information.
 */
export function shortOpp(g) {
  const raw = String(g?.opponent ?? '').trim();
  if (!raw) return '—';
  const m = /^(vs|at)\s+(.*)$/i.exec(raw);
  if (!m) return raw.slice(0, 5);
  return `${m[1].toLowerCase() === 'at' ? '@' : ''}${m[2]}`.slice(0, 6);
}

/**
 * Bars for one stat family, newest first, scaled to the window's own best.
 *
 * A ZERO IS A FLOOR SLIVER, NEVER A GAP. A game in which a player recorded
 * nothing is a fact about that game; a bar of no height would read as a game
 * that did not happen.
 *
 * ABSENT IS DIFFERENT AGAIN. A NULL stat draws NO BAR - the player was not
 * measured for it - and the game keeps its row in the log table below, where
 * it renders as a dash. That is the Number(null) scar: null and 0 are two
 * different claims and this file never conflates them.
 */
export function barsFor(games, col) {
  const rows = (games ?? []).filter((g) => g?.[col.key] != null);
  if (!rows.length) return null;
  const values = rows.map((g) => Number(g[col.key]));
  const max = Math.max(...values, 0);
  return rows.map((g, i) => {
    const v = Number(g[col.key]);
    const h = max > 0 ? Math.max(FLOOR_PX, Math.round((v / max) * TRACK_PX)) : FLOOR_PX;
    return { key: `${g.season}-${g.week}-${i}`, value: v, height: h, opponent: shortOpp(g) };
  });
}
