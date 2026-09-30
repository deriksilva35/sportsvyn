// lib/rankings/served.js - WHICH LIST IS "THE BOARD", per league. No imports,
// no database: the config modules (lib/topicDraftLeagues.js) and the pure
// hub config can name the served list without pulling lib/db.js into whatever
// bundles them. lib/rankings/servedBoard.js re-exports these and adds the reads.
//
// ONE SOURCE (wed-6). The hub, board A, the team hero, the homepage preview,
// the /nfl rail, /rankings, /rankings/teams and the topic-draft envelope all
// name the board through servedList(). The NFL serves nfl-power-z; the Elo
// board (nfl-power) still computes and is served by nobody.

export const SERVED = Object.freeze({
  // `top` is how many rows the board opens on; ALL shows the field. The canvas
  // (board A) draws the NFL at ten, and CFB's board is a top 25 by name.
  nfl: Object.freeze({ list: 'nfl-power-z', tab: 'power', top: 10, model: 'z', scoreLabel: 'Power' }),
  cfb: Object.freeze({ list: 'cfb-top25', tab: 'top25', top: 25, model: 'elo-ap', scoreLabel: 'Composite' }),
});

export const servedList = (league) => SERVED[league]?.list ?? null;

/**
 * THE NFL POWER, AS READERS SEE IT (Derik, wed-6): a 0-100 rating,
 *   round(50 + 15 * z), clamped to [0, 100].
 * RENDER-TIME ONLY. The stored power (ranking_entries.score / inputs.power)
 * stays in SDs and the working keeps showing the z inputs; this is the one
 * place the rating is made, so the board, /rankings and the team hero cannot
 * disagree about it. Math.round rounds a half up (toward +inf), so -0.5 is 0.
 * null in, null out.
 */
export const RATING = Object.freeze({ mid: 50, perSd: 15, min: 0, max: 100 });
export function powerRating(z) {
  if (z == null || z === '' || !Number.isFinite(Number(z))) return null;
  return Math.min(RATING.max, Math.max(RATING.min, Math.round(RATING.mid + RATING.perSd * Number(z))));
}

/**
 * TIED RANKS PRINT AS "T-n" (wed-6). Competition ranking already shares a rank
 * between level teams (1, 2, 2, 4); the page says so. `ranks` is every rank on
 * the board, so a tie is seen even when one of the pair is below the cut.
 */
export function tiedRanks(ranks = []) {
  const seen = new Map();
  for (const r of ranks) if (r != null) seen.set(r, (seen.get(r) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([r]) => r));
}
export const rankLabel = (rank, tied) => (rank == null ? '–' : tied?.has(rank) ? `T-${rank}` : String(rank));
