// lib/pickem/settledGrade.js - the settled Pick'em board's grade rows
// (relay 2b item 4). PURE: takes lib/pickem/view.js's own gameRows() output,
// adds nothing DB-shaped.

/**
 * One row per game YOU PICKED (a no-pick has nothing to grade, so it is left
 * out here the same way a no-pick renders dimmed with no result mark on the
 * living board - lib/pickem/view.js's own gameRows()).
 *
 * verdict: 'right' | 'wrong' | 'push'. A push is a final game with no
 * winner (winnerOf() returns null - a cancellation; CFB has no ties) that
 * you still had a pick sitting on, per the mock's own example.
 */
export function pickemGradeRows(rows) {
  return (rows ?? [])
    .filter((r) => r.my_side != null && r.status === 'final')
    .map((r) => {
      const verdict = r.graded === 'W' ? 'right' : r.graded === 'L' ? 'wrong' : 'push';
      const you = r.my_side === 'home' ? r.home : r.away;
      const hs = Number(r.home_score); const as = Number(r.away_score);
      const winner = hs > as ? r.home : as > hs ? r.away : null;
      return {
        verdict, matchId: r.match_id,
        you, youRank: r.my_side === 'home' ? r.home_rank : r.away_rank,
        winner, winnerScore: winner ? `${r.home} ${hs}-${as} ${r.away}` : null,
        homeScore: hs, awayScore: as,
      };
    });
}

/**
 * "{n} ranked favourites lost, you had {n} of them" - the FAVOURITE is
 * whichever side carries an AP rank (the lower/better number when both are
 * ranked); an upset is that side losing. Board-wide facts (rank and result
 * are nobody's pick), counted once regardless of whether you picked that
 * game at all.
 */
export function fadedFavourites(rows) {
  let faded = 0; let hadThem = 0;
  for (const r of rows ?? []) {
    if (r.status !== 'final' || r.home_score == null || r.away_score == null) continue;
    if (r.home_rank == null && r.away_rank == null) continue;
    const favourite = r.home_rank == null ? 'away'
      : r.away_rank == null ? 'home'
        : (r.home_rank <= r.away_rank ? 'home' : 'away');
    const hs = Number(r.home_score); const as = Number(r.away_score);
    const winner = hs > as ? 'home' : as > hs ? 'away' : null;
    if (winner == null || winner === favourite) continue; // no upset
    faded += 1;
    if (r.my_side === favourite) hadThem += 1;
  }
  return { faded, hadThem };
}

/** {right, wrong, push} over the graded rows. */
export function pickemMathline(rows) {
  const right = rows.filter((r) => r.verdict === 'right').length;
  const wrong = rows.filter((r) => r.verdict === 'wrong').length;
  const push = rows.filter((r) => r.verdict === 'push').length;
  return { right, wrong, push };
}

/** 🟩 right, ⬛ wrong, ⬜ push - one glyph per graded row. */
export function pickemGlyphRow(rows) {
  const GLYPH = { right: '🟩', wrong: '⬛', push: '⬜' };
  return rows.map((r) => GLYPH[r.verdict] ?? '⬛').join('');
}
