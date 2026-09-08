// lib/daily/seasonBoardRuns.js — turn a submitted picks[] into a stored
// daily_board_runs row, graded SERVER-SIDE against the board's own FROZEN
// best_roster (standing ruling: ceiling is stored on the edition, never
// recomputed at read time) - CLIENT SCORE IS NEVER TRUSTED. Every pick is
// re-validated against the stored board.board before anything is scored:
// a request naming a team not on this board, a player not on that team's
// card, or a slot the player is not eligible for is refused before grading
// ever runs, the same discipline lockEntry (lib/daily/entries.js) already
// applies to the v1 Daily.
//
// SETTLED IS FINAL, AND THAT IS UNCHANGED. UNIQUE (board_id, user_id) is the
// constraint (090); a second submit for a board a user has already SUBMITTED
// is refused, not overwritten.
//
// WHAT CHANGED IN 097: the row is now created at START, not at submit, so this
// module's write is an UPDATE of that row rather than an INSERT. The refusal
// therefore moves from "a row exists" to "a row exists WITH PICKS":
//
//   no row            never started      -> refused, 409 'never started'
//   row, picks NULL   started, unfinished -> this is the row we UPDATE
//   row, picks set    already submitted   -> refused, 409 'already ran this board'
//
// The UPDATE carries `AND picks IS NULL` in its own WHERE clause, so two tabs
// submitting at once cannot both win: the second matches zero rows and is
// refused by the same branch as a late one. That predicate is the enforcement;
// the check-then-write below would be a race on its own.

import { eligibleForSlot, shapeBestRoster, DAILY_ROUND_SECONDS, DAILY_ROUND_GRACE_SECONDS } from './boardShape.js';
import { gradeFromOptimum } from './seasonBoardGrade.js';

/**
 * Re-derive a play.roster (seasonBoardPlay.js shape) from submitted picks,
 * validated against the board's OWN frozen teams - never trusting a
 * client-supplied player/points/position. PURE.
 *
 * @param board the daily_boards row (board.board is [{key, card:[...]}, ...])
 * @param picks [{ slotIndex, teamKey, playerName }, ...]
 * @param slots the board's slot shape, e.g. boardShape.SLOTS
 * @returns { ok:true, roster, used } | { ok:false, reason }
 */
export function buildRosterFromPicks(board, picks, slots) {
  if (!Array.isArray(picks) || picks.length !== slots.length) {
    return { ok: false, reason: `expected ${slots.length} picks, got ${Array.isArray(picks) ? picks.length : typeof picks}` };
  }
  const roster = new Array(slots.length).fill(null);
  const used = new Set();
  const filledSlots = new Set();

  for (const pick of picks) {
    const { slotIndex, teamKey, playerName } = pick ?? {};
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slots.length) {
      return { ok: false, reason: `bad slotIndex ${slotIndex}` };
    }
    if (filledSlots.has(slotIndex)) return { ok: false, reason: `slot ${slotIndex} submitted twice` };
    // AN EMPTY SLOT IS A LEGAL SUBMISSION. The clock auto-submits whatever is
    // on the board at zero, and a partial roster scores what it scores - so
    // an entry with no team is an empty slot, not a malformed one. It still
    // has to name its slotIndex, so eight entries always arrive and a
    // missing one is still caught by the length check above.
    if (teamKey == null && playerName == null) {
      roster[slotIndex] = { pos: slots[slotIndex], pick: null };
      filledSlots.add(slotIndex);
      continue;
    }
    const team = board.board.find((t) => t.key === teamKey);
    if (!team) return { ok: false, reason: `team ${teamKey} is not on this board` };
    if (used.has(teamKey)) return { ok: false, reason: `team ${teamKey} used more than once - one player per team` };
    const player = team.card.find((p) => p.name === playerName);
    if (!player) return { ok: false, reason: `${playerName} is not on ${teamKey}'s card` };
    const slot = slots[slotIndex];
    if (!eligibleForSlot(player.position, slot)) {
      return { ok: false, reason: `${player.name} (${player.position}) is not eligible for ${slot}` };
    }
    roster[slotIndex] = { pos: slot, pick: { player, teamKey } };
    used.add(teamKey);
    filledSlots.add(slotIndex);
  }
  if (roster.some((r) => r == null)) return { ok: false, reason: 'not every slot was filled' };
  return { ok: true, roster, used, picked: roster.filter((r) => r.pick != null).length };
}

/**
 * Grade a set of stored/submitted picks against a board's OWN frozen
 * best_roster and ceiling - the one grading path both submitRun (a fresh
 * submission) and a page reload (A3: land on the stored grade) share. PURE
 * given its inputs; never recomputes the optimum (standing ruling).
 *
 * @returns { ok:true, play, grade } | { ok:false, reason }
 */
export function regradeStoredRun(board, picks, slots) {
  const built = buildRosterFromPicks(board, picks, slots);
  if (!built.ok) return { ok: false, reason: built.reason };
  // NORMALISED AT READ, for the row already stored. Today's board (id 2) has
  // best_roster in the solver's raw shape - raw_name, team_key, no meta -
  // and is not being backfilled. shapeBestRoster() detects that shape by
  // the nested `player` object and maps it onto the flat keys the grader
  // reads; a board written after this fix is already flat and passes through.
  const optimum = { total: Number(board.ceiling), bySlot: shapeBestRoster(board.best_roster) };
  // THE SAME SHAPE initBoardPlay RETURNS - slots, teams, roster, used - because
  // SeasonBoard calls teamsLeft(play) (state.teams.filter) on every render,
  // and { roster, used } alone crashed the receipt with "Cannot read
  // properties of undefined (reading 'filter')" the first time a submitted
  // run was ever opened (8 Sep 2026, digest 1010057789).
  //
  // used IS AN ARRAY HERE, NOT A SET. This object crosses the RSC boundary as
  // a client-component prop, and a Set does not serialise across it.
  // SeasonBoard rehydrates it (hydratePlay), and gradeFromOptimum accepts
  // either.
  const play = { slots: slots.slice(), teams: board.board, roster: built.roster, used: [...built.used] };
  const grade = gradeFromOptimum(play, board.board, optimum, slots);
  return { ok: true, play, grade };
}

/**
 * START: claim the attempt and stamp the clock, before the board is played.
 *
 * THE WHOLE POINT OF THIS FUNCTION IS THAT IT IS IDEMPOTENT. ON CONFLICT DO
 * NOTHING plus a re-read means a second start - a reload, a second tab, a
 * double-tap - returns the FIRST start's started_at rather than a fresh one.
 * A player cannot buy a new clock, and cannot re-roll the board by abandoning
 * a run: the row is already theirs the moment they first saw the cards.
 *
 * Returns { ok, startedAt, resumed } - `resumed` true when the row already
 * existed, which the route passes through so the client can tell a resume from
 * a first start without inspecting timestamps.
 */
export async function startRun(sql, { boardId, userId, now = null }) {
  const boards = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
  const board = boards[0];
  if (!board) return { ok: false, reason: 'no such board', status: 404 };

  // THE BOARD'S OWN CLOSE IS THE DEADLINE. v2 has no per-run limit - its clock
  // counts UP and elapsed_s is a record, not a budget - so the only thing a run
  // can run out of is the edition's day. Compared in Postgres, never Date.now(),
  // the same discipline the rest of this feature follows.
  const [{ closed }] = await sql`
    SELECT ${now == null ? sql`now()` : sql`${now}::timestamptz`} >= ${board.closes_at}::timestamptz AS closed`;
  if (closed) return { ok: false, reason: 'board closed', status: 409 };

  // RETURNING tells us which happened: a row back means WE created it, no row
  // back means one was already there. That is the only honest source for
  // `resumed` - re-reading and comparing timestamps cannot distinguish a
  // resume from a start that happened in the same millisecond.
  const created = await sql`
    INSERT INTO daily_board_runs (board_id, user_id, started_at)
    VALUES (${boardId}, ${userId}, ${now == null ? sql`now()` : sql`${now}::timestamptz`})
    ON CONFLICT (board_id, user_id) DO NOTHING
    RETURNING id`;

  const [row] = await sql`
    SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId}`;
  if (!row) return { ok: false, reason: 'start failed', status: 500 };

  return {
    ok: true,
    startedAt: row.started_at,
    closesAt: board.closes_at,
    resumed: created.length === 0,
    submitted: row.picks != null,
    run: row,
  };
}

/**
 * Grade and store one user's run against one board.
 *
 * UPDATES THE ROW START ALREADY CREATED. Refuses a run that never started and
 * a run that has already submitted; never overwrites a submitted one.
 */
export async function submitRun(sql, { boardId, userId, picks, elapsedS, slots, now = null }) {
  const boards = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
  const board = boards[0];
  if (!board) return { ok: false, reason: 'no such board', status: 404 };

  // STATE BEFORE SHAPE. The cheap refusals run FIRST, so a late or unstarted
  // submit is told what is actually wrong with it rather than whatever the
  // grader happens to notice about its picks. Ordering this the other way
  // answered a submit-after-midnight with "expected 8 picks, got 0", which
  // sends the reader to fix the wrong thing.

  // PAST THE BOARD'S CLOSE IS A DNF, NOT A LATE SCORE, so a submit arriving
  // after midnight cannot land a row the reveal has already published a
  // leaderboard without.
  const [{ closed }] = await sql`
    SELECT ${now == null ? sql`now()` : sql`${now}::timestamptz`} >= ${board.closes_at}::timestamptz AS closed`;
  if (closed) return { ok: false, reason: 'board closed', status: 409 };

  // THE ROW MUST EXIST AND BE UNSUBMITTED. Not the enforcement - the UPDATE's
  // own `AND picks IS NULL` is, and it still runs below - but this is what
  // turns the two ways to miss into two different answers.
  const [pre] = await sql`
    SELECT picks IS NOT NULL AS submitted FROM daily_board_runs
     WHERE board_id = ${boardId} AND user_id = ${userId}`;
  if (!pre) return { ok: false, reason: 'never started', status: 409 };
  if (pre.submitted) return { ok: false, reason: 'already ran this board', status: 409 };

  // THREE MINUTES FROM started_at, ENFORCED HERE. elapsed is the SERVER's
  // number - now minus the stored started_at - never the client's elapsedS,
  // which is accepted for shape compatibility and ignored. Past the round
  // plus a 5s grace the submit is refused and the row stays picks NULL: a
  // DNF, indistinguishable from never finishing, because that is what it is.
  const [clock] = await sql`
    SELECT extract(epoch FROM (${now == null ? sql`now()` : sql`${now}::timestamptz`} - started_at))::float AS elapsed
      FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId}`;
  const serverElapsed = Number(clock?.elapsed ?? 0);
  if (serverElapsed > DAILY_ROUND_SECONDS + DAILY_ROUND_GRACE_SECONDS) {
    return { ok: false, reason: 'time expired', status: 409, elapsedS: Math.round(serverElapsed) };
  }
  const storedElapsedS = Math.min(DAILY_ROUND_SECONDS, Math.max(0, Math.round(serverElapsed)));

  const regraded = regradeStoredRun(board, picks, slots);
  if (!regraded.ok) return { ok: false, reason: regraded.reason, status: 400 };
  const { grade, play } = regraded;
  // NOTHING PICKED IS A DNF, NOT A ZERO. The row keeps picks NULL, so every
  // leaderboard read still excludes it and the page shows the DNF state.
  if (!play.roster.some((r) => r.pick != null)) {
    return { ok: false, reason: 'nothing picked', status: 409 };
  }

  // ONE STATEMENT DECIDES IT. `AND picks IS NULL` makes this safe against two
  // tabs: exactly one UPDATE can match, the loser matches zero rows.
  const updated = await sql`
    UPDATE daily_board_runs
       SET picks = ${JSON.stringify(picks)}::jsonb,
           score = ${grade.mine},
           pct = ${board.ceiling > 0 ? grade.mine / Number(board.ceiling) : 1},
           matched = ${grade.matchedCount},
           elapsed_s = ${storedElapsedS},
           completed_at = ${now == null ? sql`now()` : sql`${now}::timestamptz`}
     WHERE board_id = ${boardId} AND user_id = ${userId} AND picks IS NULL
     RETURNING *`;
  if (updated.length) return { ok: true, run: updated[0], grade };

  // Nothing matched despite the checks above, which means a concurrent submit
  // won the race between them and this UPDATE. That is precisely the case the
  // `AND picks IS NULL` predicate exists for, and the loser gets the same
  // answer it would have got a millisecond earlier.
  return { ok: false, reason: 'already ran this board', status: 409 };
}
