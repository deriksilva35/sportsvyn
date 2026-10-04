// lib/pickem/settledGrade.js - the settled Pick'em board's grade rows
// (relay 2b item 4). PURE: takes lib/pickem/view.js's own gameRows() output,
// adds nothing DB-shaped.

/**
 * One row per game YOU PICKED (a no-pick has nothing to grade, so it is left
 * out here the same way a no-pick renders dimmed with no result mark on the
 * living board - lib/pickem/view.js's own gameRows()). Read on a SETTLED
 * board only.
 *
 * verdict: 'right' | 'wrong' | 'tie' | 'void'.
 *   tie  - a final with level scores: no winner, so the pick counts for
 *          nobody and the game is out of perfect.max (ruling P4, sat-5).
 *          This used to read "push"; the plain words replace it.
 *   void - a game the board settled without: postponed, cancelled or still
 *          not final at the void cutoff (ruling 2). Counts for nobody too.
 */
export function pickemGradeRows(rows) {
  return (rows ?? [])
    .filter((r) => r.my_side != null)
    .map((r) => {
      const final = r.status === 'final';
      const scored = r.home_score != null && r.away_score != null;
      const hs = Number(r.home_score); const as = Number(r.away_score);
      const winner = final ? (hs > as ? r.home : as > hs ? r.away : null) : null;
      const verdict = !final ? 'void'
        : r.graded === 'W' ? 'right' : r.graded === 'L' ? 'wrong' : 'tie';
      const you = r.my_side === 'home' ? r.home : r.away;
      return {
        verdict, matchId: r.match_id,
        you, youRank: r.my_side === 'home' ? r.home_rank : r.away_rank,
        winner, winnerScore: scored && (winner || verdict === 'tie') ? `${r.home} ${hs}-${as} ${r.away}` : null,
        homeScore: final ? hs : null, awayScore: final ? as : null,
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

/** {right, wrong, tie, void} over the graded rows. Only right + wrong are
 * PLAYED - a tie and a void count for nobody, in the percentage too. */
export function pickemMathline(rows) {
  const n = (v) => rows.filter((r) => r.verdict === v).length;
  return { right: n('right'), wrong: n('wrong'), tie: n('tie'), void: n('void') };
}

/** 🟩 right, ⬛ wrong, ⬜ tie or void - one glyph per graded row. */
export function pickemGlyphRow(rows) {
  const GLYPH = { right: '🟩', wrong: '⬛', tie: '⬜', void: '⬜' };
  return rows.map((r) => GLYPH[r.verdict] ?? '⬛').join('');
}

/** The plain words for a game that counted for nobody. One source for the
 * grade card and its test. */
export const NOBODY_COPY = Object.freeze({
  tie: 'Tie - no winner, counts for nobody',
  void: 'Not played in time - void, counts for nobody',
});
