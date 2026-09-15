// lib/draft/roomRoster.js - WHAT A ROOM DRAFTED, before anything has scored.
//
// meta.roster IS WRITTEN AT BRIDGE TIME, AND BRIDGE TIME IS NOT DRAFT TIME FOR
// EVERY ROOM. A human who makes their last pick goes through persistTurn,
// which calls afterRankedComplete and stores the roster on the spot
// (lib/fantasy/drafts.js:764) - so a person who drafts on Tuesday opens the
// tab on Wednesday and sees their eight. Measured: sportsvyn_og's week-1 entry
// carries all eight.
//
// A ROOM COMPLETED BY autoCompleteDraftFor DOES NOT. That path writes the
// picks and flips the draft to completed without going through persistTurn, so
// nothing bridges until settlement's own self-heal. The four house rooms filed
// on 15 Sep are exactly that: four completed drafts, 96 picks each, and four
// entries with no roster on them. The Draft surface had four rooms in it and
// nothing to show.
//
// SO THE PICKS ARE READ FROM WHERE THEY ALWAYS EXIST. draft_picks is written
// inside the same transaction that completes the draft; if the room is
// finished, its eight are there. This is a READ, not a repair - it writes
// nothing, and settlement still bridges exactly as it did.
//
// WHAT IT DELIBERATELY DOES NOT DO: score anything, or mark the best six.
// Those need the week's real points, which do not exist until Tuesday, and a
// surface showing six ticks and eight zeros on Wednesday would be inventing
// both. The caller says so in one line instead.

import { sql } from '../db.js';

/**
 * The eight, in draft order, for a room whose entry has not bridged yet.
 *
 * @returns {Promise<Array<{round, overall, pos, name, ffc}>>} empty when the
 *   draft is not complete - an unfinished room has nothing to show and must
 *   not show a partial roster as though it were the whole one.
 */
export async function picksForRoom(draftId) {
  if (draftId == null) return [];
  const rows = await sql`
    SELECT p.round, p.overall_pick, p.position, p.player_name, p.ffc_player_id
      FROM draft_picks p
      JOIN drafts d ON d.id = p.draft_id
     WHERE p.draft_id = ${draftId}
       AND p.picked_by = 'user'
       AND d.status = 'completed'
     ORDER BY p.overall_pick ASC`;
  return rows.map((r) => ({
    round: r.round,
    overall: r.overall_pick,
    pos: r.position,
    name: r.player_name,
    ffc: String(r.ffc_player_id),
  }));
}

/**
 * THE ROSTER A DRAFT SURFACE SHOULD RENDER, and where it came from.
 *
 *   bridged  the entry's own meta.roster - what it has always shown, with
 *            ids, ready to score
 *   picks    read from draft_picks because the entry has not bridged yet -
 *            the same eight, in draft order, with no ids and no scores
 *   none     the room is not finished, or there is no room
 *
 * THE SOURCE IS RETURNED, not inferred by the caller from the shape. A surface
 * that guessed would eventually guess wrong, and the one line it prints about
 * scores depends on knowing which of the two it has.
 */
export async function rosterForEntry(entry) {
  const bridged = entry?.meta?.roster;
  if (Array.isArray(bridged) && bridged.length) {
    return { source: 'bridged', rows: bridged };
  }
  const draftId = entry?.meta?.draftId;
  if (draftId == null) return { source: 'none', rows: [] };
  const picks = await picksForRoom(Number(draftId));
  return picks.length ? { source: 'picks', rows: picks } : { source: 'none', rows: [] };
}
