// lib/house/run.js - filing the house's entries. The cron's whole body.
//
// ONE CRON, HOURLY, IDEMPOTENT PER PERSONA PER CONTEST. Four tightly-scheduled
// crons would each have to be right about when its board is created, and would
// each fail silently on a week the board landed late. This one runs every hour
// from before the first board opens to after the last one locks, does nothing
// on the ticks where there is nothing to do, and files whatever is missing on
// the tick after a board appears.
//
// EVERY WRITER UNDER IT IS ALREADY IDEMPOTENT, which is what makes hourly
// cheap: savePick merges by (contest, user), saveLineup upserts, startRun is
// ON CONFLICT DO NOTHING and submitRun refuses a second run, claimEntry is ON
// CONFLICT DO NOTHING. So "have I already done this" is a question the
// database answers, not one this module tracks.
//
// A PERSONA THAT DOES NOT PLAY A GAME IS SKIPPED, NOT FAILED (ruling R1). The
// Fade has no method on the Daily or the Weekly, so it has no row there, and
// the summary counts it as `skipped` rather than as an error - an absent row
// is the honest output, not a missing one.
//
// ONE PERSONA'S BAD NIGHT COSTS ONLY ITS OWN ENTRY. Every filing is guarded
// individually and the failure is recorded in the summary; a Homer with no
// teams on the board must not stop The Chalk from filing.

import { PERSONAS, playsGame, HOMER_TEAMS } from './personas.js';
import { ensureHouseAccounts } from './accounts.js';
import { pickDaily } from './pickDaily.js';
import { pickPickem } from './pickPickem.js';
import { pickWeekly } from './pickWeekly.js';
import { seatStrategyFor } from './pickDraft.js';
import { SLOTS as DAILY_SLOTS } from '../daily/boardShape.js';
import { startRun, submitRun } from '../daily/seasonBoardRuns.js';
import { savePick } from '../pickem/entry.js';
import { saveLineup, currentContest as currentWeekly } from '../weekly/entries.js';
import { currentDraftContest, DRAFT_CONFIG } from '../draft/contest.js';
import { getDraftEntry, claimEntry, bridgeRoster } from '../draft/entry.js';
import { startCustomDraftFor, autoCompleteDraftFor } from '../fantasy/drafts.js';
import { getSpreadHome } from '../gridiron/oddsReader.js';
import { makeRng } from '../fantasy/engine.js';

/**
 * A SEEDED RNG, DERIVED FROM THE PERSONA AND THE BOARD, never Math.random.
 * The Gut is noisy on purpose, but it must be the SAME noise on a re-run: a
 * cron that filed a different lineup every hour would be five entries a week,
 * not one, and the last one before the lock would be the only one that counted
 * for reasons nobody could see.
 */
const seedFor = (personaKey, contestId) => {
  let h = 2166136261;
  for (const ch of `${personaKey}:${contestId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return makeRng(Math.abs(h) % 2147483647);
};

const ok = (v) => ({ ok: true, ...v });
const skip = (why) => ({ ok: true, skipped: why });

// ---------------------------------------------------------------------------
// THE DAILY
// ---------------------------------------------------------------------------
export async function fileDaily(sql, { userId, personaKey, board, now = null }) {
  const picks = pickDaily(personaKey, board, seedFor(personaKey, board.id));
  if (!picks) return skip('no method on this game');

  const started = await startRun(sql, { boardId: board.id, userId, now });
  if (!started.ok) return { ok: false, reason: started.reason };
  if (started.submitted) return skip('already played');

  const r = await submitRun(sql, {
    boardId: board.id, userId, picks, elapsedS: 0, slots: DAILY_SLOTS, now,
  });
  if (!r.ok && r.reason === 'already ran this board') return skip('already played');
  if (!r.ok) return { ok: false, reason: r.reason };
  return ok({ filed: picks.filter((p) => p.teamKey != null).length });
}

// ---------------------------------------------------------------------------
// PICK'EM
// ---------------------------------------------------------------------------
export async function filePickem(sql, { userId, personaKey, contest, spreads, homerTeamIds, now = new Date() }) {
  const picks = pickPickem(personaKey, contest.board, {
    spreads, homerTeamIds, rng: seedFor(personaKey, contest.id),
  });
  if (!picks) return skip('no method on this game');
  if (!picks.length) return skip('nothing priced to pick');

  let filed = 0; let locked = 0;
  for (const p of picks) {
    const r = await savePick(userId, contest.id, p.matchId, p.side, { now });
    if (r.ok) filed += 1;
    // A GAME THAT KICKED OFF BEFORE THE CRON REACHED IT IS NOT AN ERROR. The
    // house is subject to the same per-game lock as everybody else, and a
    // board filed late simply has fewer picks on it.
    else if (r.reason === 'game_locked') locked += 1;
    else return { ok: false, reason: r.reason, matchId: p.matchId };
  }
  return ok({ filed, locked, of: contest.board.length });
}

// ---------------------------------------------------------------------------
// THE WEEKLY
// ---------------------------------------------------------------------------
export async function fileWeekly(sql, { userId, personaKey, contest, now = new Date() }) {
  const lineup = pickWeekly(personaKey, contest.board, seedFor(personaKey, contest.id));
  if (!lineup) return skip('no method on this game');
  if (!Object.keys(lineup).length) return skip('no eligible players');

  const r = await saveLineup(contest.id, userId, lineup, { now });
  // slot_locked means SOME slots saved and some were past their kickoff, which
  // is a partial success and exactly what a late filing should look like.
  if (!r.ok && r.reason !== 'slot_locked') return { ok: false, reason: r.reason };
  return ok({ filed: r.filled ?? Object.keys(lineup).length, partial: r.reason === 'slot_locked' });
}

// ---------------------------------------------------------------------------
// THE DRAFT - a whole room, headless
// ---------------------------------------------------------------------------
export async function fileDraft(sql, { userId, personaKey, contest, seat }) {
  const strategy = seatStrategyFor(personaKey);
  if (!strategy) return skip('no method on this game');

  const existing = await getDraftEntry(contest.id, userId);
  if (existing?.meta?.draftId) return skip('already drafted');

  // THE SAME CONFIG EVERY PLAYER DRAFTS, and the same eleven bots. Only the
  // twelfth seat behaves differently, and only because seatStrategy says so.
  const started = await startCustomDraftFor(userId, DRAFT_CONFIG, seat, { ranked: true });
  if (!started?.ok) return { ok: false, reason: started?.reason ?? 'could not start' };

  const claim = await claimEntry(contest.id, userId, started.draftId);
  if (!claim.ok) return { ok: false, reason: claim.reason };

  const done = await autoCompleteDraftFor(started.draftId, { seatStrategy: strategy });
  if (!done.ok) return { ok: false, reason: done.reason };

  const bridged = await bridgeRoster(started.draftId, userId);
  return ok({ draftId: started.draftId, seat, picks: done.userPicksFilled, bridged: bridged?.count ?? null });
}

// ---------------------------------------------------------------------------
// THE TICK
// ---------------------------------------------------------------------------
/**
 * @param {object} deps  every reader injected, so the whole tick is testable
 *   without a database and without a clock.
 */
export async function runHouseTick(sql, {
  now = new Date(),
  // THE DAILY'S CLOCK IS POSTGRES', not ours - startRun and submitRun compare
  // against now() in the database, which is the discipline that whole feature
  // follows. dailyNow overrides it and exists for one reason: a test needs to
  // reach a board whose window has passed. Production never passes it.
  dailyNow = null,
  openDailyBoard = null,        // {id, board} or null
  pickemContest = null,
  weeklyContest = null,
  draftContest = null,
  spreads = new Map(),
  homerTeamIds = [],
} = {}) {
  const { byKey, created, repaired } = await ensureHouseAccounts(sql);
  const summary = { created, repaired, games: {} };

  const each = async (game, fn) => {
    const out = {};
    for (const p of PERSONAS) {
      if (!playsGame(p.key, game)) { out[p.key] = { skipped: 'does not play' }; continue; }
      try { out[p.key] = await fn(p, byKey.get(p.key)); } catch (e) {
        out[p.key] = { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
      }
    }
    summary.games[game] = out;
  };

  if (openDailyBoard) {
    await each('daily', (p, userId) => fileDaily(sql, { userId, personaKey: p.key, board: openDailyBoard, now: dailyNow }));
  }
  if (pickemContest) {
    await each('pickem', (p, userId) => filePickem(sql, {
      userId, personaKey: p.key, contest: pickemContest, spreads, homerTeamIds, now,
    }));
  }
  if (weeklyContest) {
    await each('weekly', (p, userId) => fileWeekly(sql, { userId, personaKey: p.key, contest: weeklyContest, now }));
  }
  if (draftContest && new Date(draftContest.locks_at).getTime() > now.getTime()) {
    // A FIXED SEAT PER PERSONA, spread around the room, so the five are not
    // all drafting from the turn and their rosters differ for a reason a
    // reader can name.
    const seats = { chalk: 1, fade: 4, gut: 7, homer: 10 };
    await each('draft', (p, userId) => fileDraft(sql, {
      userId, personaKey: p.key, contest: draftContest, seat: seats[p.key] ?? 1,
    }));
  }
  return summary;
}

export { HOMER_TEAMS, currentWeekly, currentDraftContest, getSpreadHome };
