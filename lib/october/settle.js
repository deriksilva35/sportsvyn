// lib/october/settle.js - points land as the box score does.
//
// PER SLOT, NOT PER DAY. The mock's live screen shows one slot FINAL, two
// LIVE and two waiting on a first pitch, all at once - so a slot settles when
// ITS game goes final and the day settles when all five have. A day-level
// "every game final" gate would leave the whole card grey until the last
// west-coast game ended, which is four hours after the reader's first three
// slots stopped moving.
//
// A RAIN-POSTPONED GAME CARRIES THE SLOT, IT DOES NOT LOSE IT. The slot points
// at a MATCH, not at a date; if that match is played three days later the slot
// settles three days later and scores exactly what it would have. That falls
// out of settling per match rather than per day - there is no special case
// below, and that is the point. What it costs is that the day stays open until
// the makeup is played, which is the honest answer: the card is not finished.
//
// A DNF IS NOT A ZERO. It scores 0 in the October total and is SHOWN as DNF,
// because a day you did not field a card is a different fact from a day you
// played badly, and the board has to be able to say which.

import { sql } from '../db.js';
import { SLOTS, CARD_SIZE, DNF, dayState } from './rules.js';
import { slotPoints, batLine, armLine, round1 } from '../mlb/fantasyPoints.js';

/** Statuses that mean "this match will still be played". */
const PENDING = new Set(['scheduled', 'live', 'postponed']);

/**
 * One entry's five slots against the box score. PURE.
 *
 * @param lineup   { slot: { playerId, matchId } }
 * @param statBy   Map(`${matchId}:${playerId}` -> mlb_player_game_stats row)
 * @param matchBy  Map(matchId -> { status })
 */
export function scoreCard(lineup = {}, statBy = new Map(), matchBy = new Map()) {
  const slots = SLOTS.map((slot) => {
    const pick = lineup?.[slot] ?? null;
    if (!pick?.playerId) return { slot, state: 'empty', points: null, line: null };
    const match = matchBy.get(String(pick.matchId)) ?? null;
    const row = statBy.get(`${pick.matchId}:${pick.playerId}`) ?? null;
    const final = match?.status === 'final';
    const points = row ? slotPoints(slot, row) : (final ? 0 : null);
    return {
      slot,
      playerId: pick.playerId,
      matchId: pick.matchId,
      // A PLAYER WHO DID NOT APPEAR IN A FINISHED GAME SCORES 0, not null.
      // The bench is a risk the picker took; "no line yet" is a different
      // thing and only true while the game is unfinished.
      state: final ? 'final' : match?.status === 'live' ? 'live' : 'pending',
      points,
      line: slot === 'arm' ? armLine(row) : batLine(row),
    };
  });
  const settled = slots.filter((s) => s.state === 'final' && s.points != null).length;
  const filled = slots.filter((s) => s.state !== 'empty').length;
  const total = round1(slots.reduce((a, s) => a + (s.points ?? 0), 0));
  return {
    slots, total, settled, filled,
    // EVERY SLOT FINAL, which a postponed match cannot satisfy - so the day
    // waits for the makeup rather than settling without it.
    complete: filled === CARD_SIZE && settled === CARD_SIZE,
  };
}

/** Everything one contest's entries need, read once. */
export async function boxFor(contest) {
  const ids = (contest.board ?? []).map((g) => g.match_id);
  if (!ids.length) return { statBy: new Map(), matchBy: new Map() };
  // THE BOX SCORE IS AN ENRICHMENT, NOT THE PAGE. No stat rows is a real and
  // common state - every card before first pitch is in it - so a failure to
  // read them degrades to "no lines yet" rather than taking the card down.
  // It took the card down once: on a database without migration 110 the throw
  // propagated to the route, whose catch rendered "October has not started",
  // which is a lie about the season rather than an error about a table.
  const [stats, matches] = await Promise.all([
    sql`SELECT match_id, bdl_player_id, at_bats, hits, doubles, triples, home_runs,
               rbi, runs, walks, stolen_bases,
               outs_recorded, strikeouts_pitched, wins, earned_runs, hits_allowed, walks_allowed
          FROM mlb_player_game_stats WHERE match_id = ANY(${ids})`.catch(() => []),
    sql`SELECT id, status FROM matches WHERE id = ANY(${ids})`,
  ]);
  return {
    statBy: new Map(stats.map((r) => [`${r.match_id}:${r.bdl_player_id}`, r])),
    matchBy: new Map(matches.map((r) => [String(r.id), r])),
  };
}

/**
 * Settle one day. Idempotent: a settled contest is excluded by the caller's
 * WHERE, and the write flips `settled` in the same statement that stamps it.
 *
 * THE GATE IS THE CARDS, NOT THE CLOCK. A day settles when every match on its
 * board is final - which is what makes every entry's five slots scoreable -
 * and refuses otherwise. settles_at is advisory, the house convention.
 */
export async function settleOctoberDay(contest, { now = new Date() } = {}) {
  const board = contest.board ?? [];
  const { statBy, matchBy } = await boxFor(contest);
  const pending = board.filter((g) => PENDING.has(matchBy.get(String(g.match_id))?.status ?? 'scheduled'));
  if (pending.length) {
    return {
      contestId: contest.id, settled: false, remaining: pending.length,
      // NAMED, because a postponed game can hold a day open for days and a
      // bare count would look like a stuck job.
      waitingOn: pending.map((g) => ({ slug: g.slug, status: matchBy.get(String(g.match_id))?.status ?? 'scheduled' })),
    };
  }

  const entries = await sql`
    SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${contest.id}`;
  let dnf = 0;
  for (const e of entries) {
    const state = dayState(e.lineup ?? {}, board, now).state;
    const card = scoreCard(e.lineup ?? {}, statBy, matchBy);
    // A DNF SCORES 0 AND SAYS SO. The meta carries the reason; the score
    // column carries the number the October total sums.
    const points = state === DNF ? 0 : card.total;
    if (state === DNF) dnf += 1;
    await sql`
      UPDATE contest_entries
         SET score = ${points}, base_score = ${points},
             meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({
    october: { state, filled: card.filled, raw: card.total },
  })}::jsonb,
             locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${e.id}`;
  }
  await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           perfect = ${JSON.stringify({ max: null, games: board.length })}::jsonb
     WHERE id = ${contest.id} AND NOT settled`;
  return { contestId: contest.id, settled: true, entries: entries.length, dnf };
}

/** Every due October day. Mirrors settleDuePickem's shape. */
export async function settleDueOctober({ now = new Date() } = {}) {
  const due = await sql`
    SELECT id, board, puzzle_date, season_year FROM contests
     WHERE game_type = 'october' AND sport = 'mlb' AND NOT settled
       AND opens_at <= ${new Date(now).toISOString()}
     ORDER BY puzzle_date ASC`;
  const out = [];
  for (const c of due) {
    try { out.push(await settleOctoberDay(c, { now })); }
    catch (err) { out.push({ contestId: c.id, error: String(err?.message ?? err) }); }
  }
  return { due: due.length, results: out };
}

/**
 * THE OCTOBER TOTAL: the sum of a reader's settled days.
 *
 * A DNF DAY IS 0 IN THE TOTAL AND SHOWN AS DNF - both, which is why this
 * returns the days as well as the number. The mock's board prints "DNF" in
 * the delta column of a house row whose total is still 187.0.
 */
export function octoberTotal(days = []) {
  const counted = days.filter((d) => d.settled);
  return {
    total: round1(counted.reduce((a, d) => a + (d.state === DNF ? 0 : (Number(d.points) || 0)), 0)),
    days: counted.length,
    dnf: counted.filter((d) => d.state === DNF).length,
  };
}
