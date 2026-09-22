// lib/october/entry.js - the card against the database.
//
// THE DOOR IS THIN AND THE RULES ARE NOT HERE. Every refusal a save can
// produce is decided by lib/october/rules.js refuseReason(), so the sentence
// the card prints beside a greyed player and the sentence the server returns
// are the same sentence, produced by the same function. The only thing this
// file adds is the server clock and the reader's own burn list.
//
// THE PAYLOAD IS VIEWER-SCOPED. A reader's five and nobody else's; the board
// is a public schedule fact and the pool is public, but a lineup is not.

import { sql } from '../db.js';
import { SLOTS, refuseReason, cardProgress, dayState, nextLock, maxPerGame, DNF } from './rules.js';
import { scoreCard, boxFor } from './settle.js';
import { usedPlayers, octoberPool } from './pool.js';
import { RULES_LINE } from '../mlb/fantasyPoints.js';

/**
 * SAVE ONE SLOT. Save-on-change, the house pattern - there is no submit.
 *
 * THE SERVER CLOCK IS THE ONLY CLOCK. A client that believes a game has not
 * started does not get to pick from it; the lock is read off the board
 * SNAPSHOT against now(), which is the 067 law.
 */
export async function saveOctoberPick(userId, contestId, slot, player, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, settled, opens_at, season_year FROM contests
     WHERE id = ${contestId} AND game_type = 'october' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return { ok: false, reason: 'not_open' };

  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  // THE BURN LIST EXCLUDES TODAY'S OWN CARD, or replacing a pick would refuse
  // the player it is replacing as "used" - by the reader, an hour ago, here.
  const used = await usedPlayers(userId, contest.season_year, { excludeContestId: contestId });

  const reason = refuseReason(lineup, slot, player, { board: contest.board ?? [], used: new Set(used.keys()), now });
  if (reason) return { ok: false, reason, usedOn: reason === 'used' ? used.get(String(player.playerId)) : undefined };

  const patch = JSON.stringify({
    [slot]: { playerId: String(player.playerId), matchId: Number(player.matchId), kind: player.kind, name: player.name ?? null },
  });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now()`;
  return { ok: true, slot, playerId: String(player.playerId) };
}

/** Clear a slot. Same locks; an unlocked slot may be emptied before its game. */
export async function clearOctoberPick(userId, contestId, slot, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, settled FROM contests WHERE id = ${contestId} AND game_type = 'october' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (!SLOTS.includes(slot)) return { ok: false, reason: 'bad_slot' };
  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  if (!entry) return { ok: true, slot };
  const { lockedSlots } = await import('./rules.js');
  if (lockedSlots(entry.lineup ?? {}, contest.board ?? [], now).has(slot)) {
    return { ok: false, reason: 'slot_locked' };
  }
  await sql`
    UPDATE contest_entries SET lineup = lineup - ${slot}, updated_at = now()
     WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return { ok: true, slot };
}

/**
 * THE PICKING SCREEN and THE LIVE SCREEN are one read - the mock's own frames
 * 1 and 2 are the same card at two moments, and which one renders is a
 * function of how much of it is locked rather than of a different query.
 */
export async function octoberView(userId, contest, { now = new Date(), withPool = true } = {}) {
  if (!contest) return { phase: 'none', contest: null, slots: [], board: [] };
  const board = contest.board ?? [];
  const [entry] = userId == null ? [] : await sql`
    SELECT lineup, score, meta FROM contest_entries
     WHERE contest_id = ${contest.id} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};

  const [{ statBy, matchBy }, used, pool] = await Promise.all([
    boxFor(contest),
    usedPlayers(userId, contest.season_year, { excludeContestId: contest.id }),
    withPool ? octoberPool(contest).catch(() => null) : Promise.resolve(null),
  ]);

  const card = scoreCard(lineup, statBy, matchBy);
  const progress = cardProgress(lineup, board, now);
  const day = dayState(lineup, board, now);
  const next = nextLock(board, now);

  return {
    phase: contest.settled ? 'settled' : progress.open === 0 && progress.locked === progress.total ? 'locked' : 'open',
    contest: {
      id: contest.id, day: contest.puzzle_date, season: contest.season_year,
      stage: contest.meta?.stage ?? null, games: board.length,
      locksAt: contest.locks_at, settled: contest.settled,
      rules: RULES_LINE,
      // THE CAP IS THE DAY'S, and the card prints it, because it is the one
      // rule of this game that is not the same every day - ceil(5 / games),
      // so five is always reachable. A card that said "two from one game"
      // on a World Series night would be describing a rule that would make
      // it impossible to play.
      maxPerGame: maxPerGame(board),
    },
    board: board.map((g) => ({
      matchId: g.match_id, slug: g.slug, kickoffAt: g.kickoff_at,
      home: g.home, away: g.away, probables: g.probables ?? null,
      status: matchBy.get(String(g.match_id))?.status ?? 'scheduled',
      // A LIVE GAME IS UNPICKABLE AND THE MOCK DIMS IT - .gc.lk - rather than
      // removing it, because the reader may have a locked slot in it.
      pickable: new Date(g.kickoff_at).getTime() > new Date(now).getTime(),
    })),
    slots: card.slots.map((s, i) => ({
      ...s,
      pip: progress.pips[i],
      name: lineup?.[s.slot]?.name ?? null,
    })),
    progress,
    dayState: day.state,
    isDnf: day.state === DNF,
    total: card.total,
    nextLock: next ? {
      matchId: next.match_id, slug: next.slug, kickoffAt: next.kickoff_at,
      // COMPUTED HERE, ON THE SERVER, and shipped as a number. The card's
      // flip digits used to derive it with Date.now() during render, which is
      // impure twice over: the lint rule catches the re-render instability,
      // and hydration would have painted the server's minute and then the
      // client's. One reading, taken once, by the thing that already knows
      // what `now` is.
      msAway: Math.max(0, new Date(next.kickoff_at).getTime() - new Date(now).getTime()),
    } : null,
    // "used Sep 29" in the picker, and the pool bar's own numbers.
    used: Object.fromEntries(used),
    pool,
    score: entry?.score == null ? null : Number(entry.score),
  };
}
