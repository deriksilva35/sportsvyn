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
import { pickRun } from './pickRun.js';
import { seatStrategyFor } from './pickDraft.js';
import { slotsOf } from '../daily/boardShape.js';
import { startRun, submitRun } from '../daily/seasonBoardRuns.js';
import { savePick } from '../pickem/entry.js';
import { saveLineup, currentContest as currentWeekly } from '../weekly/entries.js';
import { saveRunPick, runBoardOf, isRunPreview } from '../run/entry.js';
import { runPool, roundMatches, roundGames } from '../run/pool.js';
import { usedPlayers as runUsedPlayers } from '../run/pool.js';
import { SLOTS as RUN_SLOTS, ROSTER_SIZE as RUN_ROSTER } from '../run/rules.js';
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

/**
 * THE HOMER'S TEAM IDS FOR ONE SPORT. Its clubs are NFL abbreviations, so on a
 * CFB board it has no team in the fight and picks nothing - which is the right
 * answer, not a gap: a homer with no dog in a game does not have an opinion
 * about it, and its method line already says it takes its own teams.
 */
function homerIdsFor(sport, ids) {
  if (Array.isArray(ids)) return sport === 'nfl' ? ids : [];
  return ids?.[sport] ?? [];
}

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
    boardId: board.id, userId, picks, elapsedS: 0, slots: slotsOf(board), now,
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
// THE RUN - a league that is too small to be a league
// ---------------------------------------------------------------------------

/** Below this, a league board is a list and not a contest. */
export const RUN_LEAGUE_FLOOR = 6;

/**
 * DOES THIS LEAGUE NEED THE HOUSE? PURE, and separate from the filing so the
 * rule can be read without a database.
 *
 * THE HOUSE FILLS UP TO THE FLOOR, NOT BEYOND IT. Three real players get three
 * personas; five get one; six or more get none. A league that is already a
 * contest does not want three more rows it cannot beat, and a house entry
 * added to a full league is padding - which is the thing lib/house/personas.js
 * opens by saying these are not.
 *
 * AND IT NEVER COUNTS ITSELF. Personas already in the league are members; if
 * they were counted as humans, a league of two humans and three personas would
 * look full and the next human to join would tip it over the floor with no
 * one noticing the board was mostly us.
 */
export function housesNeeded(memberIds = [], houseIds = new Set()) {
  const humans = (memberIds ?? []).filter((id) => !houseIds.has(Number(id))).length;
  const already = (memberIds ?? []).filter((id) => houseIds.has(Number(id))).length;
  return Math.max(0, RUN_LEAGUE_FLOOR - humans - already);
}

/**
 * File one persona's nine for one round.
 *
 * IT PLAYS THE SAME RULES. Every pick goes through saveRunPick, which is the
 * same door a reader's tap goes through - so the house cannot exceed three
 * from a club, pick a bye club, re-use a burned player or touch a locked
 * round. A persona with its own relaxed path would not be playing the game.
 *
 * PICK BY PICK, NOT AS A LINEUP, and that is why: the cap and the burn are
 * evaluated against the roster AS IT STANDS, so the only way to be sure the
 * nine it files are legal is to file them the way a person would.
 */
export async function fileRun(sql, { userId, personaKey, contest, now = new Date() }) {
  if (!playsGame(personaKey, 'run')) return skip('no method on this game');

  const board = runBoardOf(contest);
  const pool = await runPool(contest).catch(() => null);
  const flat = Object.values(pool?.byClub ?? {}).flat();
  if (!flat.length) return skip('no pool yet');

  // THE BURN IS READ ON THE ROUND'S OWN SIDE OF THE PREVIEW LINE - the same
  // scope saveRunPick reads. Without it the house read the postseason's burn
  // while filing a preview, picked players it had already spent in another
  // preview round, and the door refused them as 'used' (24 Sep: two personas
  // refused at arm1 on rounds 25 and 26, and the Gut filed 8 of 9).
  const used = await runUsedPlayers(userId, contest.season_year, {
    excludeContestId: contest.id, preview: isRunPreview(contest),
  });
  // THE ROUND'S GAMES, so the picker sees the same club locks the door does and
  // never reaches for a club that has already started.
  const games = roundGames(await roundMatches(contest).catch(() => []));
  const lineup = pickRun(personaKey, flat, { board, used, now, games }, seedFor(personaKey, contest.id));
  if (!lineup) return skip('no method on this game');
  if (!Object.keys(lineup).length) return skip('no eligible players');

  let filed = 0;
  const refused = [];
  for (const slot of RUN_SLOTS) {
    const p = lineup[slot];
    if (!p) continue;
    const r = await saveRunPick(userId, contest.id, slot, {
      playerId: p.playerId, teamId: p.teamId, kind: p.kind, name: p.name, team: p.team,
    }, { now });
    if (r.ok) { filed += 1; continue; }
    // A CLUB THAT STARTED IS ONE REFUSED SLOT, NOT A STOP. The lock is the
    // club's, so a pick that went late between choosing and filing says
    // nothing about the other eight - October's posture, now the Run's too.
    if (r.reason === 'game_started') { refused.push({ slot, reason: r.reason }); continue; }
    return { ok: false, reason: r.reason, slot };
  }
  // A SHORT NINE IS FILED SHORT, and its empty slots DNF at the round's end.
  // The house takes the same consequence a reader does rather than being
  // handed a pool nobody else has.
  return ok({ filed, of: RUN_ROSTER, short: filed < RUN_ROSTER, ...(refused.length ? { refused } : {}) });
}

/**
 * EVERY PERSONA'S NINE ON A ROUND THAT HAS JUST OPENED. Called by the Run's
 * openers - ensureRunRound (the run-settle cron's opener) and
 * ensureRunPreviewDay - on a real create only, the way ensureOctoberDay files
 * October's house at day creation. No hand-run filing, no cron window.
 *
 * ONE PERSONA'S BAD ROUND COSTS ONLY ITS OWN ENTRY.
 */
export async function fileRunRound(contest, { now = new Date() } = {}) {
  if (!contest?.id) return { filed: {}, reason: 'no contest' };
  const sql = (await import('../db.js')).sql;
  const { byKey } = await ensureHouseAccounts(sql);
  const out = {};
  for (const p of PERSONAS) {
    if (!playsGame(p.key, 'run')) { out[p.key] = { skipped: 'does not play' }; continue; }
    try {
      out[p.key] = await fileRun(sql, { userId: byKey.get(p.key), personaKey: p.key, contest, now });
    } catch (e) {
      out[p.key] = { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
    }
  }
  return { filed: out };
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
  pickemBoards = [],           // every board still pickable, both sports
  weeklyContest = null,
  draftContest = null,
  spreadsByBoard = new Map(),  // contestId -> Map(matchId -> signed spread)
  homerTeamIds = [],           // {nfl: [...], cfb: [...]} or a flat nfl list
} = {}) {
  const { byKey, created, repaired } = await ensureHouseAccounts(sql);
  const summary = { created, repaired, games: {} };

  // `label` is what the summary is keyed by and `game` is what decides whether
  // a persona plays at all - they differ only for pickem, where one game type
  // has several boards and each wants its own line in the report.
  const each = async (label, fn, game = null) => {
    const kind = game ?? label;
    const out = {};
    for (const p of PERSONAS) {
      if (!playsGame(p.key, kind)) { out[p.key] = { skipped: 'does not play' }; continue; }
      try { out[p.key] = await fn(p, byKey.get(p.key)); } catch (e) {
        out[p.key] = { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
      }
    }
    summary.games[label] = out;
  };

  if (openDailyBoard) {
    await each('daily', (p, userId) => fileDaily(sql, { userId, personaKey: p.key, board: openDailyBoard, now: dailyNow }));
  }
  // EVERY OPEN BOARD, NOT THE ONE A PAGE WOULD LEAD WITH. On 15 Sep the tick
  // read currentPickemBoard, got the NFL board, and left the CFB board beside
  // it - 22 games, its own season's week 38 - with no house rows at all.
  //
  // NOTHING HERE KEYS ON A WEEK NUMBER. The two sports count their seasons
  // separately, so "the week's boards" is whatever is open, not whatever
  // matches the NFL's number.
  //
  // PER BOARD, INDEPENDENTLY: a persona that files 16 on one and 4 on the
  // other has done its job on both, and a board that refuses a pick must not
  // stop the next board from being filed.
  for (const board of pickemBoards ?? []) {
    await each(`pickem:${board.sport}:${board.id}`, (p, userId) => filePickem(sql, {
      userId, personaKey: p.key, contest: board,
      spreads: spreadsByBoard.get(board.id) ?? new Map(),
      homerTeamIds: homerIdsFor(board.sport, homerTeamIds),
      now,
    }), 'pickem');
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
