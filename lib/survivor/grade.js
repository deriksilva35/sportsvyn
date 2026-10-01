// lib/survivor/grade.js - the hourly Survivor job, one pool at a time.
//
// FOUR STEPS, EACH IDEMPOTENT, so a firing that dies halfway is finished by the
// next one and a firing that runs twice changes nothing the second time:
//
//   1. GRADE every pending pick whose game is decided (rules.js gradePick):
//      final -> win, or loss (a tie is a loss); cancelled, or not final once
//      its NFL week has ended -> survive. The UPDATE re-checks result='pending'.
//   2. LIVES are rewritten from the picks (rules.js livesFrom), never
//      decremented - a decrement that ran twice would take two lives.
//   3. A WEEK THAT HAS KICKED OFF, for every alive entry with no pick in it:
//        'auto' pool -> the biggest unused favorite among games still to kick
//                       off (rules.js chooseAuto), auto = true. The reader can
//                       still change it until ITS kickoff.
//        no line anywhere, or an 'out' pool -> nothing yet; once no game in the
//                       week is still open the week is MISSED (a life).
//   4. LIVES again, so a miss eliminates in the same firing.
//
// NOTHING HERE RE-SCORES A GAME. matches.status and the two scores are the
// finals every other game settles from; this reads them and writes words.

import { sql } from '../db.js';
import { seasonWeeks, pendingWeeks, weekBoard } from './read.js';
import { weekEnds, openWeek, gradePick, livesFrom, chooseAuto, gameOpen } from './rules.js';

const iso = (d) => new Date(d).toISOString();

/** Step 1. @returns {{ graded: number, byResult: object }} */
export async function gradePending(pool, weeks, now = new Date()) {
  const ends = weekEnds(weeks);
  const rows = await sql`
    SELECT p.user_id, p.week, p.team_id, m.status, m.home_score, m.away_score,
           m.home_team_id, m.away_team_id
      FROM survivor_picks p JOIN matches m ON m.id = p.match_id
     WHERE p.pool_id = ${pool.id} AND p.result = 'pending' AND p.team_id IS NOT NULL`;
  const users = []; const wks = []; const res = [];
  const byResult = {};
  for (const r of rows) {
    const out = gradePick(r, r, { now, weekEndMs: ends.get(Number(r.week)) ?? Infinity });
    if (!out) continue;
    users.push(Number(r.user_id)); wks.push(Number(r.week)); res.push(out);
    byResult[out] = (byResult[out] ?? 0) + 1;
  }
  if (users.length) {
    await sql`
      UPDATE survivor_picks p SET result = v.res, graded_at = ${iso(now)}
        FROM (SELECT unnest(${users}::int[]) AS uid, unnest(${wks}::int[]) AS wk,
                     unnest(${res}::text[]) AS res) v
       WHERE p.pool_id = ${pool.id} AND p.user_id = v.uid AND p.week = v.wk
         AND p.result = 'pending'`;
  }
  return { graded: users.length, byResult };
}

/** Steps 2 and 4. @returns {number} entries eliminated by this call */
export async function recomputeLives(pool) {
  const [entries, picks] = await Promise.all([
    sql`SELECT user_id, lives_left, eliminated_week FROM survivor_entries WHERE pool_id = ${pool.id}`,
    sql`SELECT user_id, week, result FROM survivor_picks WHERE pool_id = ${pool.id}`,
  ]);
  const byUser = new Map();
  for (const p of picks) {
    const k = Number(p.user_id);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push({ week: Number(p.week), result: p.result });
  }
  const uids = []; const left = []; const elim = [];
  let newlyOut = 0;
  for (const e of entries) {
    const { livesLeft, eliminatedWeek } = livesFrom(byUser.get(Number(e.user_id)) ?? [], pool.lives);
    if (livesLeft === Number(e.lives_left) && (eliminatedWeek ?? null) === (e.eliminated_week == null ? null : Number(e.eliminated_week))) continue;
    if (eliminatedWeek != null && e.eliminated_week == null) newlyOut += 1;
    uids.push(Number(e.user_id)); left.push(livesLeft); elim.push(eliminatedWeek);
  }
  if (uids.length) {
    await sql`
      UPDATE survivor_entries e SET lives_left = v.l, eliminated_week = v.w
        FROM (SELECT unnest(${uids}::int[]) AS uid, unnest(${left}::int[]) AS l,
                     unnest(${elim}::int[]) AS w) v
       WHERE e.pool_id = ${pool.id} AND e.user_id = v.uid`;
  }
  return newlyOut;
}

/**
 * Step 3 for one week. Only entries that are alive, joined by the week's last
 * kickoff, and have no pick row for the week.
 * @returns {{ assigned: number, missed: number }}
 */
export async function fillWeek(pool, w, now = new Date()) {
  const t = new Date(now).getTime();
  if (t < new Date(w.first_kickoff).getTime()) return { assigned: 0, missed: 0 };
  const lacking = await sql`
    SELECT e.user_id,
           COALESCE(array_agg(p.team_id) FILTER (WHERE p.team_id IS NOT NULL), '{}') AS used
      FROM survivor_entries e
      LEFT JOIN survivor_picks p ON p.pool_id = e.pool_id AND p.user_id = e.user_id
     WHERE e.pool_id = ${pool.id} AND e.eliminated_week IS NULL AND e.lives_left > 0
       AND e.joined_at <= ${iso(w.last_kickoff)}
       AND NOT EXISTS (SELECT 1 FROM survivor_picks q
                        WHERE q.pool_id = e.pool_id AND q.user_id = e.user_id AND q.week = ${w.week})
     GROUP BY e.user_id`;
  if (!lacking.length) return { assigned: 0, missed: 0 };

  const { rows } = await weekBoard(pool, w.week);
  const anyOpen = rows.some((r) => gameOpen({ status: r.status, kickoff_at: r.kickoff_at }, now));
  let assigned = 0; let missed = 0;
  for (const e of lacking) {
    const used = new Set((e.used ?? []).map(Number));
    const choice = pool.missed === 'auto' ? chooseAuto(rows, used, now) : null;
    if (choice) {
      try {
        const r = await sql`
          INSERT INTO survivor_picks (pool_id, user_id, week, team_id, match_id, auto, result, picked_at)
          VALUES (${pool.id}, ${e.user_id}, ${w.week}, ${choice.team_id}, ${choice.match_id}, true, 'pending', ${iso(now)})
          ON CONFLICT DO NOTHING RETURNING week`;
        assigned += r.length;
      } catch (err) {
        if (!String(err?.message ?? '').includes('survivor_picks_no_reuse')) throw err;
      }
    } else if (!anyOpen) {
      const r = await sql`
        INSERT INTO survivor_picks (pool_id, user_id, week, team_id, match_id, auto, result, picked_at, graded_at)
        VALUES (${pool.id}, ${e.user_id}, ${w.week}, NULL, NULL, false, 'missed', ${iso(now)}, ${iso(now)})
        ON CONFLICT DO NOTHING RETURNING week`;
      missed += r.length;
    }
  }
  return { assigned, missed };
}

/** The whole job for one pool. */
export async function gradePool(pool, { now = new Date() } = {}) {
  const weeks = await seasonWeeks(pool);
  const { graded, byResult } = await gradePending(pool, weeks, now);
  let eliminated = await recomputeLives(pool);
  let assigned = 0; let missed = 0;
  const pend = await pendingWeeks(pool.id);
  const open = openWeek(weeks, { startWeek: pool.start_week, now, pendingWeeks: pend });
  // Every week from the start that has kicked off, up to the open one (all of
  // them once the season is over) - so a firing after an outage catches up.
  const due = weeks.filter((w) => w.week >= pool.start_week && (open == null || w.week <= open));
  for (const w of due) {
    const r = await fillWeek(pool, w, now);
    assigned += r.assigned; missed += r.missed;
    if (r.missed) eliminated += await recomputeLives(pool);
  }
  return { poolId: pool.id, openWeek: open, graded, byResult, assigned, missed, eliminated };
}

/** Every pool of a sport whose season has weeks - the cron's loop. */
export async function gradeAllPools({ now = new Date(), sport = 'nfl' } = {}) {
  const pools = await sql`SELECT * FROM survivor_pools WHERE sport = ${sport} ORDER BY id`;
  const results = [];
  for (const p of pools) {
    try {
      results.push(await gradePool(p, { now }));
    } catch (e) {
      results.push({ poolId: p.id, error: String(e?.message ?? e) });
    }
  }
  return results;
}
