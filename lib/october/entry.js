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
import { SLOTS, refuseReason, cardProgress, dayState, nextLock, maxPerGame, effectiveKickoff, gameLabel, DNF } from './rules.js';
import { scoreCard, boxFor } from './settle.js';
import { octoberPool, startersOnly, notStarting } from './pool.js';
import { RULES_LINE } from '../mlb/fantasyPoints.js';

/** Is this contest the preview? One field, asked by everything. */
export const isPreview = (c) => c?.meta?.preview === true;

/**
 * SAVE ONE SLOT. Save-on-change, the house pattern - there is no submit.
 *
 * THE SERVER CLOCK IS THE ONLY CLOCK. A client that believes a game has not
 * started does not get to pick from it; the lock is read off the board
 * SNAPSHOT against now(), which is the 067 law.
 */
export async function saveOctoberPick(userId, contestId, slot, player, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, meta, settled, opens_at, season_year FROM contests
     WHERE id = ${contestId} AND game_type = 'october' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return { ok: false, reason: 'not_open' };

  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  // NO BURN LIST IS READ. October has no burn, so this door asks nothing about
  // any other day - see lib/october/rules.js's header for why the rule went.
  // THE DOOR NEEDS THE LIVE STATUSES TOO, or the only thing stopping a save into
  // a called-off game is a tile in a browser that may have rendered an hour ago.
  const ids = (contest.board ?? []).map((g) => g.match_id);
  const live = ids.length
    ? await sql`SELECT id, status, kickoff_at FROM matches WHERE id = ANY(${ids})`.catch(() => [])
    : [];
  const statusBy = new Map(live.map((m) => [String(m.id), m.status]));
  const kickoffBy = new Map(live.map((m) => [String(m.id), m.kickoff_at]));

  const reason = refuseReason(lineup, slot, player, {
    board: contest.board ?? [], now, statusBy, kickoffBy,
  });
  if (reason) return { ok: false, reason };

  const patch = JSON.stringify({
    // THE CLUB RIDES ALONG. The slot's own sub-line reads s.team (it printed
    // nothing but a kickoff time until now, because nothing ever wrote one),
    // and the starters check answers from one side's card instead of needing
    // both posted when it knows whose bat this is.
    [slot]: {
      playerId: String(player.playerId), matchId: Number(player.matchId),
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

  const [{ statBy, matchBy }, pool] = await Promise.all([
    boxFor(contest),
    withPool ? octoberPool(contest).catch(() => null) : Promise.resolve(null),
  ]);

  // THE LIVE STATUS AND THE LIVE FIRST PITCH, both off the row boxFor already
  // read. The board is a frozen snapshot with no status on it at all, so every
  // rule that has to know a game was called off is handed these two maps.
  const statusBy = new Map([...matchBy].map(([k, m]) => [k, m?.status ?? null]));
  const kickoffBy = new Map([...matchBy].map(([k, m]) => [k, m?.kickoff_at ?? null]));

  const card = scoreCard(lineup, statBy, matchBy);
  const progress = cardProgress(lineup, board, now, { kickoffBy });
  // THE STARTERS OVERLAY. The cached pool is every active player on both clubs;
  // what the panel offers is the probable and the posted batting order, cut
  // down HERE because a lineup moves all afternoon and the pool is built once.
  const starters = startersFor(board, pool, matchBy);
  const day = dayState(lineup, board, now, { statusBy, kickoffBy });
  const next = nextLock(board, now, { statusBy, kickoffBy });

  return {
    phase: contest.settled ? 'settled' : progress.open === 0 && progress.locked === progress.total ? 'locked' : 'open',
    contest: {
      id: contest.id, day: contest.puzzle_date, season: contest.season_year,
      stage: contest.meta?.stage ?? null, games: board.length,
      locksAt: contest.locks_at, settled: contest.settled,
      preview: isPreview(contest),
      seasonLabel: contest.meta?.season_label ?? null,
      rules: RULES_LINE,
      // THE CAP IS THE DAY'S, and the card prints it, because it is the one
      // rule of this game that is not the same every day - ceil(5 / games),
      // so five is always reachable. A card that said "two from one game"
      // on a World Series night would be describing a rule that would make
      // it impossible to play.
      maxPerGame: maxPerGame(board),
    },
    board: board.map((g) => ({
      matchId: g.match_id, slug: g.slug,
      home: g.home, away: g.away, probables: g.probables ?? null,
      // WHOSE CARD IS UP. The panel says "lineup not posted yet" off this, and
      // it is per SIDE because one club posts before the other every day.
      lineupPosted: starters.posted[String(g.match_id)] ?? { away: false, home: false },
      status: matchBy.get(String(g.match_id))?.status ?? 'scheduled',
      // A LIVE GAME IS UNPICKABLE AND THE MOCK DIMS IT - .gc.lk - rather than
      // removing it, because the reader may have a locked slot in it.
      // THE FIRST PITCH THE CARD PRINTS is the live one when a game has moved
      // LATER - a board entry frozen in the past can never be picked from
      // again, which is how a postponement became permanent.
      kickoffAt: new Date(effectiveKickoff(
        g.kickoff_at, matchBy.get(String(g.match_id))?.kickoff_at ?? null,
      )).toISOString(),
      // A LIVE GAME IS UNPICKABLE AND THE MOCK DIMS IT - .gc.lk - rather than
      // removing it, because the reader may have a locked slot in it. SO IS A
      // POSTPONED ONE, and it stays that way until it is RESCHEDULED: at that
      // point its status is 'scheduled' again and its new first pitch is in the
      // future, so both halves of this test pass on their own.
      pickable: (matchBy.get(String(g.match_id))?.status ?? 'scheduled') === 'scheduled'
        && effectiveKickoff(g.kickoff_at, matchBy.get(String(g.match_id))?.kickoff_at ?? null)
           > new Date(now).getTime(),
    })),
    slots: card.slots.map((s, i) => ({
      ...s,
      pip: progress.pips[i],
      name: lineup?.[s.slot]?.name ?? null,
      team: lineup?.[s.slot]?.team ?? null,
      // "NOT STARTING - SWAP", and only while the reader can still act on it.
      // Decided on the server, from the posted card, for both games - see
      // notStarting() in pool.js.
      notStarting: s.slot === 'arm' ? false : notStarting(
        { ...(lineup?.[s.slot] ?? {}) },
        {
          lineup: matchBy.get(String(lineup?.[s.slot]?.matchId))?.lineups ?? null,
          awayAbbr: sideAbbr(board, lineup?.[s.slot]?.matchId, 'away'),
          homeAbbr: sideAbbr(board, lineup?.[s.slot]?.matchId, 'home'),
          locked: progress.pips[i] === 'locked',
        },
      ),
    })),
    progress,
    dayState: day.state,
    isDnf: day.state === DNF,
    total: card.total,
    nextLock: next ? {
      matchId: next.match_id, slug: next.slug, kickoffAt: next.kickoff_at,
      // THE LABEL A READER CAN READ - "MIN @ SF · G2", never the slug. The card
      // used to print next.slug.toUpperCase(), which put
      // MLB-2026-09-23-MIN-SF-G2 in the header.
      label: gameLabel(next),
      // COMPUTED HERE, ON THE SERVER, and shipped as a number. The card's
      // flip digits used to derive it with Date.now() during render, which is
      // impure twice over: the lint rule catches the re-render instability,
      // and hydration would have painted the server's minute and then the
      // client's. One reading, taken once, by the thing that already knows
      // what `now` is.
      msAway: Math.max(0, new Date(next.kickoff_at).getTime() - new Date(now).getTime()),
    } : null,
    // TODAY'S BEST: the best SETTLED slot on this card, which is what the
    // header's right-hand stat became when the burn count left it.
    //
    // PER SLOT, BECAUSE OCTOBER IS PER SLOT. A day's leading TOTAL would have
    // been the other candidate and it cannot be had: contest_entries.score is
    // written by settleOctoberDay and stays NULL until every game on the board is
    // final, so a field leader would be blank all evening and then appear once,
    // after the last west-coast out. This moves when the reader's own slots do -
    // null until one of them is final, and then the best number on the card.
    todaysBest: bestSettledSlot(card.slots),
    pool: starters.pool ?? pool,
    score: entry?.score == null ? null : Number(entry.score),
  };
}

/**
 * The highest points among SETTLED slots, or null when none has settled. PURE.
 *
 * A SETTLED SLOT CAN SCORE 0 and that is a real number - a bat who went 0-for-4
 * in a finished game. So this asks whether the slot is final, never whether its
 * points are truthy.
 */
function bestSettledSlot(slots = []) {
  const done = (slots ?? []).filter((s) => s?.state === 'final' && s?.points != null);
  return done.length ? Math.max(...done.map((s) => Number(s.points))) : null;
}

/** One side's abbreviation off the frozen board. PURE. */
function sideAbbr(board = [], matchId, side) {
  const g = board.find((x) => String(x.match_id) === String(matchId));
  return g?.[side]?.abbr ?? null;
}

/**
 * The pool, cut to starters, game by game - and which sides have posted.
 *
 * IT RETURNS THE WHOLE POOL SHAPE, not a patch, because the card reads
 * view.pool.byGame[matchId] and nothing else. A caller that had to merge an
 * overlay into the pool at render time would be a second place that knows this
 * shape.
 *
 * A POOL THAT FAILED TO BUILD IS STILL A NULL POOL. The overlay does not invent
 * one: "the pool for this game is still building" is the card's own sentence for
 * that and it is true.
 */
function startersFor(board = [], pool = null, matchBy = new Map()) {
  const posted = {};
  if (!pool?.byGame) {
    for (const g of board) posted[String(g.match_id)] = { away: false, home: false };
    return { pool, posted };
  }
  const byGame = {};
  for (const g of board) {
    const key = String(g.match_id);
    const rows = pool.byGame[key] ?? [];
    const cut = startersOnly(rows, {
      lineup: matchBy.get(key)?.lineups ?? null,
      // THE LIVE PROBABLES WIN OVER THE BOARD'S FROZEN PAIR, and fall back to
      // them: an announced starter reaches the picker on the pass that found
      // him, not on tomorrow's pool build.
      probables: matchBy.get(key)?.probables ?? g.probables ?? null,
      awayAbbr: g.away?.abbr ?? null,
      homeAbbr: g.home?.abbr ?? null,
    });
    byGame[key] = cut.rows;
    posted[key] = cut.posted;
  }
  return { pool: { ...pool, byGame }, posted };
}
