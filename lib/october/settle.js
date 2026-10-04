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
import { voidReadiness, pastVoidCutoff, storedVoid, closeVoidAll } from '../settle/voidRule.js';

/**
 * Statuses that mean "this match will not be played" (thu-26, the same pair
 * lib/october/rules.js isNotPlayedGame names). They never held a day; under
 * the void rule they are void at once and land in the stored void list.
 */
const NOT_PLAYED = new Set(['cancelled', 'not_needed']);

/**
 * A POSTPONED GAME NEVER REPLAYED IS VOID (ruling 27 Sep). A rescheduled game
 * goes back to 'scheduled' with a new first pitch (lib/october/entry.js's
 * pickable note), so one still 'postponed' this long after its original first
 * pitch was never given a date - TOR @ BAL, 22 Sep 2026, held its day open for
 * five days with no makeup coming. A void game no longer holds its day, and a
 * slot on it scores what a player who never played scores: nothing.
 */
export const VOID_AFTER_HOURS = 72;
export function isVoidGame(match, now = new Date()) {
  if (match?.status !== 'postponed') return false;
  const ko = new Date(match.kickoff_at ?? NaN).getTime();
  return Number.isFinite(ko) && new Date(now).getTime() - ko > VOID_AFTER_HOURS * 3600e3;
}

/**
 * One entry's five slots against the box score. PURE.
 *
 * @param lineup   { slot: { playerId, matchId } }
 * @param statBy   Map(`${matchId}:${playerId}` -> mlb_player_game_stats row)
 * @param matchBy  Map(matchId -> { status })
 */
export function scoreCard(lineup = {}, statBy = new Map(), matchBy = new Map(), { voidIds = null } = {}) {
  const slots = SLOTS.map((slot) => {
    const pick = lineup?.[slot] ?? null;
    if (!pick?.playerId) return { slot, state: 'empty', points: null, line: null };
    // A VOID GAME'S PLAYER SCORES 0 (ruling sun-8 item 1), whatever half-game
    // of stat lines it may carry. Only the settle passes voidIds.
    if (voidIds?.has(Number(pick.matchId))) {
      return { slot, playerId: pick.playerId, matchId: pick.matchId, state: 'void', points: 0, line: null };
    }
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
    // metadata->'lineups' RIDES THIS QUERY rather than getting its own. The
    // card needs the posted batting order for exactly the matches it already
    // reads a status for, and a second round trip for a sibling key on the same
    // row is a round trip for nothing.
    // AND metadata->'probables' WITH IT. The board's frozen probables are a
    // day old by the afternoon; the poller refreshes these on the pre-kick pass
    // and the card prefers them, so a starter announced at 4pm is offered at
    // 4pm. Same row, same round trip.
    // kickoff_at RIDES ALONG TOO. A postponed game that is rescheduled gets a
    // NEW first pitch, and the board's frozen one is then a time in the past
    // that no lock can ever be waiting for - see effectiveKickoff().
    sql`SELECT id, status, kickoff_at, metadata->'lineups' AS lineups, metadata->'probables' AS probables
          FROM matches WHERE id = ANY(${ids})`,
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
 * and refuses otherwise.
 *
 * UNTIL settles_at + 48h (ruling sun-8 item 1, lib/settle/voidRule.js). At
 * that cutoff every game still not final is VOID - its players score 0 and
 * the day settles on the rest. Before it, three kinds of game are void
 * already: cancelled and not_needed (never held a day, thu-26) and a
 * postponement 72h past its first pitch (27 Sep). A day whose every game is
 * void still refuses. The void list is stored in meta.void and never undone.
 */
export async function settleOctoberDay(contest, { now = new Date() } = {}) {
  if (contest.settles_at === undefined || contest.meta === undefined) {
    const [row] = await sql`SELECT settles_at, meta FROM contests WHERE id = ${contest.id}`;
    contest = { ...contest,
      settles_at: contest.settles_at === undefined ? (row?.settles_at ?? null) : contest.settles_at,
      meta: contest.meta === undefined ? (row?.meta ?? null) : contest.meta };
  }
  const board = contest.board ?? [];
  const { statBy, matchBy } = await boxFor(contest);
  const games = board.map((g) => {
    const m = matchBy.get(String(g.match_id)) ?? null;
    return { id: Number(g.match_id), slug: g.slug, status: m?.status ?? 'scheduled', match: m };
  });
  const gate = voidReadiness(games, {
    voidAllowed: pastVoidCutoff(contest, now),
    stored: storedVoid(contest),
    voidNow: (g) => NOT_PLAYED.has(g.status) || isVoidGame(g.match, now),
  });
  if (!gate.ready) {
    if (gate.reason === 'every game void') {
      // CLOSED AS VOID (ruling sun-10 item 4): settled, meta.void_all, no
      // scores, no DNF, no streak day, no settle push.
      const { closed, void: ids } = await closeVoidAll(sql, contest.id, gate.void);
      return { contestId: contest.id, settled: false, voidAll: true, closed, void: ids };
    }
    return {
      contestId: contest.id, settled: false, remaining: gate.remaining,
      // NAMED, because a postponed game can hold a day open for days and a
      // bare count would look like a stuck job.
      waitingOn: gate.waitingOn.map((g) => ({ slug: g.slug, status: g.status })),
    };
  }
  const voidIds = new Set(gate.void.map(Number));
  const voided = games.filter((g) => voidIds.has(g.id)).map((g) => g.slug);

  const entries = await sql`
    SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${contest.id}`;
  let dnf = 0;
  for (const e of entries) {
    const state = dayState(e.lineup ?? {}, board, now).state;
    const card = scoreCard(e.lineup ?? {}, statBy, matchBy, { voidIds });
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
  // perfect.void keeps the slugs it always carried; meta.void is the rule's
  // stored list of match ids. meta is replaced at its top-level 'void' key
  // only, and only when it is an object (never `||` onto an array).
  const voidList = [...voidIds].sort((a, b) => a - b);
  await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           perfect = ${JSON.stringify({ max: null, games: board.length, void: voided })}::jsonb,
           meta = CASE WHEN ${voidList.length > 0}
                            AND jsonb_typeof(COALESCE(meta, '{}'::jsonb)) = 'object'
                       THEN COALESCE(meta, '{}'::jsonb)
                            || jsonb_build_object('void', ${JSON.stringify(voidList)}::jsonb)
                       ELSE meta END
     WHERE id = ${contest.id} AND NOT settled`;
  return { contestId: contest.id, settled: true, entries: entries.length, dnf, void: voided, voidIds: voidList };
}

/** Every due October day. Mirrors settleDuePickem's shape. */
export async function settleDueOctober({ now = new Date() } = {}) {
  const due = await sql`
    SELECT id, board, meta, puzzle_date, season_year, settles_at FROM contests
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
  const counted = days.filter((d) => d.settled
    // AN ALL-VOID CLOSE IS NOT A PLAYED OR MISSED DAY (ruling sun-10 item 4).
    && !(d.voidAll === true || d.meta?.void_all === true));
  return {
    total: round1(counted.reduce((a, d) => a + (d.state === DNF ? 0 : (Number(d.points) || 0)), 0)),
    days: counted.length,
    dnf: counted.filter((d) => d.state === DNF).length,
  };
}
