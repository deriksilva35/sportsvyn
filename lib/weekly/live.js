// lib/weekly/live.js - what a locked entry is worth RIGHT NOW.
//
// ============================================================================
// THE WINDOW BETWEEN LOCK AND SETTLE HAD NO NUMBERS
// ============================================================================
// From Thursday kickoff to Tuesday morning a locked lineup showed names and
// nothing else - four days of "trust us, something is happening". This module
// is the running sum: the same board, the same stat rows, the same
// poolWithScores the settle uses, read mid-flight.
//
// LIVE IS A SUM, NOT A VERDICT. Drop-worst does NOT apply here: the "worst"
// pick at halftime Sunday may be Monday night's best, and showing a total
// that DROPS a player who has not played yet reads as the site benching him.
// The live number is all six (or the best-ball six), labeled before-drop;
// the settle's number is the ruling. Same reason the Daily's standings only
// count revealed days: a number that will move is presented as moving.
//
// DRAFT ENTRIES GO THROUGH BEST BALL with LIVE scores - the best six AS OF
// NOW, which can differ from the final best six. That is what best ball
// means mid-week, and the label carries it.
//
// PARTIAL STATS ARE THE NORMAL CASE: nfl_player_game_stats fills as the
// sweep lands games. `played` per pick distinguishes "0.0 and done" from
// "has not kicked off", which are different facts a reader must not confuse.

import { sql } from '../db.js';
import { poolWithScores } from './settle.js';
import { weekScores } from './pool.js';
import { SLOTS } from './rules.js';
import { bestBall } from '../draft/bestball.js';
import { displayName } from '../daily/handles.js';

/**
 * Per-slot live rows + running total for ONE entry. PURE.
 *
 * @param {object}  a
 * @param {object}  a.lineup  slot -> player id (the Weekly's entry shape)
 * @param {Array}   a.roster  the Draft's picks (takes precedence when present)
 * @param {Array}   a.scored  poolWithScores output
 * @param {Set}     a.playedIds ids with at least one stat row
 * @returns {{rows: Array, total: number, playedCount: number, slots: number}}
 */
export function liveEntryRows({ lineup = {}, roster = [], scored = [], playedIds = new Set() } = {}) {
  const byId = new Map(scored.map((p) => [p.id, p]));
  const effective = roster.length
    ? bestBall(roster.filter((r) => r?.id != null), scored).lineup
    : lineup;
  const rows = SLOTS.map((slot) => {
    const p = byId.get(effective?.[slot]);
    return {
      slot,
      id: p?.id ?? null,
      name: p?.name ?? null,
      team: p?.team ?? null,
      points: p ? Number(p.points) : 0,
      played: p ? playedIds.has(p.id) : false,
    };
  });
  const total = Math.round(rows.reduce((a, r) => a + r.points, 0) * 10) / 10;
  return { rows, total, playedCount: rows.filter((r) => r.played).length, slots: rows.filter((r) => r.id != null).length };
}

/** The shared per-contest read: scored board + who has actually played. */
export async function liveScoredBoard(contest) {
  const statRows = await weekScores(contest.season_year, contest.week);
  return {
    scored: poolWithScores(contest.board ?? [], statRows),
    playedIds: new Set((statRows ?? []).map((r) => r.id)),
  };
}

/**
 * The live leaderboard for a locked, unsettled contest.
 *
 * NAME + TOTAL ONLY - the leak law's shape for this window: aggregates are
 * public the moment the contest locks, LINEUPS are not a wire concern of this
 * function at all (it never selects them out).
 */
export async function liveBoard(contest, { limit = 10 } = {}) {
  const { scored, playedIds } = await liveScoredBoard(contest);
  const entries = await sql`
    SELECT e.user_id, e.lineup, e.meta, u.handle
      FROM contest_entries e
      JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${contest.id}`;
  const rows = entries.map((e) => {
    const v = liveEntryRows({
      lineup: e.lineup ?? {},
      roster: (e.meta?.roster ?? []).filter((r) => r?.id != null),
      scored, playedIds,
    });
    return { userId: e.user_id, name: displayName({ id: e.user_id, handle: e.handle }), total: v.total, played: v.playedCount };
  })
    .sort((a, b) => b.total - a.total || a.userId - b.userId)
    .map((r, i) => ({ rank: i + 1, ...r }));
  return rows.slice(0, limit);
}

/**
 * The lobby's Boards-pane table for the CURRENT weekly contest.
 *
 * Three windows, three truths:
 *   pre-lock  -> null (the section keeps its populates label; entries are
 *                sealed and a board of zeros would just be the entry list)
 *   locked    -> live totals, labeled live - before drop-worst
 *   settled   -> final scores from the settle, the ruling
 *
 * Shape matches the lobby's overall table ({top, self, through}), so
 *  BoardsPane renders it with zero new markup.
 */
export async function weeklyBoardTable(contest, uid = null, { limit = 10, now = new Date() } = {}) {
  if (!contest) return null;
  const locked = new Date(contest.locks_at).getTime() <= now.getTime();
  if (!locked) return null;

  let rows;
  if (contest.settled) {
    const entries = await sql`
      SELECT e.user_id, e.score, u.handle
        FROM contest_entries e JOIN users u ON u.id = e.user_id
       WHERE e.contest_id = ${contest.id} AND e.score IS NOT NULL
       ORDER BY e.score DESC, e.user_id ASC`;
    rows = entries.map((e, i) => ({
      rank: i + 1, userId: e.user_id,
      name: displayName({ id: e.user_id, handle: e.handle }),
      points: Number(e.score),
    }));
  } else {
    rows = (await liveBoard(contest, { limit: 1000 }))
      .map((r) => ({ rank: r.rank, userId: r.userId, name: r.name, points: r.total }));
  }
  if (!rows.length) return null;

  const top = rows.slice(0, limit);
  const mine = uid == null ? null : rows.find((r) => r.userId === uid) ?? null;
  return {
    top,
    self: mine && !top.some((r) => r.userId === mine.userId) ? mine : null,
    through: contest.settled ? `Week ${contest.week} · final` : `Week ${contest.week} · live, before drop-worst`,
  };
}
