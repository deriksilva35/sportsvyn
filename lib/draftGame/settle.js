// lib/draftGame/settle.js - score a per-game Draft: live while the game is on,
// final once it is over (fri-1 S2).
//
// THE SCORE. Each of a room's four seats drafted four players from one game;
// a player's points are his PPR line from THAT game (nfl_player_game_stats,
// the poller's ~5-minute box sync while live, its final sync at the whistle),
// through the one scorer, lib/fantasy/scoring.js. A seat scores its BEST
// THREE. A player with no stat row did not play and scores 0 - he is simply
// the one that does not count, unless the seat has two.
//
// TIES. Places are competition ranks: equal scores share the higher place
// (41.2, 41.2, 30 -> 1st, 1st, 3rd). Inside a seat, the 3rd/4th boundary on
// equal points counts the EARLIER pick, so "not counted" is never a coin flip.
//
// LIVE vs FINAL is one computation over whatever rows exist: liveResult reads
// and writes nothing; settleGameBoard writes it once, when the game is final,
// its box is in, and SETTLE_GRACE has passed since the scheduled end (the
// poller's final-flip sync has landed by then). A game called off settles VOID:
// every entry keeps its room and scores nothing.
//
// Rooms nobody finished are finished at settle (rules.completeRoom), exactly as
// a read after kickoff would have.

import { sql as defaultSql } from '../db.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';
import { statLine } from '../daily/reveal.js';
import { GAME_TYPE } from './create.js';
import { COUNT_BEST, SEATS, roomState, completeRoom, seatLabels } from './rules.js';

/** Hours after kickoff before a final game may settle (box sync lands at the whistle). */
export const SETTLE_AFTER_HOURS = 3.5;
/** A final with fewer stat rows than this is a box not yet in. */
export const MIN_STAT_ROWS = 10;
const VOID = new Set(['postponed', 'cancelled', 'canceled', 'abandoned', 'suspended']);
export const isVoidGame = (status) => VOID.has(String(status ?? ''));

const r1 = (x) => Math.round(Number(x) * 10) / 10;

/** Competition places for [{ key, score }]: ties share the higher place. PURE. */
export function places(rows) {
  const sorted = [...rows].sort((a, b) => (b.score - a.score) || (a.key - b.key));
  const out = new Map();
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    out.set(r.key, prev && prev.score === r.score ? out.get(prev.key) : i + 1);
  });
  return out;
}

/**
 * One seat's four players scored: { players: [{...row, pts, played, line, counted}], score }.
 * `stats` is Map(playerId -> stat row). PURE.
 */
export function scoreSeat(picks, stats) {
  const players = picks.map((p) => {
    const row = stats.get(Number(p.id));
    const s = row ? toStatLine(row) : null;
    return {
      id: Number(p.id), name: p.name, pos: p.pos, team: p.team, n: p.n, by: p.by,
      played: row != null,
      pts: row ? r1(fantasyPoints(s, 'ppr')) : 0,
      line: row ? (statLine(p.pos, s) ?? null) : null,
    };
  });
  // Best COUNT_BEST by points; on equal points the earlier pick counts.
  const order = [...players].sort((a, b) => (b.pts - a.pts) || (a.n - b.n));
  const counted = new Set(order.slice(0, COUNT_BEST).map((p) => p.id));
  const out = players.map((p) => ({ ...p, counted: counted.has(p.id) }));
  return { players: out, score: r1(out.filter((p) => p.counted).reduce((a, p) => a + p.pts, 0)) };
}

/**
 * A whole room scored. { seats: [{ seat, label, you, players, score, place }], you: {score, place} }.
 * PURE over (board, picks, userSeat, stats).
 */
export function roomResult(board, picks, userSeat, stats) {
  const st = roomState(board, picks);
  const labels = seatLabels(userSeat);
  const seats = [];
  for (let s = 1; s <= SEATS; s += 1) {
    const { players, score } = scoreSeat(st.rosters[s], stats);
    seats.push({ seat: s, label: labels[s], you: s === userSeat, players, score });
  }
  const pl = places(seats.map((x) => ({ key: x.seat, score: x.score })));
  for (const x of seats) x.place = pl.get(x.seat);
  const me = seats.find((x) => x.you);
  return { seats, you: { score: me.score, place: me.place } };
}

/** "Top N%": competition rank of `score` among all entries' scores, as a percent (ceil). PURE. */
export function topPercent(score, allScores) {
  const better = allScores.filter((s) => s > score).length;
  return Math.max(1, Math.ceil(((better + 1) / allScores.length) * 100));
}

async function statsFor(sql, matchId, ids) {
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT nfl_player_id, pass_cmp, pass_att, pass_yds, pass_td, pass_int,
           rush_att, rush_yds, rush_td, tgt, rec, rec_yds, rec_td, fumbles_lost
      FROM nfl_player_game_stats
     WHERE match_id = ${Number(matchId)} AND nfl_player_id = ANY(${ids.map(Number)})`;
  return new Map(rows.map((r) => [Number(r.nfl_player_id), r]));
}

async function loadBoard(sql, contestId) {
  const [c] = await sql`
    SELECT c.id, c.match_id, c.board, c.locks_at, c.settled, c.meta, m.status, m.kickoff_at,
           m.home_score, m.away_score
      FROM contests c JOIN matches m ON m.id = c.match_id
     WHERE c.id = ${Number(contestId)} AND c.game_type = ${GAME_TYPE}`;
  return c ?? null;
}

/** A reader's room scored from the rows that exist now. Reads only. */
export async function liveResult(contestId, userId, { sql = defaultSql } = {}) {
  const c = await loadBoard(sql, contestId);
  if (!c) return null;
  const [e] = await sql`SELECT meta FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${Number(userId)}`;
  const room = e?.meta?.room;
  if (!room) return null;
  const picks = roomState(c.board, room.picks).done ? room.picks
    : [...room.picks, ...completeRoom(c.board, room.picks, { contestId: c.id, userSeat: room.seat })];
  const stats = await statsFor(sql, c.match_id, (c.board ?? []).map((r) => r.id));
  return { ...roomResult(c.board, picks, room.seat, stats), final: false };
}

/**
 * Settle one board if it is due. Returns { settled, reason?, entries? }.
 * Idempotent: a settled board is left alone.
 */
export async function settleGameBoard(contestId, { now = new Date(), sql = defaultSql } = {}) {
  const c = await loadBoard(sql, contestId);
  if (!c) return { settled: false, reason: 'not_found' };
  if (c.settled) return { settled: false, reason: 'already' };
  const entries = await sql`SELECT id, user_id, meta FROM contest_entries WHERE contest_id = ${c.id}`;

  if (isVoidGame(c.status)) {
    await sql.transaction([
      ...entries.map((e) => sql`
        UPDATE contest_entries SET score = NULL,
               meta = meta || jsonb_build_object('result', ${JSON.stringify({ void: true })}::jsonb), updated_at = now()
         WHERE id = ${e.id}`),
      sql`UPDATE contests SET settled = true, settled_at = ${new Date(now).toISOString()},
                 meta = meta || jsonb_build_object('void', true) WHERE id = ${c.id} AND NOT settled`,
    ]);
    return { settled: true, void: true, entries: entries.length };
  }

  if (c.status !== 'final') return { settled: false, reason: 'not_final' };
  if (new Date(now).getTime() < new Date(c.locks_at).getTime() + SETTLE_AFTER_HOURS * 3_600_000) {
    return { settled: false, reason: 'grace' };
  }
  const stats = await statsFor(sql, c.match_id, (c.board ?? []).map((r) => r.id));
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM nfl_player_game_stats WHERE match_id = ${c.match_id}`;
  if (n < MIN_STAT_ROWS) return { settled: false, reason: 'box_not_in', statRows: n };

  const scored = entries.filter((e) => e.meta?.room).map((e) => {
    const room = e.meta.room;
    const rest = roomState(c.board, room.picks).done ? []
      : completeRoom(c.board, room.picks, { contestId: c.id, userSeat: room.seat });
    const picks = [...room.picks, ...rest];
    return { e, room: { ...room, picks, deadline: null }, res: roomResult(c.board, picks, room.seat, stats) };
  });
  const all = scored.map((x) => x.res.you.score);
  const final = `FINAL ${c.away_score ?? 0}-${c.home_score ?? 0}`;
  await sql.transaction([
    ...scored.map(({ e, room, res }) => {
      const result = { ...res, final: true, top_pct: topPercent(res.you.score, all), entrants: all.length, score_line: final };
      const lineup = { players: res.seats.find((s) => s.you).players.map((p) => p.id) };
      return sql`
        UPDATE contest_entries
           SET score = ${res.you.score}, lineup = ${JSON.stringify(lineup)}::jsonb,
               meta = meta || jsonb_build_object('room', ${JSON.stringify(room)}::jsonb, 'result', ${JSON.stringify(result)}::jsonb),
               locked_at = COALESCE(locked_at, ${new Date(c.locks_at).toISOString()}), updated_at = now()
         WHERE id = ${e.id}`;
    }),
    sql`UPDATE contests SET settled = true, settled_at = ${new Date(now).toISOString()},
               meta = meta || jsonb_build_object('entrants', ${all.length}::int, 'score_line', ${final}::text)
         WHERE id = ${c.id} AND NOT settled`,
  ]);
  return { settled: true, entries: scored.length };
}

/** The every-10-minutes run: every unsettled board whose game has kicked, oldest first. */
export async function settleDueGameBoards({ now = new Date(), sql = defaultSql } = {}) {
  const due = await sql`
    SELECT c.id FROM contests c JOIN matches m ON m.id = c.match_id
     WHERE c.game_type = ${GAME_TYPE} AND NOT c.settled AND c.locks_at <= ${new Date(now).toISOString()}
     ORDER BY c.locks_at, c.id LIMIT 50`;
  const out = { due: due.length, settled: 0, void: 0, waiting: {} };
  for (const { id } of due) {
    const r = await settleGameBoard(id, { now, sql });
    if (r.settled) { out.settled += 1; if (r.void) out.void += 1; } else out.waiting[r.reason] = (out.waiting[r.reason] ?? 0) + 1;
  }
  return out;
}
