// lib/run/entry.js - the nine against the database.
//
// THE DOOR IS THIN. Every refusal is lib/run/rules.js refuseReason()'s, so the
// sentence the card prints beside a greyed player and the sentence the server
// returns are produced by the same function. This file adds the server clock
// and the reader's own burn list, and nothing else.

import { sql } from '../db.js';
import { SLOTS, refuseReason, progress, rosterState, roundPips, isLocked, ROSTER_SIZE, DNF } from './rules.js';
import { scoreRoster, boxForRound, clubStateFrom } from './settle.js';
import { usedPlayers, runPool } from './pool.js';
import { RULES_LINE } from '../mlb/fantasyPoints.js';

/** Save one slot. Save-on-change; there is no submit. */
export async function saveRunPick(userId, contestId, slot, player, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, meta, settled, opens_at, season_year FROM contests
     WHERE id = ${contestId} AND game_type = 'run' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return { ok: false, reason: 'not_open' };

  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  // THE BURN LIST EXCLUDES THIS ROUND'S OWN ROSTER, or replacing a pick would
  // refuse the player it is replacing as "used" - by the reader, here.
  const used = await usedPlayers(userId, contest.season_year, { excludeContestId: contestId });

  const reason = refuseReason(lineup, slot, player, { board: runBoardOf(contest), used, now });
  if (reason) return { ok: false, reason, usedIn: reason === 'used' ? used.get(String(player.playerId)) : undefined };

  const patch = JSON.stringify({
    [slot]: {
      playerId: String(player.playerId), teamId: Number(player.teamId),
      kind: player.kind, name: player.name ?? null, team: player.team ?? null,
    },
  });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now()`;
  return { ok: true, slot, playerId: String(player.playerId) };
}

/** Clear a slot. The round's lock applies to clearing as well as to filling. */
export async function clearRunPick(userId, contestId, slot, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, meta, settled FROM contests WHERE id = ${contestId} AND game_type = 'run' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (!SLOTS.includes(slot)) return { ok: false, reason: 'bad_slot' };
  if (isLocked(runBoardOf(contest), now)) return { ok: false, reason: 'round_locked' };
  await sql`
    UPDATE contest_entries SET lineup = lineup - ${slot}, updated_at = now()
     WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return { ok: true, slot };
}

/**
 * THE SETTING SCREEN and THE LIVE SCREEN are one read - the mock's frames 1
 * and 2 are the same roster before and after the lock, and which one renders
 * is a function of the clock, not of a different query.
 */
/**
 * THE ROUND'S SHAPE, from the two columns it actually lives in. contests.board
 * is the ARRAY of clubs - it is an array for every game in this product and at
 * least one existing query calls jsonb_array_length on it - and everything
 * else is in meta. This is the one place that joins them back up.
 */
export function runBoardOf(contest) {
  return { ...(contest?.meta ?? {}), clubs: contest?.board ?? [] };
}

export async function runView(userId, contest, { now = new Date(), withPool = true } = {}) {
  if (!contest) return { phase: 'none', contest: null, slots: [], clubs: [] };
  const board = runBoardOf(contest);
  const round = board.round ?? null;

  const [entry] = userId == null ? [] : await sql`
    SELECT lineup, score, meta FROM contest_entries
     WHERE contest_id = ${contest.id} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};

  const { seriesFor } = await import('../mlb/series.js');
  const [rows, series, used, pool, done] = await Promise.all([
    boxForRound(contest),
    seriesFor(round, contest.season_year).catch(() => []),
    usedPlayers(userId, contest.season_year, { excludeContestId: contest.id }),
    withPool ? runPool(contest).catch(() => null) : Promise.resolve(null),
    (async () => (await import('./create.js')).settledRounds(contest.season_year))().catch(() => []),
  ]);

  const clubState = clubStateFrom(series, board.clubs ?? []);
  const card = scoreRoster(lineup, rows, clubState);
  const prog = progress(lineup, board, now);
  const state = rosterState(lineup, board, now);
  const aliveBy = new Map(clubState.map((c) => [String(c.teamId), c]));

  return {
    phase: contest.settled ? 'settled' : prog.locked ? 'live' : 'open',
    contest: {
      id: contest.id, season: contest.season_year, week: contest.week,
      round, label: board.label ?? null,
      locksAt: board.firstPitch, settled: contest.settled,
      rules: RULES_LINE, rosterSize: ROSTER_SIZE,
      // THE CLOCK'S READING IS TAKEN HERE, on the server. October learned
      // that the hard way: Date.now() during render is impure and hydrates to
      // a different minute than it painted.
      msToLock: board.firstPitch
        ? Math.max(0, new Date(board.firstPitch).getTime() - new Date(now).getTime())
        : null,
    },
    pips: roundPips(round, done),
    clubs: (board.clubs ?? []).map((c) => ({
      ...c,
      alive: c.bye ? null : (aliveBy.get(String(c.teamId))?.alive ?? true),
      gamesPlayed: aliveBy.get(String(c.teamId))?.gamesPlayed ?? 0,
    })),
    slots: card.slots.map((s) => ({ ...s, name: lineup?.[s.slot]?.name ?? null, team: lineup?.[s.slot]?.team ?? s.abbr })),
    progress: prog,
    rosterState: state.state,
    isDnf: state.state === DNF,
    total: card.total,
    aliveCount: card.alive,
    outCount: card.out,
    used: Object.fromEntries(used),
    pool,
    score: entry?.score == null ? null : Number(entry.score),
  };
}
