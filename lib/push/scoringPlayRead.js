// lib/push/scoringPlayRead.js - FIND THE PLAY THAT MOVED THE SCORE.
//
// ONE INDEXED SELECT ON OUR OWN TABLE. No provider request: `plays` is already
// being written live by the plays-live cron, so the poller can name a scorer
// without spending a single call against anybody's quota.
//
// TWO INDEPENDENT WRITERS, AND THAT IS THE WHOLE RISK. The score poller and
// the plays cron do not coordinate, so the play row can land AFTER the score
// does - or, on a bad night, not at all. Every caller of this must treat null
// as normal: the push still goes out, wearing the delta-derived wording it
// wore before this file existed. The join is the enrichment, not the
// dependency (relay ruling R1).
//
// HOW THE ROW IS IDENTIFIED. Not by an id we do not have, and not by matching
// the scoreline exactly - a touchdown row's score ALREADY INCLUDES its extra
// point, so it will read 7 when the board the poller just wrote reads 6.
// So: walk the newest plays backwards and take the first that parses as a
// scoring play.
//
// THE SCORE IS THE BOUND, NOT THE ROW COUNT. Every play row carries the board
// after it, so walking back is walking down through the scoreline. The moment
// a row's total drops BELOW the one the poller just observed, we have walked
// past our own event into a play we already reported - and there is nothing
// behind it worth reading. That floor is correct at any lookback, which is
// what makes the row count a cost control rather than a correctness rule.
//
// THE ROW COUNT WAS THE CORRECTNESS RULE, AND IT WAS TOO SMALL. It was six,
// on the assumption that the poller looks within a few plays of the score
// moving. Measured against the 13 Sep slate - 124 scoring plays across the
// finals - the median gap between one scoring play and the next is 13 plays
// and the maximum is 79. Six only ever worked because the two writers happen
// to keep pace; a plays batch landing between the score moving and this lookup
// would have pushed the scoring play out of the window and returned null. It
// still degraded correctly - no scorer, delta-derived wording - but it would
// have done it silently, and the fix is one number and a floor.

import { parseScoringPlay } from './scoringPlay.js';

/**
 * How many recent plays to read. A COST CONTROL, not a correctness rule - the
 * score floor below is what decides when to stop. Forty covers the slate's
 * worst observed gap of 79 in two polls and its median of 13 three times over,
 * and is still one indexed page.
 */
export const LOOKBACK = 40;

/**
 * @param {object} sql  the poller's tagged-template client
 * @param {number} matchId
 * @param {object} observed {homeScore, awayScore} - what we just wrote
 * @returns {Promise<object|null>} parseScoringPlay's output, or null
 */
export async function scoringPlayFor(sql, matchId, { homeScore, awayScore } = {}) {
  if (matchId == null) return null;
  const seen = Number(homeScore ?? 0) + Number(awayScore ?? 0);
  try {
    const rows = await sql`
      SELECT play_type, text, home_score, away_score, period, clock
        FROM plays
       WHERE match_id = ${matchId}
       ORDER BY id DESC
       LIMIT ${LOOKBACK}`;
    for (const r of rows) {
      // THE FLOOR, CHECKED ON EVERY ROW AND NOT ONLY ON SCORING ONES. A row
      // whose board is behind where we already are sits before our event, so
      // everything older than it does too. Stop rather than keep reading.
      //
      // A row with no scoreline cannot be judged and is simply not a floor -
      // it is skipped for that purpose and still offered to the parser.
      if (r.home_score != null && r.away_score != null) {
        if (Number(r.home_score) + Number(r.away_score) < seen) return null;
      }
      const parsed = parseScoringPlay(r);
      if (parsed) return parsed;
    }
  } catch {
    // A lookup that throws must cost nothing but the enrichment.
    return null;
  }
  return null;
}

/**
 * BASEBALL'S WITNESS: the text of the scoring play that produced THIS
 * scoreline, or null. parseScoringPlay() above is a football reader - its
 * kinds are touchdown, safety and field goal, and "safety squeeze" is a
 * baseball sentence - so a baseball score never goes through it. Only the
 * text is wanted, for scoreKindLabel's "homers", and only from the row whose
 * post-play board is exactly the one we just wrote.
 */
export async function baseballScoringText(sql, matchId, { homeScore, awayScore } = {}) {
  if (matchId == null || homeScore == null || awayScore == null) return null;
  try {
    const [r] = await sql`
      SELECT text FROM plays
       WHERE match_id = ${matchId} AND scoring IS TRUE
         AND home_score = ${Number(homeScore)} AND away_score = ${Number(awayScore)}
       ORDER BY id DESC LIMIT 1`;
    return r?.text ?? null;
  } catch {
    return null;
  }
}
