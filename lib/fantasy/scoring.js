// lib/fantasy/scoring.js - fantasy points from a structured stat line. PURE:
// data in, data out, no DB, no React (same contract as engine.js), so the rules
// are unit-testable and live in exactly one place.
//
// FORMAT-AWARE, CONFIG-DRIVEN: the scoring format comes from the draft's own
// row (draft_configs.scoring_format / drafts.pool_scoring_format), never a
// hardcoded default. The only thing the format changes in standard fantasy
// scoring is the per-reception value, so that is the only axis modelled here.
//
// ============================================================================
// THE RULES (transcribe to /methodology if this ever surfaces publicly)
// ============================================================================
// These are the near-universal defaults (ESPN/Yahoo/Sleeper agree on all of
// them). They are STATED here rather than tuned:
//   passing:   1 pt / 25 yds (0.04), 4 / TD, -2 / INT
//   rushing:   1 pt / 10 yds (0.10), 6 / TD
//   receiving: 1 pt / 10 yds (0.10), 6 / TD, + RECEPTION value by format
//   fumbles lost: -2
//   reception: PPR 1.0 | half-PPR 0.5 | standard 0.0
//
// KNOWN SIMPLIFICATIONS - do not present these as exact league scoring:
//   · KICKERS: real leagues score FGs by DISTANCE (40-49 = 4, 50+ = 5). We
//     score a flat 3 because the stat shape carries makes/attempts, not the
//     distance of each make. A kicker's points will read LOW versus a real
//     league. Fixing this needs per-FG distances from the backfill.
//   · DEFENSES: real leagues add POINTS-ALLOWED and YARDS-ALLOWED tiers, which
//     are the single biggest component of a DST score. We cannot model them:
//     they need team-level game results the stat line does not carry. DST
//     points will read LOW and should be treated as partial.
//   · No 2-pt conversions, no return TDs, no safeties (not in the stat shape).
// Both gaps are deliberate and visible, not silent: the UI must not imply K/DST
// points are league-exact.
//
// '2qb' IS NOT A SCORING FORMAT. The schema's scoring_format CHECK accepts it
// because FFC publishes a 2QB ADP board, but 2QB describes the ROSTER (two QB
// slots), not how points are awarded; those leagues are conventionally PPR. We
// treat it as PPR and say so, rather than silently defaulting.

export const RECEPTION_PTS = {
  ppr: 1,
  'half-ppr': 0.5,
  standard: 0,
  '2qb': 1, // roster format, not a scoring format; PPR by convention (see header)
};

export const SCORING = {
  passYdsPerPt: 25,
  passTd: 4,
  interception: -2,
  rushYdsPerPt: 10,
  rushTd: 6,
  recYdsPerPt: 10,
  recTd: 6,
  fumbleLost: -2,
  fieldGoal: 3, // flat: distance unknown (see header)
  extraPoint: 1,
  sack: 1,
  defInterception: 2,
  fumbleRecovery: 2,
  defTd: 6,
};

const n = (x) => Number(x ?? 0) || 0;

/**
 * Fantasy points for ONE game's structured stat line.
 * @param {object} s  { passYds, passTd, int, rushYds, rushTd, rec, recYds, recTd,
 *                      fumblesLost, fgm, xp, sacks, defInt, fr, defTd }
 * @param {string} scoringFormat  'ppr' | 'half-ppr' | 'standard' | '2qb'
 * @returns {number} points, rounded to 1dp (the precision leagues actually show)
 */
export function fantasyPoints(s, scoringFormat) {
  if (!s) return 0;
  const recPt = RECEPTION_PTS[scoringFormat] ?? RECEPTION_PTS.ppr;
  const pts =
      (n(s.passYds) / SCORING.passYdsPerPt)
    + n(s.passTd) * SCORING.passTd
    + n(s.int) * SCORING.interception
    + (n(s.rushYds) / SCORING.rushYdsPerPt)
    + n(s.rushTd) * SCORING.rushTd
    + (n(s.recYds) / SCORING.recYdsPerPt)
    + n(s.recTd) * SCORING.recTd
    + n(s.rec) * recPt
    + n(s.fumblesLost) * SCORING.fumbleLost
    + n(s.fgm) * SCORING.fieldGoal
    + n(s.xp) * SCORING.extraPoint
    + n(s.sacks) * SCORING.sack
    + n(s.defInt) * SCORING.defInterception
    + n(s.fr) * SCORING.fumbleRecovery
    + n(s.defTd) * SCORING.defTd;
  return Math.round(pts * 10) / 10;
}

/**
 * Season fantasy summary over a game log.
 * @param {Array<{stats: object}>} games
 * @param {string} scoringFormat
 * @returns {{points: number, ppg: number, games: number}}
 *   points = season total; ppg = per GAME PLAYED (a bye is not a 0, it is not a
 *   game; averaging over 17 would understate every player identically).
 */
export function seasonSummary(games, scoringFormat) {
  const played = (games ?? []).filter(Boolean);
  const points = played.reduce((a, g) => a + fantasyPoints(g.stats, scoringFormat), 0);
  const total = Math.round(points * 10) / 10;
  return {
    points: total,
    ppg: played.length ? Math.round((total / played.length) * 10) / 10 : 0,
    games: played.length,
  };
}

// Positions whose fantasy points this module can score EXACTLY (no missing
// component). K and DST are scored partially, per the header. The UI uses this
// to mark those two as approximate instead of quietly showing a low number.
const EXACT = new Set(['QB', 'RB', 'WR', 'TE']);
export function isExactlyScored(slotPos) { return EXACT.has(slotPos); }
