// lib/six/settle.js - a night is graded once every game is over AND boxed.
//
// THE GATE IS TWO FACTS, AND BOTH ARE READ (ruling thu-17):
//   1. every game on the board is FINAL or VOID (postponed / cancelled /
//      not_needed - lib/six/rules.js VOID_STATUSES), and
//   2. every FINAL game has its box in nba_player_game_stats.
// A final with no box is the gap between the poller flipping the status and
// the stats sync landing (the same poll, normally - but a provider error on
// /stats leaves the night final and unboxed). Grading then would score every
// pick in that game 0 as a DNP and write it down for good. So it refuses, and
// says which game it is waiting on.
//
// THE RESULTS GRAMMAR IS OCTOBER'S (lib/october/settle.js): score and
// base_score carry the number and meta.six the state. NO DNF (ruling thu-44):
// an empty slot is a 0 and the rest counts; a card with NOBODY on it is not
// ranked (rank null, score null) and is off the board. The perfect six goes on
// contests.perfect the way the
// Weekly's perfect lineup does ({ score, players }).

import { sql } from '../db.js';
import { closeVoidAll } from '../settle/voidRule.js';
import { teamCap, nightState, isVoidStatus } from './rules.js';
import { scoreCard, perfectSix, rankScores, rankable } from './score.js';
import { linePoints } from '../nba/fantasyPoints.js';
import { liveRows, lockMaps, GAME_TYPE, SPORT } from './night.js';

/** Every box line for the board's matches, keyed `${matchId}:${playerId}`. */
export async function boxFor(board = []) {
  const ids = (board ?? []).map((g) => Number(g.match_id));
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT match_id, team_id, bdl_player_id, player_name, position, seconds, dnp,
           pts, reb, ast, stl, blk, turnovers, fg3m
      FROM nba_player_game_stats WHERE match_id = ANY(${ids})`;
  return new Map(rows.map((r) => [`${r.match_id}:${r.bdl_player_id}`, r]));
}

/**
 * PURE. The gate. `byId` from liveRows(), `statBy` from boxFor().
 * @returns { ready, waitingOn: [{ matchId, slug, why: 'not_final' | 'no_box', status }] , voided }
 */
export function settleGate(board = [], byId = new Map(), statBy = new Map()) {
  const boxed = new Set([...statBy.keys()].map((k) => k.split(':')[0]));
  const waitingOn = []; const voided = [];
  for (const g of board ?? []) {
    const status = byId.get(String(g.match_id))?.status ?? 'scheduled';
    if (isVoidStatus(status)) { voided.push(Number(g.match_id)); continue; }
    if (status !== 'final') { waitingOn.push({ matchId: Number(g.match_id), slug: g.slug, why: 'not_final', status }); continue; }
    if (!boxed.has(String(g.match_id))) waitingOn.push({ matchId: Number(g.match_id), slug: g.slug, why: 'no_box', status });
  }
  // EVERY GAME VOID is not a night (ruling sun-12 a): settleSixNight closes it
  // as VOID through closeVoidAll - settled, meta.void_all, nobody scored.
  const allVoid = (board ?? []).length > 0 && voided.length === (board ?? []).length;
  return { ready: waitingOn.length === 0, waitingOn, voided, allVoid };
}

/** PURE. Every player who PLAYED tonight, as perfectSix wants them. */
export function playedLines(statBy = new Map(), byId = new Map()) {
  const out = [];
  for (const [k, r] of statBy) {
    const matchId = k.split(':')[0];
    if (byId.get(matchId)?.status !== 'final' || r.dnp) continue;
    out.push({
      playerId: String(r.bdl_player_id), name: r.player_name, position: r.position ?? '',
      teamId: r.team_id, matchId: Number(matchId), points: linePoints(r),
    });
  }
  return out;
}

/**
 * THE GRADE, PURE: every entry's points, state and rank, and the perfect six,
 * from the board's rows as read. The settle writes it; the re-grade compares
 * it with what the settle wrote.
 */
export function gradeNight(board = [], entries = [], byId = new Map(), statBy = new Map(), now = new Date(), voided = []) {
  const { statusBy, kickoffBy } = lockMaps(byId);
  const scored = entries.map((e) => {
    const card = scoreCard(e.lineup ?? {}, statBy, byId);
    const state = nightState(e.lineup ?? {}, board, now, { statusBy, kickoffBy }).state;
    return { id: e.id, userId: e.user_id, state, points: card.total, filled: card.filled,
      dnp: card.slots.filter((s) => s.dnp).length };
  });
  const ranked = rankScores(scored.filter((r) => rankable(r.filled)));
  const rankOf = new Map(ranked.map((r) => [r.id, r.rank]));
  const rows = scored.map((r) => {
    const ranks = rankOf.has(r.id);
    return {
      id: r.id, userId: r.userId,
      score: ranks ? r.points : null,
      six: { state: r.state, filled: r.filled, dnp: r.dnp, rank: rankOf.get(r.id) ?? null, of: ranked.length },
    };
  });
  const cap = teamCap(board, { statusBy });
  const best = perfectSix(playedLines(statBy, byId), { cap });
  const abbr = new Map(board.flatMap((g) => [[String(g.home_team_id), g.home?.abbr], [String(g.away_team_id), g.away?.abbr]]));
  const perfect = {
    score: best?.total ?? null,
    players: (best?.picks ?? []).map((p) => ({
      slot: p.slot, playerId: p.playerId, name: p.name, position: p.position,
      teamId: p.teamId, team: abbr.get(String(p.teamId)) ?? null, matchId: p.matchId, points: p.points,
    })),
    cap, games: board.length, void: voided, field: ranked.length,
  };
  return { rows, ranked: ranked.length, perfect };
}

/**
 * Settle one night. Idempotent: the final UPDATE is guarded by NOT settled, and
 * a refused night writes nothing.
 */
export async function settleSixNight(contest, { now = new Date() } = {}) {
  const board = contest.board ?? [];
  const byId = await liveRows(board);
  const statBy = await boxFor(board);
  const gate = settleGate(board, byId, statBy);
  if (!gate.ready) return { contestId: contest.id, settled: false, waitingOn: gate.waitingOn };
  if (gate.allVoid) {
    // CLOSED AS VOID (ruling sun-12 a, the sun-10 close): settled, meta.void_all,
    // meta.void = every game; entries untouched - no score, no rank - and the
    // result says settled:false so no settle hook announces it.
    const { closed, void: ids } = await closeVoidAll(sql, contest.id, gate.voided);
    return { contestId: contest.id, settled: false, voidAll: true, closed, void: ids };
  }

  const entries = await sql`SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${contest.id}`;
  const g = gradeNight(board, entries, byId, statBy, now, gate.voided);
  for (const r of g.rows) {
    await sql`
      UPDATE contest_entries
         SET score = ${r.score}, base_score = ${r.score},
             meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ six: r.six })}::jsonb,
             locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${r.id}`;
  }
  const done = await sql`
    UPDATE contests SET settled = true, settled_at = now(), perfect = ${JSON.stringify(g.perfect)}::jsonb
     WHERE id = ${contest.id} AND NOT settled
    RETURNING id`;
  return {
    contestId: contest.id, settled: done.length > 0, entries: g.rows.length, ranked: g.ranked,
    unranked: g.rows.length - g.ranked, perfect: g.perfect.score, void: gate.voided,
  };
}

// ---------------------------------------------------------------------------
// THE RE-GRADE (ruling sat-5 S3): EPL Weekly 5's correction rule, for the NBA.
// ---------------------------------------------------------------------------
//
// A BOX CAN BE CORRECTED AFTER THE NIGHT IS GRADED - a stat moved from one
// player to another, a rebound the scorer added overnight. For REGRADE_DAYS
// after a night's last tip, every tick:
//   1. re-pulls the box of ONE night whose last re-pull is BOX_RECHECK_H old
//      (contests.meta.box_recheck_at) - the poller pulls a box once at the
//      final and never again, so without this nothing would ever change;
//   2. re-grades every settled night in the window FROM THE ROWS, compares
//      with what is stored (score, meta.six, contests.perfect), and writes
//      only what differs. IDEMPOTENT: an unchanged night writes nothing, and a
//      second pass over a corrected one finds nothing left to change.
// settled_at is never touched; a night that changed gets
// contests.meta.regraded_at, and each entry that changed meta.six.regraded_at.

export const REGRADE_DAYS = 7;
export const BOX_RECHECK_H = 24;

const num = (v) => (v == null ? null : Number(v));
const sixKey = (x) => JSON.stringify([x?.state ?? null, num(x?.filled), num(x?.dnp), num(x?.rank), num(x?.of)]);
const perfectKey = (p) => JSON.stringify([num(p?.score), (p?.players ?? []).map((x) => [String(x.playerId), num(x.points), x.slot])]);

/** PURE. What a re-grade would change: the entry rows that differ, and whether the perfect six does. */
export function regradeDiff(stored = [], graded = { rows: [], perfect: null }, storedPerfect = null) {
  const by = new Map(stored.map((e) => [String(e.id), e]));
  const entries = graded.rows.filter((r) => {
    const e = by.get(String(r.id));
    if (!e) return false;
    return num(e.score) !== num(r.score) || sixKey(e.six) !== sixKey(r.six);
  });
  return { entries, perfect: perfectKey(storedPerfect) !== perfectKey(graded.perfect) };
}

/** Is a night's box re-pull due? PURE. */
export function boxRecheckDue(meta, now = new Date()) {
  const last = Date.parse(meta?.box_recheck_at ?? '');
  return !Number.isFinite(last) || new Date(now).getTime() - last >= BOX_RECHECK_H * 3600e3;
}

/**
 * Re-check every settled night whose last tip is within REGRADE_DAYS.
 * @param syncBox   (matchId) => Promise - re-pulls one game's box (the tick
 *                  passes lib/nba/statsSync.js syncNbaGameStats); null skips step 1
 * @param maxBoxNights  how many nights' boxes one run may re-pull
 */
export async function regradeRecentSix({ now = new Date(), syncBox = null, maxBoxNights = 1 } = {}) {
  const since = new Date(new Date(now).getTime() - REGRADE_DAYS * 86400e3).toISOString();
  const nights = await sql`
    SELECT id, board, meta, perfect FROM contests
     WHERE game_type = ${GAME_TYPE} AND sport = ${SPORT} AND settled
       -- AN ALL-VOID CLOSE IS NEVER RE-GRADED: nobody scored (ruling sun-12 a).
       AND NOT COALESCE((meta->>'void_all')::boolean, false)
       AND locks_at >= ${since} AND locks_at <= ${new Date(now).toISOString()}
     ORDER BY puzzle_date ASC`;
  const out = []; let pulled = 0;
  for (const c of nights) {
    const board = c.board ?? [];
    const res = { contestId: c.id, boxes: 0, regraded: 0, perfect: false };
    try {
      if (syncBox && pulled < maxBoxNights && boxRecheckDue(c.meta, now)) {
        pulled += 1;
        const byId0 = await liveRows(board);
        for (const g of board) {
          if (byId0.get(String(g.match_id))?.status !== 'final') continue;
          await syncBox(Number(g.match_id));
          res.boxes += 1;
        }
        await sql`
          UPDATE contests
             SET meta = CASE WHEN jsonb_typeof(meta) = 'object' THEN meta ELSE '{}'::jsonb END
                        || jsonb_build_object('box_recheck_at', ${new Date(now).toISOString()}::text)
           WHERE id = ${c.id}`;
      }
      const byId = await liveRows(board);
      const statBy = await boxFor(board);
      const gate = settleGate(board, byId, statBy);
      if (!gate.ready) { res.skipped = 'gate'; out.push(res); continue; }
      const entries = await sql`
        SELECT id, user_id, lineup, score, meta->'six' AS six FROM contest_entries WHERE contest_id = ${c.id}`;
      const graded = gradeNight(board, entries, byId, statBy, now, gate.voided);
      const diff = regradeDiff(entries, graded, c.perfect);
      if (!diff.entries.length && !diff.perfect) { out.push(res); continue; }
      const at = new Date(now).toISOString();
      for (const r of diff.entries) {
        await sql`
          UPDATE contest_entries
             SET score = ${r.score}, base_score = ${r.score},
                 meta = CASE WHEN jsonb_typeof(meta) = 'object' THEN meta ELSE '{}'::jsonb END
                        || ${JSON.stringify({ six: { ...r.six, regraded_at: at } })}::jsonb,
                 updated_at = now()
           WHERE id = ${r.id}`;
      }
      await sql`
        UPDATE contests
           SET perfect = ${JSON.stringify(graded.perfect)}::jsonb,
               meta = CASE WHEN jsonb_typeof(meta) = 'object' THEN meta ELSE '{}'::jsonb END
                      || jsonb_build_object('regraded_at', ${at}::text)
         WHERE id = ${c.id} AND settled`;
      res.regraded = diff.entries.length; res.perfect = diff.perfect;
    } catch (err) {
      res.error = String(err?.message ?? err);
    }
    out.push(res);
  }
  return { nights: nights.length, boxNights: pulled, results: out };
}

/** Every opened, unsettled night. */
export async function settleDueSix({ now = new Date() } = {}) {
  const due = await sql`
    SELECT id, board, season_year, meta FROM contests
     WHERE game_type = ${GAME_TYPE} AND sport = ${SPORT} AND NOT settled
       AND opens_at <= ${new Date(now).toISOString()}
     ORDER BY puzzle_date ASC`;
  const results = [];
  for (const c of due) {
    try { results.push(await settleSixNight(c, { now })); }
    catch (err) { results.push({ contestId: c.id, error: String(err?.message ?? err) }); }
  }
  return { due: due.length, results };
}
