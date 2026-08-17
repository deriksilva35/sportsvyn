// lib/weekly/settle.js - the Tuesday settle. The job that turns a locked week
// into a result.
//
// IT REFUSES MORE OFTEN THAN IT SETTLES, and that is the design. Settling a
// week while one game's stat lines are missing produces a perfect lineup that
// is not perfect and scores that are quietly low for anyone who started a
// player from that game. Nobody re-reads Tuesday's leaderboard, so the error is
// permanent and invisible. The job's default is to do nothing and name what is
// missing.
//
// IT IS SCHEDULED, NOT TIMED. It runs on a cadence and settles only when the
// week is complete, rather than firing once at an hour we guessed. BDL has
// never delivered an NFL stat line in season - the whole 2015-2025 corpus
// arrived in one backfill on 2026-07-20 - so any specific "by 8am Tuesday" is a
// hope. A job that retries costs nothing; a job that settles early is wrong
// forever. This is also why the cron runs HOURLY across Tuesday rather than
// once: a single 05:00 firing that refuses would push the reveal a full week,
// which is the opposite of "a noon reveal is on-spec".
//
// ONE JOB, BOTH GAMES. Nothing below reads game_type. A contest is a board, a
// week and a set of entries whose lineup is six player ids; the Weekly fills
// that lineup from a builder and The Draft fills it from a draft room, and by
// the time settlement runs the two are the same shape. The staggered crons are
// two callers, not two implementations.
//
// ============================================================================
// STAT CORRECTIONS: SETTLED IS FINAL. Ruled 17 Aug.
// ============================================================================
// If BDL revises a stat line after a week has settled, scores are NOT reopened.
// This is deliberately the OPPOSITE of the brief-correction pattern, and the
// difference is what the artefact is for: a brief is a description, and a
// description that is wrong should be fixed. A settled leaderboard is a RESULT.
// People screenshotted it, told their group chat, and moved on. Silently
// restating who won last Tuesday is worse than carrying a number that is a
// tenth of a point off - it makes every past result provisional, which is a
// bigger loss than any single correction is a gain.
//
// The guard is the same set-once UPDATE ... WHERE NOT settled the Daily's close
// uses. A correction that arrives before settle is simply included; one that
// arrives after is not.

import { sql } from '../db.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';
import { perfectLineup } from '../daily/reveal.js';
import { scoreLineup } from '../daily/play.js';
import { settleReadiness } from './rules.js';
import { weekGames, weekScores } from './pool.js';

/**
 * Score every player in the week's pool from their real stat lines.
 *
 * A player who did not play scores ZERO, not null: he was startable and the
 * lineup that started him gets what he produced, which was nothing. Null would
 * propagate into the perfect-lineup search as a missing value.
 */
export function poolWithScores(board, statRows) {
  const byPlayer = new Map();
  for (const r of statRows ?? []) {
    // A player can appear once per game; a week is one game, but a corrected
    // duplicate row must add rather than replace.
    const prev = byPlayer.get(r.id) ?? 0;
    byPlayer.set(r.id, prev + fantasyPoints(toStatLine(r), 'ppr'));
  }
  return (board ?? []).map((p) => ({
    ...p,
    points: Math.round((byPlayer.get(p.id) ?? 0) * 10) / 10,
  }));
}

/**
 * Settle one week, or explain why not.
 *
 * @returns {{settled:boolean, reason?:string, missing?:Array, entries?:number, perfect?:number}}
 */
export async function settleContest(contestId, { now = new Date() } = {}) {
  const c = (await sql`SELECT * FROM contests WHERE id = ${contestId}`)[0];
  if (!c) return { settled: false, reason: 'no such contest' };
  if (c.settled) return { settled: false, reason: 'already settled', alreadySettled: true };
  if (new Date(c.locks_at).getTime() > now.getTime()) {
    return { settled: false, reason: 'not locked yet' };
  }

  const games = await weekGames(c.season_year, c.week);
  const gate = settleReadiness(games.map((g) => ({
    id: g.id, label: g.label, status: g.status, statLines: g.statLines,
  })));
  if (!gate.ready) return { settled: false, reason: gate.reason, missing: gate.missing };

  const scored = poolWithScores(c.board, await weekScores(c.season_year, c.week));
  const perfect = perfectLineup(scored);

  const entries = await sql`SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${contestId}`;
  let counted = 0;
  for (const e of entries) {
    const filled = Object.values(e.lineup ?? {}).filter((v) => v != null).length;
    if (filled < 6) {
      // AN INCOMPLETE LINEUP IS A DNF, not a partial score. Six slots is the
      // game; scoring five of them would rank a player who forgot a slot above
      // one who filled all six badly, which inverts the thing being measured.
      await sql`
        UPDATE contest_entries
           SET score = NULL, base_score = NULL,
               meta = meta || jsonb_build_object('dnf', true, 'filled', ${filled}::int),
               updated_at = now()
         WHERE id = ${e.id}`;
      continue;
    }
    const b = scoreLineup(e.lineup, scored);
    await sql`
      UPDATE contest_entries
         SET score = ${b.baseScore}, base_score = ${b.baseScore},
             -- ::text is load-bearing: without it Postgres cannot infer the
             -- parameter's type inside jsonb_build_object and the whole
             -- statement fails with "could not determine data type".
             meta = meta || jsonb_build_object('droppedSlot', ${b.droppedSlot}::text, 'dnf', false),
             updated_at = now()
       WHERE id = ${e.id}`;
    counted += 1;
  }

  // SET-ONCE, guarded the same way the Daily's close is: a second tick in the
  // same window finds nothing to do rather than recomputing.
  const upd = await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           perfect = ${JSON.stringify(perfect)}::jsonb,
           board = ${JSON.stringify(scored)}::jsonb
     WHERE id = ${contestId} AND NOT settled
     RETURNING id`;
  if (!upd.length) return { settled: false, reason: 'already settled', alreadySettled: true };

  return {
    settled: true, entries: counted, dnf: entries.length - counted,
    perfect: perfect?.total ?? null, games: games.length,
  };
}


/**
 * Settle everything of one game type that is due, and report per contest.
 *
 * INDEPENDENT PER CONTEST: one refusal does not stop the next. The Weekly and
 * The Draft run as separate cron invocations with separate recordRun rows and
 * share no state mid-job, so a Draft failure can never leave the Weekly
 * half-settled or vice versa.
 */
export async function settleDue(gameType, { now = new Date(), sport = 'nfl' } = {}) {
  const due = await sql`
    SELECT id, season_year, week FROM contests
     WHERE game_type = ${gameType} AND sport = ${sport}
       AND NOT settled AND locks_at < ${now.toISOString()}
     ORDER BY season_year, week`;

  const results = [];
  for (const c of due) {
    // Never let one contest's failure hide the others.
    try {
      const r = await settleContest(c.id, { now });
      results.push({ contestId: c.id, week: c.week, ...r });
    } catch (err) {
      results.push({ contestId: c.id, week: c.week, settled: false, error: String(err?.message ?? err) });
    }
  }
  return {
    gameType,
    considered: due.length,
    settled: results.filter((r) => r.settled).length,
    results,
  };
}
