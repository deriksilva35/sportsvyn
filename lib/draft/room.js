// lib/draft/room.js - every seat in a ranked room, scored the same way the
// user's own seat is (relay 2b item 1).
//
// ALL 12 SEATS, BOTS INCLUDED. draft_picks persists every pick for the whole
// room under one draft_id - the human's own seat is picked_by='user'
// (matching drafts.pick_position), every other seat is picked_by='ai' with no
// per-bot marker, so a bot's own eight picks can only be grouped by SEAT,
// derived from overall_pick/round via the inverse of the same snake formula
// lib/draft/view.js's snakePick() encodes forward.
//
// SCORED THROUGH THE SAME PATH AS THE USER'S OWN (bridgeRoster then settle's
// bestBall+scoreLineup): bestball.js's best six of eight, drop-worst's best
// five of those six - identically for every seat, so a bot's score means the
// same thing a human's does and the room can be ranked on one number.

import { sql } from '../db.js';
import { bestBall } from './bestball.js';
import { scoreLineup } from '../daily/play.js';
import { DRAFT_CONFIG } from './contest.js';

/**
 * The seat holding pick number `overallPick` in `round`, `teamsCount` seats,
 * snake order. Inverse of lib/draft/view.js's snakePick(seat, round,
 * teamsCount): odd rounds run seat 1..N left to right, even rounds reverse.
 */
export function seatForPick(overallPick, round, teamsCount) {
  const posInRound = overallPick - (round - 1) * teamsCount;
  return round % 2 === 1 ? posInRound : teamsCount - posInRound + 1;
}

/**
 * Every seat's roster for one draft room, bridged to nfl_players.id the same
 * way bridgeRoster() bridges the human's own single seat (lib/draft/entry.js)
 * - one bulk sim_player_pool lookup for the whole room, not one per seat.
 * Map(seat -> [{id, pos}]), twelve entries, a seat with no id resolved for a
 * pick still counts the pick (bestBall simply cannot use it, same as an
 * unbridged pick in the user's own roster).
 */
async function seatRosters(draftId, teamsCount) {
  const picks = await sql`
    SELECT round, overall_pick, ffc_player_id, position
      FROM draft_picks WHERE draft_id = ${draftId} ORDER BY overall_pick`;
  const ffcIds = [...new Set(picks.map((p) => String(p.ffc_player_id)))];
  const matched = ffcIds.length ? await sql`
    SELECT DISTINCT ON (ffc_player_id) ffc_player_id, matched_player_id
      FROM sim_player_pool
     WHERE ffc_player_id = ANY(${ffcIds}) AND matched_player_id IS NOT NULL
     ORDER BY ffc_player_id, snapshot_date DESC` : [];
  const byFfc = new Map(matched.map((m) => [String(m.ffc_player_id), m.matched_player_id]));

  const bySeat = new Map();
  for (const p of picks) {
    const seat = seatForPick(p.overall_pick, p.round, teamsCount);
    if (!bySeat.has(seat)) bySeat.set(seat, []);
    bySeat.get(seat).push({ id: byFfc.get(String(p.ffc_player_id)) ?? null, pos: p.position });
  }
  return bySeat;
}

/**
 * The whole room's standings for one settled week: {rank, of, seats}, seats
 * sorted by score desc, `user: true` marking the human's own seat (matched
 * via drafts.pick_position, the same column the room's UI already reads
 * seat from - see lib/draft/view.js). Returns null for a draftId that does
 * not resolve to a real room, so a bad or missing draftId costs the caller a
 * skipped write, not a thrown settle.
 */
export async function roomStandings(draftId, scoredBoard) {
  const [d] = await sql`SELECT pick_position FROM drafts WHERE id = ${draftId}`;
  if (!d) return null;
  const teamsCount = DRAFT_CONFIG.teamsCount;
  const bySeat = await seatRosters(draftId, teamsCount);

  const seats = [];
  for (let seat = 1; seat <= teamsCount; seat++) {
    const roster = (bySeat.get(seat) ?? []).filter((r) => r.id != null);
    const { lineup } = bestBall(roster, scoredBoard);
    const { baseScore } = scoreLineup(lineup, scoredBoard);
    seats.push({ seat, score: baseScore, user: seat === d.pick_position });
  }
  seats.sort((a, b) => b.score - a.score);
  const rank = 1 + seats.findIndex((s) => s.user);
  return { rank, of: teamsCount, seats };
}
