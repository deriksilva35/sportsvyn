// lib/draftGame/room.js - a reader's per-game Draft room on the contest spine (thu-3 S1).
//
// ONE ENTRY = ONE ROOM. contest_entries (UNIQUE contest_id, user_id) holds the
// room in meta.room = { seat, picks: [{ n, seat, id, by }], deadline }. The
// room is REPLAYED from its picks against the contest's frozen board on every
// read (rules.roomState), so the stored shape is the picks and nothing derived.
//
// meta.room IS A TOP-LEVEL KEY written whole (`meta || jsonb_build_object('room',
// ...)`): the shallow-merge law is only a trap for a NESTED key, and this
// writes no nesting into anything it did not build.
//
// EVERY WRITE IS GUARDED ON THE PICK COUNT it read (optimistic: `... AND
// jsonb_array_length(meta->'room'->'picks') = <count read>`). Two tabs that
// both pick at pick 5 cannot both land; the loser gets 'conflict' and re-reads.
//
// THE CLOCK IS SERVER-SIDE. A read sweeps expired clocks (rules.sweepClock),
// so a reader who walks away loses picks to auto-pick at 30 s each, and a
// read after kickoff finishes the room (rules.completeRoom) - the room is
// whole by the time anything scores it.

import { sql as defaultSql } from '../db.js';
import { GAME_TYPE } from './create.js';
import {
  SEATS, CLOCK_SECONDS, roomState, advanceBots, sweepClock, completeRoom, gameLocked, roomHeader,
} from './rules.js';

const plus = (now, s) => new Date(new Date(now).getTime() + s * 1000).toISOString();

async function loadContest(sql, contestId) {
  const [c] = await sql`
    SELECT c.id, c.game_type, c.sport, c.match_id, c.board, c.opens_at, c.locks_at, c.meta,
           m.status, m.kickoff_at, m.slug
      FROM contests c JOIN matches m ON m.id = c.match_id
     WHERE c.id = ${Number(contestId)} AND c.game_type = ${GAME_TYPE}`;
  return c ?? null;
}

async function loadEntry(sql, contestId, userId) {
  const [e] = await sql`
    SELECT id, meta, lineup FROM contest_entries
     WHERE contest_id = ${Number(contestId)} AND user_id = ${Number(userId)}`;
  return e ?? null;
}

/** Persist a room, guarded on the pick count it was read with. True if it landed. */
async function saveRoom(sql, entryId, room, prevCount, board) {
  const st = roomState(board, room.picks);
  const lineup = st.done ? { players: st.rosters[room.seat].map((r) => r.id) } : {};
  const r = await sql`
    UPDATE contest_entries
       SET meta = meta || jsonb_build_object('room', ${JSON.stringify(room)}::jsonb),
           lineup = ${JSON.stringify(lineup)}::jsonb,
           updated_at = now()
     WHERE id = ${entryId}
       AND jsonb_array_length(COALESCE(meta->'room'->'picks', '[]'::jsonb)) = ${prevCount}
    RETURNING id`;
  return r.length > 0;
}

/**
 * Sweep a stored room forward to `now`: a locked game completes it, an expired
 * clock auto-picks. Persists only when something changed. Returns the room.
 */
async function sweep(sql, contest, entry, now, userId) {
  const room = entry.meta.room;
  const ctx = { contestId: contest.id, userSeat: room.seat };
  const locked = gameLocked(contest, now);
  let made; let deadline = room.deadline;
  if (locked) {
    made = completeRoom(contest.board, room.picks, ctx);
    deadline = null;
  } else {
    ({ made, deadline } = sweepClock(contest.board, room.picks, room.deadline, { ...ctx, now }));
  }
  if (!made.length) return room;
  const next = { ...room, picks: [...room.picks, ...made], deadline };
  const ok = await saveRoom(sql, entry.id, next, room.picks.length, contest.board);
  if (ok) return next;
  // Lost the race to another tab's write: theirs is the room now.
  const fresh = await loadEntry(sql, contest.id, userId);
  return fresh?.meta?.room ?? room;
}

/** The view a page renders. PURE over (contest, room, now). */
export function roomView(contest, room, now) {
  const st = roomState(contest.board, room?.picks ?? []);
  const seat = room?.seat ?? null;
  const locked = gameLocked(contest, now);
  return {
    contestId: contest.id,
    matchId: contest.match_id,
    slug: contest.slug,
    home: contest.meta?.home ?? null,
    away: contest.meta?.away ?? null,
    kickoffAt: new Date(contest.kickoff_at).toISOString(),
    locked,
    started: room != null,
    seat,
    header: room ? roomHeader(st, seat) : null,
    yourTurn: room != null && !st.done && !locked && st.onClock === seat,
    deadline: room?.deadline ?? null,
    done: st.done,
    next: st.next,
    available: st.available,
    seats: Array.from({ length: SEATS }, (_, i) => ({
      seat: i + 1,
      you: i + 1 === seat,
      picks: st.rosters[i + 1],
    })),
  };
}

/** Read (and sweep) a reader's room. { ok, view } or { ok: false, reason }. */
export async function readRoom(userId, contestId, { now = new Date(), sql = defaultSql } = {}) {
  const contest = await loadContest(sql, contestId);
  if (!contest) return { ok: false, reason: 'not_found' };
  const entry = userId == null ? null : await loadEntry(sql, contestId, userId);
  if (!entry?.meta?.room) return { ok: true, view: roomView(contest, null, now) };
  const room = await sweep(sql, contest, entry, now, userId);
  return { ok: true, view: roomView(contest, room, now) };
}

/**
 * Take a seat. One room per reader per game: a second start resumes the first.
 * The seat is drawn at random (1-4) unless given; the bots ahead of it pick at
 * once and the reader's clock starts.
 */
export async function startRoom(userId, contestId, { now = new Date(), seat = null, sql = defaultSql } = {}) {
  const contest = await loadContest(sql, contestId);
  if (!contest) return { ok: false, reason: 'not_found' };
  const existing = await loadEntry(sql, contestId, userId);
  if (existing?.meta?.room) return { ok: true, resumed: true, contestId: contest.id };
  if (gameLocked(contest, now)) return { ok: false, reason: 'locked' };
  const s = seat ?? (Math.floor(Math.random() * SEATS) + 1);
  if (!Number.isInteger(s) || s < 1 || s > SEATS) return { ok: false, reason: 'bad_seat' };
  const empty = { seat: s, picks: [], deadline: null };
  const ins = await sql`
    INSERT INTO contest_entries (contest_id, user_id, meta)
    VALUES (${contest.id}, ${Number(userId)}, ${JSON.stringify({ room: empty })}::jsonb)
    ON CONFLICT (contest_id, user_id) DO NOTHING
    RETURNING id`;
  if (!ins.length) return { ok: true, resumed: true, contestId: contest.id };
  const made = advanceBots(contest.board, [], { contestId: contest.id, userSeat: s });
  const room = { seat: s, picks: made, deadline: plus(now, CLOCK_SECONDS) };
  await saveRoom(sql, ins[0].id, room, 0, contest.board);
  return { ok: true, resumed: false, contestId: contest.id, seat: s };
}

/** The reader picks `playerId`. The bots answer at once and the next clock starts. */
export async function makePick(userId, contestId, playerId, { now = new Date(), sql = defaultSql } = {}) {
  const contest = await loadContest(sql, contestId);
  if (!contest) return { ok: false, reason: 'not_found' };
  const entry = await loadEntry(sql, contestId, userId);
  if (!entry?.meta?.room) return { ok: false, reason: 'no_room' };
  const before = entry.meta.room.picks.length;
  const room = await sweep(sql, contest, entry, now, userId);
  if (room.picks.length !== before) return { ok: false, reason: gameLocked(contest, now) ? 'locked' : 'timed_out' };
  if (gameLocked(contest, now)) return { ok: false, reason: 'locked' };
  const st = roomState(contest.board, room.picks);
  if (st.done) return { ok: false, reason: 'done' };
  if (st.onClock !== room.seat) return { ok: false, reason: 'not_your_turn' };
  if (!st.available.some((r) => Number(r.id) === Number(playerId))) return { ok: false, reason: 'taken' };
  const rec = { n: st.next, seat: room.seat, id: Number(playerId), by: 'user' };
  const bots = advanceBots(contest.board, [...room.picks, rec], { contestId: contest.id, userSeat: room.seat });
  const picks = [...room.picks, rec, ...bots];
  const done = roomState(contest.board, picks).done;
  const next = { ...room, picks, deadline: done ? null : plus(now, CLOCK_SECONDS) };
  const ok = await saveRoom(sql, entry.id, next, room.picks.length, contest.board);
  return ok ? { ok: true } : { ok: false, reason: 'conflict' };
}

/** Open boards for the list page, soonest kickoff first, with this reader's room state. */
export async function listOpenBoards(userId, { now = new Date(), sport = 'nfl', sql = defaultSql } = {}) {
  const rows = await sql`
    SELECT c.id, c.meta, c.locks_at, c.board, m.kickoff_at, m.status, m.slug,
           e.meta->'room' AS room
      FROM contests c
      JOIN matches m ON m.id = c.match_id
      LEFT JOIN contest_entries e ON e.contest_id = c.id AND e.user_id = ${userId == null ? null : Number(userId)}
     WHERE c.game_type = ${GAME_TYPE} AND c.sport = ${sport}
       AND c.opens_at <= ${new Date(now).toISOString()} AND NOT c.settled
       AND m.status = 'scheduled' AND m.kickoff_at > ${new Date(now).toISOString()}
     ORDER BY m.kickoff_at, c.id`;
  // THE COUNT IS THE ROOM AS IT STANDS NOW: expired clocks are applied in memory
  // (read-only - the room page's read persists them), so the card never says
  // "0 of 4" for a room whose clock already picked for its reader.
  const mineNow = (r) => {
    if (!r.room) return 0;
    const { made } = sweepClock(r.board, r.room.picks, r.room.deadline, { contestId: r.id, userSeat: r.room.seat, now: new Date(now) });
    return [...r.room.picks, ...made].filter((p) => p.seat === r.room.seat).length;
  };
  return rows.map((r) => ({
    contestId: r.id,
    home: r.meta?.home ?? null,
    away: r.meta?.away ?? null,
    kickoffAt: new Date(r.kickoff_at).toISOString(),
    slug: r.slug,
    started: r.room != null,
    picks: mineNow(r),
  }));
}
