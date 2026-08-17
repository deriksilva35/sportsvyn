// lib/draft/entry.js - one ranked draft per user per week, and the bridge from
// a drafted roster to a scoreable entry.
//
// ============================================================================
// START IS CONSUMED. Ruled, and it is the Daily's rule for the Daily's reason.
// ============================================================================
// The contest_entries row is written when the room OPENS, not when the draft
// finishes. Writing it at the end would let a player open a ranked room, see
// which players the engine took early, abandon, and open a fresh one knowing
// the board - which is the same exploit the Daily's DNF closes by consuming the
// attempt the moment the board is seen. UNIQUE (contest_id, user_id) is what
// makes it one per week; the insert is the entry.
//
// AN ABANDONED ROOM IS A DNF, not a second chance. It reaches settlement with
// an empty lineup and no roster, which settleContest already treats as a DNF.
//
// ============================================================================
// THE BRIDGE
// ============================================================================
// The sim drafts on ffc_player_id. Settlement scores nfl_players.id. The join
// is sim_player_pool.matched_player_id, measured at 712 of 712 skill players on
// the live snapshot and 712 of 712 present on the filtered Week 1 board.
//
// THE ROSTER IS STORED, NOT THE LINEUP. Best-ball needs the real scores to pick
// six, and those do not exist until Tuesday. So the entry carries the roster in
// meta and settlement fills the lineup - see lib/draft/bestball.js.

import { sql } from '../db.js';
import { canFieldSix } from './bestball.js';
import { currentDraftContest } from './contest.js';
import { autoCompleteDraftFor } from '../fantasy/drafts.js';
import { draftHomeView } from './view.js';

/** Has this user already used their ranked entry for this contest? */
export async function getDraftEntry(contestId, userId) {
  const r = await sql`
    SELECT * FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return r[0] ?? null;
}

/**
 * Claim the week's ranked entry and remember which sim draft owns it.
 *
 * IDEMPOTENT ON RE-ENTRY: returning to a room already claimed returns the same
 * entry rather than refusing, so a reload is not a lockout. It refuses only a
 * SECOND draft - a different draftId against a claimed week.
 */
export async function claimEntry(contestId, userId, draftId) {
  const r = await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, meta)
    VALUES (${contestId}, ${userId}, '{}'::jsonb,
            ${JSON.stringify({ draftId: Number(draftId) })}::jsonb)
    ON CONFLICT (contest_id, user_id) DO NOTHING
    RETURNING id, meta`;
  if (r.length) return { ok: true, entryId: r[0].id, draftId: Number(draftId), claimed: true };

  const existing = await getDraftEntry(contestId, userId);
  const owned = Number(existing?.meta?.draftId);
  if (owned === Number(draftId)) return { ok: true, entryId: existing.id, draftId: owned, claimed: false };
  return { ok: false, reason: 'already entered', draftId: owned ?? null };
}

/**
 * Turn a finished sim draft into the entry's roster.
 *
 * RUNS AT DRAFT COMPLETION, and again idempotently at lock. Doing it at
 * completion means a player learns immediately that their roster is legal;
 * doing it again at lock catches a room that finished after the page closed.
 *
 * A PICK THAT CANNOT BE BRIDGED IS KEPT, with a null id. Dropping it silently
 * would turn an identity failure into a quietly short roster, and a short
 * roster is a DNF - so the player would be failed by our join without anyone
 * seeing why.
 */
export async function bridgeRoster(draftId, userId) {
  const picks = await sql`
    SELECT dp.ffc_player_id, dp.player_name, dp.position, dp.round, dp.overall_pick
      FROM draft_picks dp
      JOIN drafts d ON d.id = dp.draft_id
     WHERE dp.draft_id = ${draftId} AND d.user_id = ${userId}
       AND dp.picked_by = 'user'
     ORDER BY dp.overall_pick`;
  if (!picks.length) return { ok: false, reason: 'no picks' };

  const ffcIds = picks.map((p) => String(p.ffc_player_id));
  const matched = await sql`
    SELECT DISTINCT ON (ffc_player_id) ffc_player_id, matched_player_id
      FROM sim_player_pool
     WHERE ffc_player_id = ANY(${ffcIds}) AND matched_player_id IS NOT NULL
     ORDER BY ffc_player_id, snapshot_date DESC`;
  const byFfc = new Map(matched.map((m) => [String(m.ffc_player_id), m.matched_player_id]));

  const roster = picks.map((p) => ({
    id: byFfc.get(String(p.ffc_player_id)) ?? null,
    ffc: String(p.ffc_player_id),
    name: p.player_name,
    pos: p.position,
    round: p.round,
  }));
  const unbridged = roster.filter((r) => r.id == null);
  const legal = canFieldSix(roster.filter((r) => r.id != null));

  return { ok: true, roster, unbridged, legal };
}

/**
 * Write the bridged roster onto the entry.
 *
 * NESTED MERGE WRITTEN OUT EXPLICITLY. `meta || jsonb_build_object(...)` is a
 * SHALLOW merge, so assigning meta wholesale would delete draftId - the key
 * that says which room this entry belongs to. See CLAUDE.md; this is the exact
 * defect that wiped final_seen_at in August.
 */
export async function storeRoster(entryId, { roster, unbridged, legal, autoFilled = 0 }) {
  const r = await sql`
    UPDATE contest_entries
       SET meta = meta || jsonb_build_object(
             'roster', ${JSON.stringify(roster)}::jsonb,
             'unbridged', ${unbridged.length}::int,
             -- HOW MANY OF THESE PICKS WERE MECHANICAL. The picks themselves are
             -- the seat's and count in full; this is the provenance, kept here
             -- rather than on draft_picks because that column's CHECK allows
             -- only user | ai | logged.
             'autoFilled', ${autoFilled}::int,
             'legal', ${legal.ok}::boolean),
           updated_at = now()
     WHERE id = ${entryId}
     RETURNING id, meta`;
  return r[0] ?? null;
}

/** Everything /draft needs in one read. */
export async function draftState(userId, { now = new Date() } = {}) {
  const contest = await currentDraftContest({ now });
  if (!contest) return { contest: null, entry: null, draft: null };
  const entry = userId == null ? null : await getDraftEntry(contest.id, Number(userId));
  const draftId = entry?.meta?.draftId ?? null;
  const draft = draftId == null ? null
    : (await sql`SELECT id, status, pick_position FROM drafts WHERE id = ${draftId}`)[0] ?? null;
  return { contest, entry, draft };
}

/** The Draft's state for the homepage module. */
export async function getDraftHome(userId = null, { now = new Date() } = {}) {
  const { contest, entry, draft } = await draftState(userId, { now });
  if (!contest) return null;
  // BOARD DROPPED BEFORE THE VIEW IS BUILT - it is the Weekly's 1,000-player
  // snapshot and the module needs a pick count.
  const { board, ...noBoard } = contest;   // eslint-disable-line no-unused-vars
  return draftHomeView({ contest: noBoard, entry, draft, now });
}

/**
 * Bridge every finished ranked room for a contest onto its entry.
 *
 * RUNS AT SETTLE, IDEMPOTENTLY, AND THAT IS THE SELF-HEAL. The happy path
 * stores a roster the moment the room finishes, so a player sees immediately
 * whether theirs is legal. But a room that completed after the tab closed, or
 * whose store failed, would otherwise reach Tuesday with no roster and settle
 * as a DNF - failing a player for our missed write rather than their draft.
 * Re-running here costs one query per unbridged entry and closes that hole.
 *
 * IT ONLY FILLS BLANKS. An entry that already has a roster is left alone: the
 * draft is over, the picks cannot change, and rewriting settled input on the
 * morning of a settle is how a replay stops matching the original.
 */
export async function bridgeContestRosters(contestId) {
  const rows = await sql`
    SELECT id, user_id, meta FROM contest_entries WHERE contest_id = ${contestId}`;
  let bridged = 0;
  let dnf = 0;
  let autoCompleted = 0;
  for (const e of rows) {
    if (Array.isArray(e.meta?.roster) && e.meta.roster.length) continue;
    const draftId = e.meta?.draftId;
    if (draftId == null) { dnf += 1; continue; }
    // AN ABANDONED ROOM AUTO-COMPLETES BEFORE IT BRIDGES. Picks made count;
    // picks unmade are filled by the same best-available picker the AI seats
    // use, so the entry settles on its merits rather than being voided. See
    // autoCompleteDraftFor - START IS CONSUMED protects the entry's reality,
    // not its punishment. Idempotent, so a completed room is a no-op.
    const completed = await autoCompleteDraftFor(Number(draftId)).catch(() => null);
    const autoFilled = completed?.completed ? (completed.userPicksFilled ?? 0) : 0;
    if (autoFilled > 0) autoCompleted += 1;
    const r = await bridgeRoster(Number(draftId), Number(e.user_id));
    if (!r.ok) { dnf += 1; continue; }
    await storeRoster(e.id, { ...r, autoFilled });
    bridged += 1;
    if (!r.legal.ok) dnf += 1;
  }
  return { bridged, dnf, autoCompleted, entries: rows.length };
}
