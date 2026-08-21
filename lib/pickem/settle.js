// lib/pickem/settle.js - grading the board, once, when the weekend is done.
//
// THE GATE DECIDES, NOT THE CLOCK (the weekly-settle law verbatim): a board
// settles only when EVERY game on its snapshot is final in matches. A refusal
// is the expected state for most firings and is not a failure. settles_at is
// advisory; the route's stale alarm uses it to notice a board that CANNOT
// complete (a cancelled game never turns final in CFBD's vocabulary - it just
// stays 'scheduled' forever - and that deserves a human, not a guess).
//
// SCORING IS COUNTING: one point per correct pick, a no-pick is 0 by absence,
// a null winner (tie - impossible in CFB, defended anyway) awards nobody.

import { sql } from '../db.js';
import { winnerOf } from './view.js';

/** The final results for a board, or a refusal naming what is missing. */
export async function resultsFor(board) {
  const ids = board.map((g) => g.match_id);
  const rows = await sql`
    SELECT id, status, home_score, away_score FROM matches WHERE id = ANY(${ids})`;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const notFinal = board.filter((g) => (byId.get(g.match_id)?.status ?? 'scheduled') !== 'final');
  if (notFinal.length) {
    return { complete: false, remaining: notFinal.length, results: null };
  }
  const results = {};
  for (const g of board) results[String(g.match_id)] = winnerOf(byId.get(g.match_id));
  return { complete: true, remaining: 0, results };
}

/** Wins in a flat lineup against a results map. PURE. */
export function scoreLineup(lineup = {}, results = {}) {
  let wins = 0;
  for (const [matchId, side] of Object.entries(lineup)) {
    if (results[matchId] != null && results[matchId] === side) wins += 1;
  }
  return wins;
}

/**
 * Settle every due pickem board. Idempotent: settled boards are excluded by
 * the WHERE, and the per-contest write flips `settled` in the same statement
 * batch that stamps the scores.
 */
export async function settleDuePickem({ now = new Date() } = {}) {
  const due = await sql`
    SELECT id, board FROM contests
     WHERE game_type = 'pickem' AND NOT settled
       AND opens_at <= ${new Date(now).toISOString()}
     ORDER BY opens_at ASC`;
  const out = [];
  for (const c of due) {
    try {
      const r = await resultsFor(c.board);
      if (!r.complete) {
        out.push({ contestId: c.id, settled: false, remaining: r.remaining });
        continue;
      }
      const entries = await sql`
        SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${c.id}`;
      for (const e of entries) {
        const wins = scoreLineup(e.lineup ?? {}, r.results);
        await sql`
          UPDATE contest_entries
             SET score = ${wins}, base_score = ${wins}, locked_at = COALESCE(locked_at, now()), updated_at = now()
           WHERE id = ${e.id}`;
      }
      // perfect carries the RESULTS map - the receipt and the field reveal
      // read it rather than re-deriving from matches (which can be re-synced
      // under them; the settle's read is the one that counted).
      await sql`
        UPDATE contests
           SET settled = true, settled_at = now(),
               perfect = ${JSON.stringify({ results: r.results, max: c.board.length })}::jsonb
         WHERE id = ${c.id} AND NOT settled`;
      out.push({ contestId: c.id, settled: true, entries: entries.length });
    } catch (err) {
      out.push({ contestId: c.id, error: String(err?.message ?? err) });
    }
  }
  return { due: due.length, results: out };
}

/** Boards that SHOULD have settled long ago - the stale alarm's read. */
export async function stalePickemBoards({ now = new Date(), graceHours = 48 } = {}) {
  return sql`
    SELECT id, settles_at FROM contests
     WHERE game_type = 'pickem' AND NOT settled
       AND settles_at IS NOT NULL
       AND settles_at + make_interval(hours => ${graceHours}) < ${new Date(now).toISOString()}`;
}
