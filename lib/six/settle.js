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
  return { ready: waitingOn.length === 0, waitingOn, voided };
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
 * Settle one night. Idempotent: the final UPDATE is guarded by NOT settled, and
 * a refused night writes nothing.
 */
export async function settleSixNight(contest, { now = new Date() } = {}) {
  const board = contest.board ?? [];
  const byId = await liveRows(board);
  const statBy = await boxFor(board);
  const gate = settleGate(board, byId, statBy);
  if (!gate.ready) return { contestId: contest.id, settled: false, waitingOn: gate.waitingOn };

  const { statusBy, kickoffBy } = lockMaps(byId);
  const entries = await sql`SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${contest.id}`;
  const scored = entries.map((e) => {
    const card = scoreCard(e.lineup ?? {}, statBy, byId);
    const state = nightState(e.lineup ?? {}, board, now, { statusBy, kickoffBy }).state;
    return { id: e.id, userId: e.user_id, state, points: card.total, filled: card.filled,
      dnp: card.slots.filter((s) => s.dnp).length };
  });
  const ranked = rankScores(scored.filter((r) => rankable(r.filled)));
  const rankOf = new Map(ranked.map((r) => [r.id, r.rank]));
  for (const r of scored) {
    const ranks = rankOf.has(r.id);
    await sql`
      UPDATE contest_entries
         SET score = ${ranks ? r.points : null}, base_score = ${ranks ? r.points : null},
             meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({
    six: { state: r.state, filled: r.filled, dnp: r.dnp, rank: rankOf.get(r.id) ?? null, of: ranked.length },
  })}::jsonb,
             locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${r.id}`;
  }

  const cap = teamCap(board, { statusBy });
  const best = perfectSix(playedLines(statBy, byId), { cap });
  const abbr = new Map(board.flatMap((g) => [[String(g.home_team_id), g.home?.abbr], [String(g.away_team_id), g.away?.abbr]]));
  const perfect = {
    score: best?.total ?? null,
    players: (best?.picks ?? []).map((p) => ({
      slot: p.slot, playerId: p.playerId, name: p.name, position: p.position,
      teamId: p.teamId, team: abbr.get(String(p.teamId)) ?? null, matchId: p.matchId, points: p.points,
    })),
    cap, games: board.length, void: gate.voided, field: ranked.length,
  };
  const done = await sql`
    UPDATE contests SET settled = true, settled_at = now(), perfect = ${JSON.stringify(perfect)}::jsonb
     WHERE id = ${contest.id} AND NOT settled
    RETURNING id`;
  return {
    contestId: contest.id, settled: done.length > 0, entries: scored.length, ranked: ranked.length,
    unranked: scored.length - ranked.length, perfect: perfect.score, void: gate.voided,
  };
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
