// lib/daily/lockIn.js - THE DAILY LOCK-IN (mon-4): team choice commits, picks are final,
// a team's players are seen only once it is chosen - enforced HERE, on the server,
// for signed-in runs (daily_board_runs) and guest runs (daily_guest_runs) alike.
//
// THE BUG IT FIXES: /api/daily/board/start (and the guest start) handed over every
// team's card, the board let a player open any team for free, place, clear and
// re-place, and the server only ever saw the finished eight at "Lock it in". It
// could check that eight was LEGAL, never HOW it was reached.
//
// NOW EVERY STEP IS A REQUEST AND A WRITE (migration 142, run.steps):
//   choose(team)  - commits the run to that team; refused while another team is
//                   committed and unpicked, for a team already used, and for a
//                   team none of whose players fits an open slot. Returns that
//                   team's card - the only way a card leaves the server mid-run.
//   pick(slot, player) - only from the committed team, only into an OPEN slot
//                   the player fits; FINAL (a filled slot is never changed).
//   submit        - grades the recorded picks; the client's list is not used.
// Each write is conditional on the steps it read (compare-and-set), so two tabs
// cannot both commit or both fill a slot.
//
// RUNS ALREADY IN PROGRESS AT DEPLOY (steps NULL) keep the old submit-all path,
// so nobody loses a run to the release. Rules apply to every new choice: a
// legacy run whose page reloads into the new board starts recording steps.

import { eligibleForSlot, slotsOf, DAILY_ROUND_SECONDS, DAILY_ROUND_GRACE_SECONDS } from './boardShape.js';
import { guestRunForStep, writeGuestSteps } from './guestRuns.js';

// The same sealed shape as lib/daily/openReveal.js sealedTeams (names, no cards).
// Not imported from there: openReveal imports seasonBoardRuns, which imports this.
const sealedTeams = (teams = []) => teams.map((t) => ({ key: t.key, abbr: t.abbr ?? null, record: t.record ?? null, card: [] }));

export const emptySteps = () => ({ committed: null, picks: [] });
const stepsOf = (raw) => (raw && typeof raw === 'object' && Array.isArray(raw.picks) ? { committed: raw.committed ?? null, picks: raw.picks } : emptySteps());

const fail = (reason, status = 409) => ({ ok: false, reason, status });
const filledSlots = (steps) => new Set(steps.picks.map((p) => p.slotIndex));
const openSlotIndexes = (steps, slots) => slots.map((_, i) => i).filter((i) => !filledSlots(steps).has(i));

/** PURE. Commit the run to `teamKey`. -> { ok, steps, team } | refusal. */
export function chooseTeam(board, raw, teamKey, slots = slotsOf(board)) {
  const steps = stepsOf(raw);
  const team = (board.board ?? []).find((t) => t.key === teamKey);
  if (!team) return fail(`team ${teamKey} is not on this board`, 400);
  if (steps.committed === teamKey) return { ok: true, steps, team, repeat: true }; // a retried request
  if (steps.committed != null) return fail(`pick a player from ${steps.committed} first - choosing a team commits you to it`);
  if (steps.picks.some((p) => p.teamKey === teamKey)) return fail(`team ${teamKey} is already used`);
  const open = openSlotIndexes(steps, slots);
  if (!open.length) return fail('every slot is filled');
  if (!team.card.some((pl) => open.some((i) => eligibleForSlot(pl.position, slots[i])))) {
    return fail(`no ${team.abbr ?? teamKey} player fits a slot you have left`);
  }
  return { ok: true, steps: { committed: teamKey, picks: steps.picks }, team };
}

/** PURE. Place `playerName` from the committed team into `slotIndex`, finally. */
export function pickPlayer(board, raw, slotIndex, playerName, slots = slotsOf(board)) {
  const steps = stepsOf(raw);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slots.length) return fail(`bad slotIndex ${slotIndex}`, 400);
  if (filledSlots(steps).has(slotIndex)) return fail('that pick is final - a filled slot cannot be changed');
  if (steps.committed == null) return fail('choose a team first');
  const team = (board.board ?? []).find((t) => t.key === steps.committed);
  const player = team?.card.find((p) => p.name === playerName);
  if (!player) return fail(`${playerName} is not on ${steps.committed}'s card - you are committed to ${steps.committed}`);
  if (!eligibleForSlot(player.position, slots[slotIndex])) return fail(`${player.name} (${player.position}) does not fit ${slots[slotIndex]}`);
  const pick = { slotIndex, teamKey: team.key, playerName: player.name };
  return { ok: true, steps: { committed: null, picks: [...steps.picks, pick] }, pick, player };
}

/** PURE. Recorded steps -> the per-slot picks list submitRun grades (empty slots null). */
export function picksFromSteps(raw, slots) {
  const steps = stepsOf(raw);
  const by = new Map(steps.picks.map((p) => [p.slotIndex, p]));
  return slots.map((_, slotIndex) => by.get(slotIndex) ?? { slotIndex, teamKey: null, playerName: null });
}

/**
 * PURE. What a client may know of a run in progress: every team SEALED (names
 * only), the placed picks with their players, and the committed team's card.
 */
export function progressView(board, raw) {
  const steps = stepsOf(raw);
  const teams = board.board ?? [];
  const picks = steps.picks.map((p) => ({ ...p, player: teams.find((t) => t.key === p.teamKey)?.card.find((x) => x.name === p.playerName) ?? null }));
  const committed = steps.committed ? teams.find((t) => t.key === steps.committed) ?? null : null;
  return { teams: sealedTeams(teams), picks, committed };
}

// ---- the database side: one function per step, both run kinds ----------------

const nowSql = (sql, now) => (now == null ? sql`now()` : sql`${now}::timestamptz`);

/** Load the run and its board, and refuse a run that cannot take a step. */
async function openRun(sql, who, { now = null } = {}) {
  const run = who.userId != null
    ? (await sql`SELECT r.*, extract(epoch FROM (${nowSql(sql, now)} - r.started_at))::float AS elapsed
                   FROM daily_board_runs r WHERE r.board_id = ${who.boardId} AND r.user_id = ${who.userId}`)[0]
    : await guestRunForStep(sql, who, { now }); // the guest table is read only in guestRuns.js
  if (!run) return { refusal: fail('never started') };
  if (run.picks != null) return { refusal: fail('already ran this board') };
  const [board] = await sql`SELECT *, ${nowSql(sql, now)} >= closes_at AS closed FROM daily_boards WHERE id = ${who.boardId}`;
  if (!board) return { refusal: fail('no such board', 404) };
  if (board.closed) return { refusal: fail('board closed') };
  if (Number(run.elapsed) > DAILY_ROUND_SECONDS + DAILY_ROUND_GRACE_SECONDS) return { refusal: fail('time expired') };
  return { run, board };
}

/** Compare-and-set the steps column: only if it still holds what we read. */
async function writeSteps(sql, who, run, next) {
  const before = run.steps == null ? null : JSON.stringify(run.steps);
  const after = JSON.stringify(next);
  if (who.userId == null) return writeGuestSteps(sql, who, before, after);
  const rows = await sql`UPDATE daily_board_runs SET steps = ${after}::jsonb
                 WHERE board_id = ${who.boardId} AND user_id = ${who.userId} AND picks IS NULL
                   AND steps IS NOT DISTINCT FROM ${before}::jsonb RETURNING id`;
  return rows.length > 0;
}

/**
 * CHOOSE. `who` is { boardId, userId } (signed in) or { boardId, runId, deviceId } (guest).
 * -> { ok, team: <the card>, progress } | { ok:false, reason, status }.
 */
export async function chooseStep(sql, who, teamKey, { now = null } = {}) {
  const { run, board, refusal } = await openRun(sql, who, { now });
  if (refusal) return refusal;
  const r = chooseTeam(board, run.steps, String(teamKey ?? ''));
  if (!r.ok) return r;
  if (!r.repeat && !(await writeSteps(sql, who, run, r.steps))) return fail('the run changed - reload');
  return { ok: true, team: r.team, progress: progressView(board, r.steps) };
}

/** PICK. -> { ok, pick, player, progress } | refusal. */
export async function pickStep(sql, who, slotIndex, playerName, { now = null } = {}) {
  const { run, board, refusal } = await openRun(sql, who, { now });
  if (refusal) return refusal;
  const r = pickPlayer(board, run.steps, Number(slotIndex), String(playerName ?? ''));
  if (!r.ok) return r;
  if (!(await writeSteps(sql, who, run, r.steps))) return fail('the run changed - reload');
  return { ok: true, pick: r.pick, player: r.player, progress: progressView(board, r.steps) };
}

/**
 * PLAY A LIST OF PICKS THROUGH THE STEPS, in order - choose its team, then
 * place it - for the server's own players (the house's personas, lib/house/run.js)
 * and for tests. The same rules as a reader's taps; an empty slot is skipped.
 * -> { ok: true } | the first refusal.
 */
export async function playPicks(sql, who, picks, { now = null } = {}) {
  // A RESUMED run (a retry after a failure part-way) skips what is already placed.
  const { run, refusal } = await openRun(sql, who, { now });
  if (refusal) return refusal;
  const done = new Set(stepsOf(run.steps).picks.map((p) => `${p.slotIndex}|${p.teamKey}|${p.playerName}`));
  for (const p of picks ?? []) {
    if (p?.teamKey == null || done.has(`${p.slotIndex}|${p.teamKey}|${p.playerName}`)) continue;
    const c = await chooseStep(sql, who, p.teamKey, { now });
    if (!c.ok) return c;
    const k = await pickStep(sql, who, p.slotIndex, p.playerName, { now });
    if (!k.ok) return k;
  }
  return { ok: true };
}
