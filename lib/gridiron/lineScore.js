/**
 * lib/gridiron/lineScore.js - the quarter grid, derived.
 *
 * Pure, and separate from the component, for one reason: the card's expand is
 * client state, so a server render cannot reach the grid at all. Without this
 * split the only way to check that a line score is correct would be to open a
 * browser and look - which is not a gate, it is a hope.
 *
 * TOTALS COME FROM THE SCORE COLUMNS, NEVER FROM THE QUARTERS. The BDL-sourced
 * 2025 rows are patchy: a completed game arrives as [7, 13, null, null, null],
 * and Kansas City's Week 1 has a null FIRST quarter. Summing that row would
 * print 20 next to a game that finished 27-21, confidently and wrongly. So a
 * missing quarter renders as a dash and the total is matches.home_score /
 * away_score, which is the number the provider actually asserts.
 */

// En dash, matching the absence convention used across the instruments: a value
// we do not have, rather than a zero we are claiming.
export const ABSENT = '–';

const QUARTERS = 4;

/**
 * Build the grid, or return null when there is nothing to draw.
 *
 * The OT column appears only when someone scored in it. An all-null overtime
 * slot is what every regulation game carries, and a permanently empty OT column
 * on every card is the same defect the Watch unit had.
 */
export function lineScoreGrid(game) {
  const home = game?.lineScores?.home;
  const away = game?.lineScores?.away;
  if (!Array.isArray(home) || !Array.isArray(away)) return null;

  const hasOt = home[QUARTERS] != null || away[QUARTERS] != null;
  const columns = ['1', '2', '3', '4', ...(hasOt ? ['OT'] : [])];

  const line = (vals, team, total) => ({
    abbr: team?.abbreviation || team?.name || 'TBD',
    cells: columns.map((_, i) => (vals[i] == null ? ABSENT : vals[i])),
    total: total ?? ABSENT,
  });

  return {
    columns,
    hasOt,
    rows: [
      line(away, game.away, game.awayScore),
      line(home, game.home, game.homeScore),
    ],
  };
}

/**
 * Does the total the provider gave us agree with the quarters it gave us?
 *
 * Not used to CHANGE anything - the total always wins - but the answer is worth
 * having: a card whose quarters do not add up is showing a partial line score,
 * and that is a data-quality fact about the feed rather than a rendering bug.
 * Returns null when the row has any gap, because an incomplete row cannot
 * disagree with anything.
 */
export function quartersReconcile(vals, total) {
  if (!Array.isArray(vals) || total == null) return null;
  // A NULL OT SLOT IS NOT A GAP - it is the ordinary state of every game that
  // ended in regulation, and treating it as missing data would make this
  // function return null for almost the entire schedule. Only the four
  // regulation quarters have to be present.
  const regulation = vals.slice(0, QUARTERS);
  if (regulation.length < QUARTERS || regulation.some((v) => v == null)) return null;
  const ot = vals[QUARTERS] ?? 0;
  return regulation.reduce((a, b) => a + b, 0) + ot === total;
}
