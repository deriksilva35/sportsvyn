// lib/six/entry.js - the card against the database.
//
// THE DOOR IS THIN AND THE RULES ARE NOT HERE. Every refusal a save can return
// is lib/six/rules.js refuseReason(), handed the CURRENT tips and statuses this
// file reads from matches in the same request - never the board snapshot's.
//
// THE SERVER DOES NOT TRUST THE CLIENT'S PLAYER. A save names a player id and
// a game; position, team and name are looked up in the night's own pool. A
// client that claimed a centre was a guard, or that a third Warrior was a
// Rocket, gets the pool's answer, not its own.

import { sql } from '../db.js';
import {
  SLOTS, SLOT_POS, refuseReason, clearReason, cardProgress, nightState, nextLock,
  teamCap, gameLocked, gameLabel, isVoidStatus, tipOf,
} from './rules.js';
import { scoreCard, rankable } from './score.js';
import { boxFor } from './settle.js';
import { sixPool, withInjuries, outIdsOf } from './pool.js';
import { liveRows, lockMaps, GAME_TYPE } from './night.js';
import { RULES_LINE } from '../nba/fantasyPoints.js';
import { dayLabel } from '../nba/dayRules.js';
import { rankRows, boardView } from '../boards/view.js';
import { shortOf, BASKETBALL } from '../live/vocabulary.js';

async function contestRow(contestId) {
  const [c] = await sql`
    SELECT id, board, meta, settled, opens_at, season_year FROM contests
     WHERE id = ${contestId} AND game_type = ${GAME_TYPE} LIMIT 1`;
  return c ?? null;
}

const findInPool = (pool, matchId, playerId) =>
  (pool?.byGame?.[String(matchId)] ?? []).find((r) => String(r.playerId) === String(playerId)) ?? null;

/**
 * SAVE ONE SLOT. Save-on-change; there is no submit. THE SERVER CLOCK IS THE
 * ONLY CLOCK, and the tip it locks on is the one it just read.
 */
export async function saveSixPick(userId, contestId, slot, pick, { now = new Date() } = {}) {
  const contest = await contestRow(contestId);
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (new Date(contest.opens_at).getTime() > new Date(now).getTime()) return { ok: false, reason: 'not_open' };

  const board = contest.board ?? [];
  const pool = await sixPool(contest).catch(() => null);
  const row = findInPool(pool, pick?.matchId, pick?.playerId);
  if (!row) return { ok: false, reason: 'not_in_pool' };

  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  // THE CURRENT TIPS AND STATUSES, read now, for every game on the night: the
  // lock is per game and the cap counts across the night.
  const { statusBy, kickoffBy } = lockMaps(await liveRows(board));
  const reason = refuseReason(lineup, slot, row, {
    board, now, statusBy, kickoffBy, outIds: outIdsOf(contest.meta?.injuries),
  });
  if (reason) return { ok: false, reason };

  // A WHOLE SLOT OBJECT under a top-level key: the shallow || replaces exactly
  // that slot and nothing beside it.
  const patch = JSON.stringify({
    [slot]: {
      playerId: row.playerId, matchId: Number(row.matchId), teamId: Number(row.teamId),
      position: row.position, name: row.short ?? row.name, team: row.team, opp: row.opp,
      picked_at: new Date(now).toISOString(),
    },
  });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now()`;
  return { ok: true, slot, playerId: row.playerId };
}

/** Clear a slot - a pre-tip swap's first half. Refused once the slot is sealed. */
export async function clearSixPick(userId, contestId, slot, { now = new Date() } = {}) {
  const contest = await contestRow(contestId);
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (!SLOTS.includes(slot)) return { ok: false, reason: 'bad_slot' };
  const [entry] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  if (!entry) return { ok: true, slot };
  const { statusBy, kickoffBy } = lockMaps(await liveRows(contest.board ?? []));
  const reason = clearReason(entry.lineup ?? {}, slot, { board: contest.board ?? [], now, statusBy, kickoffBy });
  if (reason) return { ok: false, reason };
  await sql`
    UPDATE contest_entries SET lineup = lineup - ${slot}::text, updated_at = now()
     WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return { ok: true, slot };
}

/** "Q3 5:12", "Half", "OT 0:41" - a live game's chip. PURE. */
export function liveChip(ls) {
  if (!ls) return 'LIVE';
  const s = shortOf(ls, BASKETBALL);
  if (!s) return 'LIVE';
  if (s === 'HALF' || s === 'Half') return 'Half';
  // "Q4 · 2:31": a bare space between the period and the clock read as one
  // number ("Q42:31") in the arcade mono face on the served card.
  return ls.clock ? `${s} · ${ls.clock}` : s;
}

/**
 * THE NATIONAL BOARD for one night: every entry, ranked. Settled nights read
 * the settle's numbers; an open night scores every card live off the box.
 */
export async function sixBoard(contest, { statBy = null, byId = null } = {}) {
  const rows = await sql`
    SELECT e.user_id, e.lineup, e.score, e.meta->'six' AS six, u.handle, u.name, u.is_house
      FROM contest_entries e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${contest.id}`;
  if (!rows.length) return [];
  const sb = statBy ?? await boxFor(contest.board ?? []);
  const live = byId ?? await liveRows(contest.board ?? []);
  // A CARD WITH NOBODY ON IT IS NOT ON THE BOARD (ruling thu-44) - not a 0 at
  // the bottom. Settled: the settle left its score null. Open: no slot filled.
  const shaped = rows.filter((r) => rankable(SLOTS.filter((s) => r.lineup?.[s]?.playerId != null).length))
    .map((r) => {
      const settled = contest.settled && r.score != null;
      const card = settled ? null : scoreCard(r.lineup ?? {}, sb, live);
      return {
        userId: r.user_id, handle: r.handle ?? r.name ?? 'player', house: r.is_house === true,
        points: settled ? Number(r.score) : (card?.total ?? 0),
      };
    });
  return rankRows(shaped);
}

/**
 * THE PICKING SCREEN, THE LIVE SCREEN AND THE FINAL are one read: which one
 * renders is a function of how much of the card is locked and whether the
 * night is graded, not of a different query.
 */
export async function sixView(userId, contest, { now = new Date(), withPool = true } = {}) {
  if (!contest) return null;
  const board = contest.board ?? [];
  const [entry] = userId == null ? [] : await sql`
    SELECT lineup, score, meta FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${userId}`;
  const lineup = entry?.lineup ?? {};
  const [byId, statBy, pool] = await Promise.all([
    liveRows(board), boxFor(board),
    withPool ? sixPool(contest).catch(() => null) : Promise.resolve(null),
  ]);
  const { statusBy, kickoffBy } = lockMaps(byId);
  const opts = { statusBy, kickoffBy };
  const card = scoreCard(lineup, statBy, byId);
  const progress = cardProgress(lineup, board, now, opts);
  const night = nightState(lineup, board, now, opts);
  const next = nextLock(board, now, opts);
  const injured = withInjuries(pool, contest.meta?.injuries);
  const ranked = (await sixBoard(contest, { statBy, byId }).catch(() => []))
    .map((r) => ({ ...r, isMe: userId != null && String(r.userId) === String(userId) }));
  const me = userId == null ? null : ranked.find((r) => String(r.userId) === String(userId)) ?? null;
  const settled = contest.settled === true;
  const anyLive = board.some((g) => byId.get(String(g.match_id))?.status === 'live');
  // A void game never locks (sat-5 S1), so "every game locked" is asked of the playable ones.
  const playable = board.filter((g) => !isVoidStatus(statusBy.get(String(g.match_id))));
  const allLocked = playable.length > 0 && playable.every((g) => gameLocked(g, now, opts));

  return {
    phase: settled ? 'final' : (progress.locked > 0 || allLocked) ? 'live' : 'open',
    contest: {
      id: contest.id, day: contest.day ?? null, dayLabel: dayLabel(contest.day ?? contest.meta?.day_et) ?? null,
      games: board.length, settled, cap: teamCap(board, { statusBy }), rules: RULES_LINE,
      season: contest.season_year == null ? null : Number(contest.season_year),
    },
    // THE SERVER'S NOW, shipped so the card runs the same rules against the same
    // instant instead of reading Date.now() during render.
    now: new Date(now).toISOString(),
    board: board.map((g) => {
      const m = byId.get(String(g.match_id)) ?? {};
      const status = m.status ?? 'scheduled';
      const tip = tipOf(g, kickoffBy);
      return {
        matchId: Number(g.match_id), slug: g.slug, home: g.home, away: g.away,
        homeTeamId: g.home_team_id, awayTeamId: g.away_team_id,
        tipAt: Number.isFinite(tip) ? new Date(tip).toISOString() : g.kickoff_at,
        status, void: isVoidStatus(status),
        chip: status === 'live' ? liveChip(m.live_state) : null,
        score: status === 'live' || status === 'final' ? { home: m.home_score, away: m.away_score } : null,
        pickable: !gameLocked(g, now, opts) && !isVoidStatus(status),
      };
    }),
    slots: card.slots.map((s, i) => {
      const p = lineup?.[s.slot] ?? {};
      return {
        ...s, pos: SLOT_POS[s.slot], pip: progress.pips[i],
        name: p.name ?? null, team: p.team ?? null, teamId: p.teamId ?? null, opp: p.opp ?? null,
        position: p.position ?? null, playerId: p.playerId ?? null, matchId: p.matchId ?? null,
      };
    }),
    progress,
    nightState: night.state,
    total: settled && entry?.score != null ? Number(entry.score) : card.total,
    nextLock: next ? {
      matchId: next.match_id, label: gameLabel(next), tipAt: new Date(next.ms).toISOString(),
      msAway: Math.max(0, next.ms - new Date(now).getTime()),
    } : null,
    pool: injured,
    injuriesAt: contest.meta?.injuries?.at ?? null,
    anyLive,
    me: me ? { rank: me.rank, of: ranked.length, points: me.points } : null,
    rank: settled ? (entry?.meta?.six?.rank ?? me?.rank ?? null) : (me?.rank ?? null),
    of: ranked.length,
    perfect: settled ? (contest.perfect ?? null) : null,
    boardRows: boardView(ranked, userId, { top: 10 }),
    signedIn: userId != null,
  };
}

/**
 * THE READER FOR THE GAME PAGE'S "In your games" ROW (nba-card builder).
 *
 * This user's Tonight's Six entry, if any of its slots is a player in match X:
 *   null when there is none; otherwise
 *   { contestId, href: '/six', day, slots: [{ slot, pos, playerId, name, team,
 *     points, state, dnp }], total }
 * where `slots` are only the ones in that match and `total` is the whole card.
 * One query for the entry (the user's entries on cards whose board names the
 * match), one for the box. Safe to call for a signed-out reader (returns null).
 */
export async function sixEntryTouchingMatch(userId, matchId) {
  if (userId == null || matchId == null) return null;
  const rows = await sql`
    SELECT c.id, to_char(c.puzzle_date, 'YYYY-MM-DD') AS day, c.board, c.settled, e.lineup, e.score
      FROM contests c
      JOIN contest_entries e ON e.contest_id = c.id AND e.user_id = ${Number(userId)}
     WHERE c.game_type = ${GAME_TYPE}
       AND c.board @> ${JSON.stringify([{ match_id: Number(matchId) }])}::jsonb
     ORDER BY c.puzzle_date DESC LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  const mine = SLOTS.filter((s) => String(r.lineup?.[s]?.matchId ?? '') === String(matchId));
  if (!mine.length) return null;
  const [statBy, byId] = await Promise.all([boxFor(r.board ?? []), liveRows(r.board ?? [])]);
  const card = scoreCard(r.lineup ?? {}, statBy, byId);
  return {
    contestId: r.id, href: '/six', day: r.day,
    slots: card.slots.filter((s) => mine.includes(s.slot)).map((s) => ({
      slot: s.slot, pos: SLOT_POS[s.slot], playerId: s.playerId,
      name: r.lineup[s.slot]?.name ?? null, team: r.lineup[s.slot]?.team ?? null,
      points: s.points, state: s.state, dnp: s.dnp,
    })),
    total: r.settled && r.score != null ? Number(r.score) : card.total,
  };
}
