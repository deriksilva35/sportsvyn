// lib/settle/regrade.js - the daily football sweep: late settles past the void
// cutoff, then the 7-day re-grade. Run by /api/cron/football-regrade.
//
// WHY ONE DAILY SWEEP AND NOT A HOOK. The EPL Weekly 5 re-grade hangs off the
// poller's +24h re-sync because that poller KNOWS when a stat line changed.
// Nothing in the football ingest does: nfl_player_game_stats is rewritten by
// the Tuesday sweep and the backfills, and matches' scores by the games cron,
// none of which diffs what it wrote. So the trigger is the cheap one the
// ruling allowed - recompute every settled contest still inside a 7-day
// window and compare with what it stored. A contest whose points did not move
// costs one read and writes nothing (settleContest's and gradePickemBoard's
// "unchanged" exit).
//
// THE LATE SETTLE RIDES HERE TOO. The void cutoff is settles_at + 48h -
// Thursday for an NFL week - and the Tuesday settle crons have stopped firing
// by then. Calling the same settle functions daily is safe: before the cutoff
// they refuse exactly as on Tuesday, so the ordinary cadence is unchanged;
// after it they settle the week with its unfinished games void.

import { sql } from '../db.js';
import { settleDue, settleContest } from '../weekly/settle.js';
import { settleDuePickem, gradePickemBoard, regradablePickemBoards } from '../pickem/settle.js';
import { REGRADE_WINDOW_MS, REGRADE_SETTLED_FROM } from './footballRules.js';

/**
 * The settled Weekly/Draft contests with any game kicked off in the last 7
 * days - the only ones a correction may still move.
 */
export async function regradableWeeks({ now = new Date() } = {}) {
  return sql`
    SELECT c.id, c.game_type, c.season_year, c.week FROM contests c
     WHERE c.game_type IN ('weekly', 'draft') AND c.sport = 'nfl' AND c.settled
       AND c.settled_at >= ${REGRADE_SETTLED_FROM}::timestamptz
       AND EXISTS (
         SELECT 1 FROM matches m JOIN leagues l ON l.id = m.league_id
          WHERE l.slug = 'nfl' AND m.season_year = c.season_year
            AND m.season_phase = 'REG' AND m.week = c.week
            AND m.kickoff_at >= ${new Date(new Date(now).getTime() - REGRADE_WINDOW_MS).toISOString()}::timestamptz)
     ORDER BY c.season_year, c.week, c.id`;
}

/** Re-grade everything still in its window. Per contest, never one-for-all. */
export async function regradeRecent({ now = new Date() } = {}) {
  const out = [];
  for (const c of await regradableWeeks({ now })) {
    try {
      out.push({ contestId: c.id, gameType: c.game_type, week: c.week, ...(await settleContest(c.id, { now, regrade: true })) });
    } catch (err) {
      out.push({ contestId: c.id, gameType: c.game_type, error: String(err?.message ?? err) });
    }
  }
  for (const c of await regradablePickemBoards({ now })) {
    try {
      out.push({ gameType: 'pickem', sport: c.sport, ...(await gradePickemBoard(c, { now, regrade: true })) });
    } catch (err) {
      out.push({ contestId: c.id, gameType: 'pickem', error: String(err?.message ?? err) });
    }
  }
  return { considered: out.length, regraded: out.filter((r) => r.regraded).length, results: out };
}

/**
 * The whole sweep: late settles (void cutoff), then the re-grade. Each step
 * caught on its own - a failed Weekly settle must not stop a Pick'em
 * re-grade.
 *
 * `lock(source, fn)` runs a settle step under the SAME advisory lock its own
 * cron takes ('weekly-settle', 'draft-settle', 'pickem-settle'), so a
 * Tuesday firing and this sweep never grade one contest at once. A step whose
 * lock is held is skipped - that cron is doing the work right now.
 */
export async function footballSweep({ now = new Date(), lock = async (_s, fn) => ({ locked: false, result: await fn() }) } = {}) {
  const step = async (source, fn) => {
    try {
      const o = await lock(source, fn);
      return o.locked ? { skipped: 'locked' } : o.result;
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  };
  const weekly = await step('weekly-settle', () => settleDue('weekly', { now }));
  const draft = await step('draft-settle', () => settleDue('draft', { now }));
  const pickem = await step('pickem-settle', () => settleDuePickem({ now, only: 'football' }));
  const regrade = await step('football-regrade-grade', () => regradeRecent({ now }));
  return { weekly, draft, pickem, regrade };
}
