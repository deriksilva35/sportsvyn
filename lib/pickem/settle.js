// lib/pickem/settle.js - grading the board when the weekend is done, and
// re-grading it for 7 days after.
//
// THE GATE DECIDES, NOT THE CLOCK (the weekly-settle law verbatim): a board
// settles only when EVERY game on its snapshot is final in matches - until
// the VOID CUTOFF. settles_at + 48h (ruling 2, sat-5): a game still not final
// then - postponed, cancelled (CFBD never turns a cancelled game final; it
// stays 'scheduled' forever), or stuck - is VOID. Its pick counts for nobody
// and it is left OUT of perfect.max, and the board settles on the rest. Before
// the cutoff a non-final game still holds the board. The stale alarm keeps
// its job for a board that cannot settle even then (no settles_at, or every
// game void).
//
// SCORING IS COUNTING: one point per correct pick, a no-pick is 0 by absence.
// A TIED FINAL (ruling P4) has no winner: it is 0 for everyone AND out of
// perfect.max, exactly like a void game - "tie, no winner, counts for nobody".
//
// THE 7-DAY RE-GRADE (ruling 3): a score correction within 7 days of a game's
// kickoff re-grades the boards holding it. gradePickemBoard(c, { regrade })
// is the same function over a settled row: it re-reads the games still inside
// their window, keeps the stored result for every game outside it and for
// every void, and writes only if a result moved. settled_at stays the first
// settle; perfect.regraded_at records the re-grade.

import { sql } from '../db.js';
import { winnerOf } from './view.js';
import { isSeriesBoard, settleSeriesBoard } from '../mlb/seriesPickem.js';
import { isDayBoard, settleDayBoard } from '../nba/dayPickem.js';
import { pastVoidCutoff, inRegradeWindow, regradeEligible, REGRADE_SETTLED_FROM } from '../settle/footballRules.js';
import { closeVoidAll } from '../settle/voidRule.js';
import { isConfidence, scoreConfidence } from './confidence.js';
import { atsResults, atsMax } from './ats.js';

/**
 * THE RESULTS, and the gate. PURE given the match rows.
 *   results: { [match_id]: 'home' | 'away' | null }   null = tie or void
 * Before the void cutoff any non-final game holds the board; after it, a
 * non-final game is void (results null, listed in `void`).
 */
export function boardResults(board, byId, { voidAllowed = false } = {}) {
  const results = {}; const voided = []; let remaining = 0;
  for (const g of board ?? []) {
    const m = byId.get(Number(g.match_id));
    if ((m?.status ?? 'scheduled') !== 'final') {
      if (voidAllowed) { results[String(g.match_id)] = null; voided.push(Number(g.match_id)); continue; }
      remaining += 1;
      continue;
    }
    results[String(g.match_id)] = winnerOf(m);
  }
  if (remaining) return { complete: false, remaining, results: null, void: [] };
  if (voided.length && voided.length === (board ?? []).length) {
    // EVERY GAME VOID is an outage, not a board: refuse, and the stale alarm names it.
    // CLOSED AS VOID by gradePickemBoard (ruling sun-10 item 4).
    return { complete: false, remaining: voided.length, results: null, void: voided, allVoid: true };
  }
  return { complete: true, remaining: 0, results, void: voided };
}

/** perfect.max: the games that HAD a winner - a tie or a void counts for nobody. PURE. */
export function perfectMax(results = {}) {
  return Object.values(results ?? {}).filter((v) => v === 'home' || v === 'away').length;
}

async function matchRows(board) {
  const ids = (board ?? []).map((g) => Number(g.match_id));
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT id, status, home_score, away_score, kickoff_at FROM matches WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id, r]));
}

/** The final results for a board, or a refusal naming what is missing. */
export async function resultsFor(board, { voidAllowed = false } = {}) {
  return boardResults(board, await matchRows(board), { voidAllowed });
}

/**
 * The re-grade's results. PURE given the rows. A stored void stays void; a
 * game outside its 7-day window keeps its stored result; a game inside it is
 * re-read - and if it is somehow no longer final, the stored result stands
 * (a re-grade corrects a score, it never re-opens a game).
 */
export function regradeResults(board, byId, stored = {}, { voids = [], now = new Date() } = {}) {
  const voidSet = new Set((voids ?? []).map(Number));
  const results = {};
  for (const g of board ?? []) {
    const key = String(g.match_id);
    const m = byId.get(Number(g.match_id));
    const prev = Object.prototype.hasOwnProperty.call(stored ?? {}, key) ? stored[key] : null;
    if (voidSet.has(Number(g.match_id))) { results[key] = null; continue; }
    const ko = m?.kickoff_at ?? g.kickoff_at;
    if (!inRegradeWindow(ko, now) || m?.status !== 'final') { results[key] = prev; continue; }
    results[key] = winnerOf(m);
  }
  return results;
}

/** Wins in a flat lineup against a results map. PURE. */
export function scoreLineup(lineup = {}, results = {}) {
  let wins = 0;
  for (const [matchId, side] of Object.entries(lineup)) {
    if (results[matchId] != null && results[matchId] === side) wins += 1;
  }
  return wins;
}

const sameResults = (a = {}, b = {}) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) if ((a?.[k] ?? null) !== (b?.[k] ?? null)) return false;
  return true;
};

/**
 * Grade one football board (not a series board, not a day board). Settle, or
 * with { regrade: true } re-grade a settled one. Idempotent both ways: the
 * settle write is guarded by NOT settled, and a re-grade with no moved result
 * writes nothing.
 */
export async function gradePickemBoard(c, { now = new Date(), regrade = false } = {}) {
  const board = c.board ?? [];
  const byId = await matchRows(board);
  let results; let voids; let ats;
  if (regrade) {
    if (!regradeEligible(c)) return { contestId: c.id, settled: false, regraded: false, reason: 'settled before the re-grade ruling' };
    // AN ALL-VOID CLOSE IS NEVER RE-GRADED (ruling sun-10 item 4).
    if (c.meta?.void_all === true) return { contestId: c.id, settled: false, regraded: false, reason: 'void_all' };
    voids = Array.isArray(c.perfect?.void) ? c.perfect.void.map(Number) : [];
    results = regradeResults(board, byId, c.perfect?.results ?? {}, { voids, now });
    // THE ATS RESULTS RE-GRADE WITH THEM: the same window, the same stored voids,
    // the same frozen spreads - a corrected score can flip a cover or a push.
    ats = atsResults(board, byId, {
      voids, stored: c.perfect?.ats?.results ?? {},
      keep: (g) => !inRegradeWindow(byId.get(Number(g.match_id))?.kickoff_at ?? g.kickoff_at, now) || byId.get(Number(g.match_id))?.status !== 'final',
    });
    if (sameResults(results, c.perfect?.results ?? {}) && sameResults(ats, c.perfect?.ats?.results ?? {})) {
      return { contestId: c.id, settled: false, regraded: false, reason: 'unchanged' };
    }
  } else {
    const r = boardResults(board, byId, { voidAllowed: pastVoidCutoff(c, now) });
    if (r.allVoid) {
      // CLOSED AS VOID (ruling sun-10 item 4): settled, meta.void_all, no
      // scores, perfect left null, no settle push (settled: false here).
      const { closed, void: ids } = await closeVoidAll(sql, c.id, r.void);
      return { contestId: c.id, settled: false, allVoid: true, voidAll: true, closed, void: ids };
    }
    if (!r.complete) return { contestId: c.id, settled: false, remaining: r.remaining };
    results = r.results; voids = r.void;
    ats = atsResults(board, byId, { voids });
  }
  const entries = await sql`
    SELECT id, user_id, lineup, ranks FROM contest_entries WHERE contest_id = ${c.id}`;
  // A CONFIDENCE BOARD scores by RANK and keeps each entry's own max
  // (lib/pickem/confidence.js); every other board counts wins exactly as it
  // always did and leaves max_score null. Asked of the board's stamp.
  const confidence = isConfidence(c);
  for (const e of entries) {
    if (confidence) {
      const { score, max } = scoreConfidence({ board, lineup: e.lineup ?? {}, ranks: e.ranks, results });
      await sql`
        UPDATE contest_entries
           SET score = ${score}, base_score = ${score}, max_score = ${max},
               locked_at = COALESCE(locked_at, now()), updated_at = now()
         WHERE id = ${e.id}`;
      continue;
    }
    const wins = scoreLineup(e.lineup ?? {}, results);
    await sql`
      UPDATE contest_entries
         SET score = ${wins}, base_score = ${wins}, locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${e.id}`;
  }
  // perfect carries the RESULTS map - the receipt and the field reveal read it
  // rather than re-deriving from matches (which can be re-synced under them;
  // the settle's read is the one that counted). max is the games that had a
  // winner: a tie and a void are both out (rulings 2 and P4).
  // On a confidence board perfect.max stays the COUNT of games with a winner
  // (readers that print "N games" still read true); the points max is per entry.
  // perfect.ats (S3, lib/pickem/ats.js): who covered each game's FROZEN spread.
  // Read by a league that scores against the spread; every other reader ignores it.
  const perfect = { results, max: perfectMax(results), void: voids, ats: { results: ats, max: atsMax(ats) } };
  if (regrade) {
    await sql`
      UPDATE contests
         SET perfect = ${JSON.stringify({ ...perfect, regraded_at: new Date(now).toISOString() })}::jsonb
       WHERE id = ${c.id} AND settled`;
    return { contestId: c.id, settled: false, regraded: true, entries: entries.length };
  }
  await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           perfect = ${JSON.stringify(perfect)}::jsonb
     WHERE id = ${c.id} AND NOT settled`;
  return { contestId: c.id, settled: true, entries: entries.length, voided: voids.length };
}

/**
 * Settle every due pickem board. Idempotent: settled boards are excluded by
 * the WHERE, and the per-contest write flips `settled` in the same statement
 * batch that stamps the scores.
 *
 * `only` NARROWS BY BOARD KIND: null is every kind; 'series' is the MLB
 * series boards alone (the daily series cron, ruling P5 - a series ends on
 * any night, not only Sunday to Tuesday); 'football' is the snapshot boards
 * alone (the daily void/re-grade sweep).
 */
export async function settleDuePickem({ now = new Date(), sport = null, only = null } = {}) {
  // `sport` NARROWS, it never widens: null is every board (pickem-settle's
  // call), a sport is that sport's only (the NBA tick settles its own day
  // boards hourly and must not grade a football board out from under the
  // pickem-settle route, whose push hook announces what IT settled).
  const due = await sql`
    SELECT id, sport, board, season_year, meta, settles_at FROM contests
     WHERE game_type = 'pickem' AND NOT settled
       AND opens_at <= ${new Date(now).toISOString()}
       AND (${sport}::text IS NULL OR sport = ${sport})
     ORDER BY opens_at ASC`;
  const out = [];
  let considered = 0;
  for (const c of due) {
    const kind = isSeriesBoard(c.board) ? 'series' : isDayBoard(c) ? 'day' : 'football';
    if (only && kind !== only) continue;
    considered += 1;
    try {
      // A SERIES BOARD SETTLES BY ITS OWN GATE. "Every game final" is the
      // wrong question for a best-of-seven: a sweep leaves three scheduled
      // games that will never be played, and this loop would wait for them
      // forever. lib/mlb/seriesPickem.js asks whether every SERIES is decided,
      // and scores in the round's points rather than one per pick.
      //
      // ASKED OF THE BOARD, NOT OF THE SPORT. The row is in hand; `sport ===
      // 'mlb'` would be a claim about every MLB board this product may ever
      // have rather than about this one.
      if (kind === 'series') { out.push(await settleSeriesBoard(c)); continue; }
      // A DAY BOARD (NBA) SETTLES BY ITS OWN GATE TOO: final OR void, and the
      // lock re-read from matches at settle (lib/nba/dayPickem.js).
      if (kind === 'day') { out.push(await settleDayBoard(c)); continue; }
      out.push(await gradePickemBoard(c, { now }));
    } catch (err) {
      out.push({ contestId: c.id, error: String(err?.message ?? err) });
    }
  }
  return { due: only ? considered : due.length, results: out };
}

/**
 * The settled football boards still inside a re-grade window: any game on the
 * board kicked off within the last 7 days. Series and day boards are not
 * football boards and are left out.
 */
export async function regradablePickemBoards({ now = new Date() } = {}) {
  const rows = await sql`
    SELECT c.id, c.sport, c.board, c.meta, c.perfect, c.settles_at, c.settled_at FROM contests c
     WHERE c.game_type = 'pickem' AND c.settled
       AND c.settled_at >= ${REGRADE_SETTLED_FROM}::timestamptz
       AND NOT COALESCE((c.meta->>'day_board')::boolean, false)
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(c.board) g
           JOIN matches m ON m.id = (g->>'match_id')::int
          WHERE m.kickoff_at >= ${new Date(now).toISOString()}::timestamptz - interval '7 days')`;
  return rows.filter((c) => !isSeriesBoard(c.board) && !isDayBoard(c));
}

/** Boards that SHOULD have settled long ago - the stale alarm's read. */
export async function stalePickemBoards({ now = new Date(), graceHours = 48 } = {}) {
  return sql`
    SELECT id, settles_at FROM contests
     WHERE game_type = 'pickem' AND NOT settled
       AND settles_at IS NOT NULL
       AND settles_at + make_interval(hours => ${graceHours}) < ${new Date(now).toISOString()}`;
}
