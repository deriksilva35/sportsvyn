// lib/survivor/pick.js - the one write a reader makes: this week's team.
//
// EVERY CHECK IS ON THE SERVER, against the database's own clock-free facts and
// the `now` it is handed (the action passes the real one; tests pass a fixed
// one). The order is the order a reader would want to be told:
//   pool -> open week -> entry (join until the cutoff kickoff, first_week =
//   the open week; or entries closed) -> alive ->
//   the team plays this week -> its game is pickable -> the current pick (if
//   any) has not kicked off -> not used before.
//
// THE LAST TWO ARE ALSO IN THE SQL, because a check in code is a check at one
// instant: the upsert only replaces a pick whose game is still scheduled and
// in the future, and the no-reuse index refuses a used team whatever the code
// believed a millisecond earlier.

import { sql } from '../db.js';
import { poolById, poolWeek, weekGames } from './read.js';
import { gameOpen, isPlaceholderKickoff, entriesOpen, entryCutoff } from './rules.js';

const fail = (reason) => ({ ok: false, reason });

/**
 * @returns {{ ok: true, week, teamId, matchId } | { ok: false, reason }}
 *   reason is a key of lib/survivor/rules.js REFUSALS
 */
export async function makePick(userId, poolId, teamId, { now = new Date() } = {}) {
  const uid = Number(userId); const tid = Number(teamId);
  if (!Number.isInteger(uid)) return fail('signed_out');
  const pool = await poolById(Number(poolId));
  if (!pool) return fail('no_pool');
  const { week, weeks } = await poolWeek(pool, now);
  if (week == null) return fail('no_week');
  const nowIso = new Date(now).toISOString();

  // ---- the entry: join on the first pick, while entries are open ----------
  let [entry] = await sql`SELECT * FROM survivor_entries WHERE pool_id = ${pool.id} AND user_id = ${uid}`;
  if (!entry) {
    if (!entriesOpen(pool, entryCutoff(pool, weeks), now)) return fail('entries_closed');
    // A LATE ENTRANT STARTS HERE: first_week is the open week, with full lives,
    // and no week before it is ever counted against them (grade.js).
    await sql`
      INSERT INTO survivor_entries (pool_id, user_id, lives_left, first_week)
      VALUES (${pool.id}, ${uid}, ${pool.lives}, ${week}) ON CONFLICT DO NOTHING`;
    [entry] = await sql`SELECT * FROM survivor_entries WHERE pool_id = ${pool.id} AND user_id = ${uid}`;
  }
  if (!entry || entry.eliminated_week != null || Number(entry.lives_left) <= 0) return fail('eliminated');

  // ---- the team and its game ---------------------------------------------
  const games = await weekGames(pool, week);
  const game = games.find((g) => Number(g.home_team_id) === tid || Number(g.away_team_id) === tid);
  if (!game) return fail('not_this_week');
  if (isPlaceholderKickoff(game.kickoff_at)) return fail('placeholder');
  if (!gameOpen(game, now)) return fail('team_locked');

  // ---- the current pick, if any -------------------------------------------
  const [cur] = await sql`
    SELECT p.team_id, p.result, m.status, m.kickoff_at
      FROM survivor_picks p LEFT JOIN matches m ON m.id = p.match_id
     WHERE p.pool_id = ${pool.id} AND p.user_id = ${uid} AND p.week = ${week}`;
  if (cur) {
    if (Number(cur.team_id) === tid && cur.result === 'pending') return { ok: true, week, teamId: tid, matchId: game.match_id };
    if (cur.result !== 'pending' || !gameOpen({ status: cur.status, kickoff_at: cur.kickoff_at }, now)) return fail('pick_locked');
  }

  // ---- the write, guarded again in SQL ------------------------------------
  try {
    const rows = await sql`
      INSERT INTO survivor_picks (pool_id, user_id, week, team_id, match_id, auto, result, picked_at)
      SELECT ${pool.id}, ${uid}, ${week}, ${tid}, m.id, false, 'pending', ${nowIso}
        FROM matches m
       WHERE m.id = ${game.match_id} AND m.status = 'scheduled' AND m.kickoff_at > ${nowIso}
      ON CONFLICT (pool_id, user_id, week) DO UPDATE
         SET team_id = EXCLUDED.team_id, match_id = EXCLUDED.match_id,
             auto = false, picked_at = EXCLUDED.picked_at
       WHERE survivor_picks.result = 'pending'
         AND EXISTS (SELECT 1 FROM matches m2
                      WHERE m2.id = survivor_picks.match_id
                        AND m2.status = 'scheduled' AND m2.kickoff_at > ${nowIso})
      RETURNING week`;
    if (!rows.length) return fail(cur ? 'pick_locked' : 'team_locked');
    return { ok: true, week, teamId: tid, matchId: game.match_id };
  } catch (e) {
    if (String(e?.message ?? '').includes('survivor_picks_no_reuse')) return fail('used');
    throw e;
  }
}
