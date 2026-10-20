// lib/daily/backfillGames.js - add games (and a kicker's XP) to a stored board. PURE.
//
// Used by scripts/daily-backfill-games.mjs. A board's best_roster entries and its
// card players are matched to the season's source rows (nfl_player_season_totals)
// on season_year + raw_name + team_key + position; EXACTLY ONE match gives the
// values, anything else leaves the entry as it was (no games, so no /wk).
//
// best_roster is a jsonb ARRAY: whole entries are rewritten here and the whole
// array is written back - never `||` an object onto it (CLAUDE.md, jsonb rule).

import { shapeBestRoster, extrasOf } from './boardShape.js';

/** Index source rows by name|team|position -> [rows]. */
export function indexSource(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.raw_name}|${r.team_key}|${r.position}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function find(idx, name, teamKey, position) {
  const hits = idx.get(`${name}|${teamKey}|${position}`) ?? [];
  return hits.length === 1 ? hits[0] : null;
}

/**
 * @param board { best_roster, board } as stored
 * @param idx   indexSource(rows of board.season_year)
 * @returns { best_roster, board, changed, entries, withGames, cards, cardsWithGames }
 */
export function backfillBoard(board, idx) {
  let withGames = 0;
  const best = shapeBestRoster(board.best_roster ?? []).map((e) => {
    const hit = find(idx, e.name, e.teamKey, e.position);
    if (hit) { const x = extrasOf(hit); if (x.games != null) withGames += 1; return { ...e, ...x }; }
    if (e.games != null) withGames += 1;
    return e;
  });
  let cards = 0;
  let cardsWithGames = 0;
  const teams = (board.board ?? []).map((t) => ({
    ...t,
    card: (t.card ?? []).map((p) => {
      cards += 1;
      const hit = find(idx, p.name, t.key, p.position);
      if (hit) { const x = extrasOf(hit); if (x.games != null) cardsWithGames += 1; return { ...p, ...x }; }
      if (p.games != null) cardsWithGames += 1;
      return p;
    }),
  }));
  const changed = JSON.stringify(best) !== JSON.stringify(board.best_roster) || JSON.stringify(teams) !== JSON.stringify(board.board);
  return { best_roster: best, board: teams, changed, entries: best.length, withGames, cards, cardsWithGames };
}
