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
// So: the newest plays on the match, parsed, and the first one that both
// parses as a scoring play and carries a total at least as large as the one we
// just observed. An earlier touchdown always totals less and is excluded by
// construction; the play we want totals the same or one or two more.

import { parseScoringPlay } from './scoringPlay.js';

/** How many recent plays to look at. A scoring play is never further back. */
const LOOKBACK = 6;

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
      const parsed = parseScoringPlay(r);
      if (!parsed) continue;
      const total = Number(r.home_score ?? 0) + Number(r.away_score ?? 0);
      // NEVER AN OLDER SCORE. A play that leaves the board behind where we
      // already are is a play we have already reported.
      if (total < seen) return null;
      return parsed;
    }
  } catch {
    // A lookup that throws must cost nothing but the enrichment.
    return null;
  }
  return null;
}
