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
// THE CLAIM COMES FIRST, THEN THE ROOM (ruling D7). openRankedRoom below
// claims the entry, and the room is born LINKED to it - the drafts row and the
// entry's draftId are one statement (lib/fantasy/drafts.js finalizeStart). So:
//   - a crash before the room leaves a claim with no room. Nobody has seen a
//     board, so the claim may still open its room while the week is open; at
//     lock it is a DNF (bridgeContestRosters: no draftId).
//   - a crash after leaves a linked room, which a reload resumes.
// There is no order of failures that leaves a ranked room no entry owns - the
// free look at the board this rule exists to close.
//
// A ROOM WALKED AWAY FROM IS NOT A SECOND CHANCE, AND NOT A DNF EITHER. It is
// auto-completed at lock (autoCompleteDraftFor, via lockBridge) and settles on
// what it drafted plus mechanical fills.
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
import { currentDraftContest, DRAFT_CONFIG } from './contest.js';
import { autoCompleteDraftFor, startCustomDraftFor } from '../fantasy/drafts.js';
import { draftHomeView } from './view.js';

/** Has this user already used their ranked entry for this contest? */
export async function getDraftEntry(contestId, userId) {
  const r = await sql`
    SELECT * FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return r[0] ?? null;
}

/**
 * Claim the week's ranked entry FOR A ROOM THAT ALREADY EXISTS.
 *
 * NOT HOW A RANKED ROOM IS OPENED any more - openRankedRoom below claims
 * first and creates the room linked (ruling D7). This stays for fixtures that
 * build a room by hand and then attach it, and it still refuses a second room
 * against a claimed week.
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
 * Claim the week's entry WITHOUT a room yet - the first half of
 * openRankedRoom. Returns the entry and, if a room is already linked, its id.
 *
 * meta starts as '{}' and gains draftId only in the same statement that
 * creates the room; "a claim with no draftId key" is exactly "a claim whose
 * room was never made".
 */
export async function claimSeat(contestId, userId) {
  const r = await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup, meta)
    VALUES (${contestId}, ${userId}, '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (contest_id, user_id) DO NOTHING
    RETURNING id`;
  if (r.length) return { entryId: r[0].id, draftId: null, claimed: true };
  const existing = await getDraftEntry(contestId, userId);
  const d = existing?.meta?.draftId;
  return { entryId: existing.id, draftId: d == null ? null : Number(d), claimed: false };
}

/**
 * OPEN (or resume) THE READER'S RANKED ROOM FOR THIS CONTEST. The one path
 * both ranked starters take - /api/draft/start and the house tick.
 *
 * CLAIM, THEN ROOM (ruling D7). See this file's header. `start` is
 * startCustomDraftFor, injectable so a test can kill the request between the
 * claim and the room.
 *
 * @returns {Promise<{ok: true, draftId: number, resumed?: boolean}|{ok: false, reason: string, draftId?: number|null}>}
 */
export async function openRankedRoom(contest, userId, seat, { start = null } = {}) {
  const claim = await claimSeat(contest.id, Number(userId));
  if (claim.draftId != null) return { ok: true, draftId: claim.draftId, resumed: true };
  const startRoom = start ?? startCustomDraftFor;
  const started = await startRoom(Number(userId), DRAFT_CONFIG, seat, {
    ranked: true, contestId: contest.id, entryId: claim.entryId,
  });
  if (!started?.ok) {
    // ANOTHER TAB WON THE LINK: its room is the reader's room.
    if (started?.reason === 'already entered' && started.draftId != null) {
      return { ok: true, draftId: Number(started.draftId), resumed: true };
    }
    return { ok: false, reason: started?.reason ?? 'could not start' };
  }
  return { ok: true, draftId: started.draftId };
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
  // A PICK AT THE PLAYER'S SEAT IS THE PLAYER'S PICK, whatever picked_by says
  // (ruling 27 Sep). The room's timer picks for an absent player and files it
  // as 'ai'; counted by label, jam's week-3 room bridged six of its eight. The
  // seat is the engine's own snake geometry (lib/fantasy/engine.js: odd rounds
  // left to right, even right to left), the predicate lib/fantasy/leagueShare.js
  // already uses for "a run's picks". Keepers are not draft picks.
  const picks = await sql`
    SELECT dp.ffc_player_id, dp.player_name, dp.position, dp.round, dp.overall_pick
      FROM draft_picks dp
      JOIN drafts d ON d.id = dp.draft_id
      JOIN draft_configs c ON c.id = d.config_id
     WHERE dp.draft_id = ${draftId} AND d.user_id = ${userId}
       AND dp.is_keeper IS NOT TRUE
       AND (CASE WHEN dp.round % 2 = 1
                 THEN ((dp.overall_pick - 1) % c.teams_count) + 1
                 ELSE c.teams_count - ((dp.overall_pick - 1) % c.teams_count) END) = d.pick_position
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

  // ---- THIN POOL IS NOT A BROKEN CONFIG -----------------------------------
  // canFieldSix used to be a pure CONFIG-CHANGE TRIPWIRE: eight picks deal one
  // QB and seven flex-eligible against a requirement of one and five, so a
  // failure could only mean the ranked shape had been changed to something
  // unfieldable (lib/fantasy/drafts.js says so at length, and
  // lib/fantasy/smallConfig.test.mjs pins it).
  //
  // THE ROLLING POOL WOULD MAKE IT REACHABLE HONESTLY - and while the lock is
  // the first kickoff it cannot (lib/draft/pool.js: no room drafts past the
  // lock, so none ever sees a club withheld). Kept for the day the two differ:
  // a room that ran out of candidates would end short, and the rule is that
  // such a roster scores what it drafted. The two look identical from
  // here - a roster that cannot field six - so they are told apart by the one
  // thing that differs: a short room made FEWER PICKS THAN ITS GRID HAS SEATS.
  // Nothing else can be short. An abandoned room is auto-completed to full by
  // the same best-available picker the AI seats use.
  // ROUNDS IS NOT A COLUMN - it is the sum of roster_slots, the same sum
  // DRAFT_ROUNDS computes in JS. Summed here rather than loading the config
  // because this is one row and one number.
  const [grid] = await sql`
    SELECT (SELECT count(*)::int FROM draft_picks WHERE draft_id = d.id) AS made,
           c.teams_count * (SELECT coalesce(sum(value::int), 0)
                              FROM jsonb_each_text(c.roster_slots)) AS seats
      FROM drafts d JOIN draft_configs c ON c.id = d.config_id
     WHERE d.id = ${draftId} AND d.status = 'completed'`.catch(() => []);
  // COMPLETED ONLY. An in-progress room is short by definition and would label
  // every unfinished draft a thin pool. NO GRID READ, NO CLAIM: a failed
  // lookup must not label a broken config as a thin pool either - that is the
  // direction that silences an alarm.
  const thin = Boolean(grid && Number(grid.seats) > 0 && Number(grid.made) < Number(grid.seats));

  return {
    ok: true,
    roster,
    unbridged,
    // `legal.ok` keeps meaning "can field six". `thin` says why it cannot, and
    // it is what stops a normal outcome firing a config alarm.
    legal: { ...legal, thin },
  };
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
             'legal', ${legal.ok}::boolean,
             -- WHY it could not field six, when it could not. A short roster
             -- from a thin pool settles; an unfieldable config is an alarm.
             'thin', ${Boolean(legal.thin)}::boolean),
           updated_at = now(),
           -- THE DRAFT'S SUBMISSION is its completion (lib/games/rank.js): the
           -- room's own completed_at where it has one, else this write.
           submitted_at = COALESCE(
             (SELECT d.completed_at FROM drafts d
               WHERE d.id = CASE WHEN contest_entries.meta->>'draftId' ~ '^[0-9]+$'
                               THEN (contest_entries.meta->>'draftId')::int END),
             now())
     WHERE id = ${entryId}
     RETURNING id, meta`;
  return r[0] ?? null;
}

/**
 * The field-best drafter's own eight, scored (relay 2b item 3) - the same
 * shape draftSettledView() builds for the viewer's own roster, so
 * lib/games/gradePairing.js's draftGradeRows() can compare the two directly.
 * `entryId` is contest.perfect.entry_id, the ceiling settle.js already named
 * as the real, highest-scoring entry - this just reads that entry's own
 * roster back out, it does not recompute anything.
 */
export async function fieldBestRoster(entryId, board) {
  const [row] = await sql`
    SELECT e.user_id, e.meta, e.lineup, u.handle
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.id = ${entryId}`;
  if (!row) return null;
  const byId = new Map((board ?? []).map((p) => [String(p.id), p]));
  const droppedId = row.lineup?.[row.meta?.droppedSlot];
  const roster = (row.meta?.roster ?? []).map((r) => {
    const p = byId.get(String(r.id));
    return {
      ...r, label: `R${r.round}`,
      // Same reason as draftSettledView's own roster map: the team is on
      // the board snapshot, never on the bridged roster (relay 2b-fix-2
      // item 1).
      team: p?.team ?? null,
      points: p ? Number(p.points) : null,
      dropped: droppedId != null && String(r.id) === String(droppedId),
    };
  });
  return { userId: row.user_id, handle: row.handle, roster };
}

/** Everything /draft needs in one read. */
export async function draftState(userId, { now = new Date() } = {}) {
  const contest = await currentDraftContest({ now });
  if (!contest) return { contest: null, entry: null, draft: null };
  let entry = userId == null ? null : await getDraftEntry(contest.id, Number(userId));

  // ---- COMPLETION HAPPENS AT LOCK, NOT AT SETTLE --------------------------
  //
  // An abandoned room used to fill on Tuesday morning, which meant a player who
  // walked away on Wednesday spent five days looking at a half-finished roster
  // that was going to be completed anyway. Their post-lock view should show the
  // real eight.
  //
  // LAZILY, ON THE FIRST POST-LOCK READ, because nothing else observes the lock
  // passing - locks_at is a timestamp, not an event, and the only cron in this
  // game runs Tuesday. A read is what actually happens first.
  //
  // THE RACE WINDOW IS CLOSED BEFORE THIS CAN FIRE. No pick can be made after
  // locks_at, so completing here cannot collide with a player finishing their
  // own draft - which is exactly why it could not run any earlier than this.
  //
  // GUARDED THREE WAYS so it runs once and never on a hot path: only when the
  // contest is LOCKED, only when it is NOT settled, and only when the entry has
  // no roster yet. After the first read the roster exists and this is skipped.
  //
  // CAUGHT, ALWAYS. A failure here must not cost somebody their page - settle
  // still calls the same completion path as a fallback, so the Tuesday
  // guarantee is unchanged whatever happens on this read.
  const locked = new Date(contest.locks_at).getTime() <= now.getTime();
  if (locked && !contest.settled && entry && !entry.meta?.roster?.length) {
    const swept = await completeLockedContest(contest.id).catch(() => null);
    if (swept?.bridged) entry = await getDraftEntry(contest.id, Number(userId));
  }

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
 * The lock-time sweep: complete and bridge every abandoned room in a contest.
 *
 * SAME PATH AS THE SETTLE FALLBACK, deliberately - one completion routine with
 * two callers, so a room filled on Wednesday and a room filled on Tuesday get
 * identical treatment. Idempotent: an entry that already has a roster is
 * skipped, so calling this on every post-lock read costs one query.
 *
 * Exported so a cron can call it directly if one is ever added; today the
 * caller is draftState's lazy post-lock read.
 */
export async function completeLockedContest(contestId) {
  return bridgeContestRosters(contestId);
}

/**
 * Bridge every finished ranked room for a contest onto its entry.
 *
 * A ROSTER IS THE PICKS AT THE PLAYER'S SEAT, whoever made them - the player,
 * the room's timer, or the post-lock reconstruction (bridgeRoster, ruling 27 Sep).
 *
 * RUNS AT LOCK (lib/draft/lockBridge.js, the hourly draft-bridge cron, from 27
 * Sep) AND AGAIN AT SETTLE, where it is by then a no-op.
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
  let thin = 0;
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
    // A SHORT ROSTER FROM A THIN POOL IS NOT A DNF AND MUST NOT COUNT AS ONE.
    // It settles on what it drafted; bestBall fills the slots it can and
    // scores the rest zero. Counted separately so the tripwire keeps meaning
    // what it says: a dnf here is still "the ranked shape is unfieldable".
    if (!r.legal.ok) { if (r.legal.thin) thin += 1; else dnf += 1; }
  }
  return { bridged, dnf, thin, autoCompleted, entries: rows.length };
}
