// lib/rankings/people.js - the People view's four tables.
//
// THREE OF THE FOUR ALREADY EXIST and are wrapped rather than rewritten:
//   Daily    lib/daily/seasonBoardLeaderboards.js (streak, best, played)
//   Weekly   lib/games/read.js gameSeasonTable('weekly', uid)
//   Pick'em  lib/games/read.js pickemTable(uid, { sport })
// Each already returns { top, self } where `self` is the caller's own row
// when they are off the visible top - which is exactly the mock's dashed rank
// with a distance line under it.
//
// THE FOURTH IS NEW. There is no by-seat aggregate anywhere; the recon found
// only a drafter's own seat on the lobby row. drafts.user_seat carries it,
// twelve seats, and contest_entries.meta->>'draftId' is the bridge.
//
// THE DISTANCE TO RANKING IS COMPUTED HERE, not in those readers. They apply
// the floor; none of them says how far away you are.

import { sql } from '../db.js';
import { PICKEM_TABLE_MIN_BOARDS, SEASON_TABLE_MIN_WEEKS } from '../games/read.js';

/**
 * "2 boards · ranks after 1 more", or null when they already rank.
 * Pure, so the sentence is testable without a table.
 */
export function distanceToRanking(have, floor, unit = 'board') {
  const n = Number(have ?? 0);
  const need = Number(floor ?? 0) - n;
  if (need <= 0) return null;
  const u = (k) => `${k} ${unit}${k === 1 ? '' : 's'}`;
  return { have: n, floor, need, text: `${u(n)} · ranks after ${need} more` };
}

export const FLOORS = Object.freeze({
  pickem: PICKEM_TABLE_MIN_BOARDS,
  weekly: SEASON_TABLE_MIN_WEEKS,
  draft: SEASON_TABLE_MIN_WEEKS,
  seat: 3,
});

/**
 * COALESCE(user_seat, pick_position) IS THE SEAT, AND THIS WAS A SILENT HOLE.
 *
 * user_seat is "THE FRANCHISE YOU CONTROL this run" - written for a league or
 * tracker start, deliberately NULL for a preset or custom one
 * (lib/fantasy/drafts.js:458-462, which says outright that a NULL row "reads
 * pick_position, which has always been the same seat"). The RANKED Draft
 * starts through startCustomDraftFor, so every ranked room has a
 * pick_position and NO user_seat: measured on PROD, 6 ranked rooms, 6 with a
 * pick_position, 0 with a user_seat. Keyed on user_seat alone this reader
 * therefore returned an empty grid for the game it is named after, and the
 * "by seat" row on the Draft's own card could never say anything.
 *
 * The COALESCE is the column's own stated rule, applied. It widens the grid to
 * include ranked drafts, which is the only thing that makes a seat average
 * about the Draft.
 */
/**
 * THE DRAFT, BY SEAT. Twelve cells, average settled score per seat, and the
 * caller's own seat marked.
 *
 * MIN 3 DRAFTERS PER SEAT. One person's one draft from seat 7 is not evidence
 * that seat 7 is good, and a table that said so would be the first thing a
 * reader disbelieved. Below the floor the cell is a dash.
 *
 * Today every cell is a dash: there are zero SETTLED draft entries on PROD.
 * That is the state the mock draws, and it is honest rather than empty.
 */
export const DRAFT_SEATS = 12;
export async function draftBySeat(uid = null, { seats = DRAFT_SEATS, minDrafters = FLOORS.seat } = {}) {
  const rows = await sql`
    SELECT COALESCE(d.user_seat, d.pick_position) AS seat,
           count(*)::int AS drafters, avg(e.score)::numeric AS avg_pts
      FROM contest_entries e
      JOIN contests c ON c.id = e.contest_id AND c.game_type = 'draft' AND c.settled
      JOIN drafts d ON d.id = (e.meta->>'draftId')::int
     WHERE COALESCE(d.user_seat, d.pick_position) IS NOT NULL AND e.score IS NOT NULL
     GROUP BY COALESCE(d.user_seat, d.pick_position)`.catch(() => []);
  const by = new Map(rows.map((r) => [Number(r.seat), r]));
  // The caller's most recent seat, so the grid can outline it even when they
  // have nothing settled yet.
  const [mine] = uid == null ? [] : await sql`
    SELECT COALESCE(d.user_seat, d.pick_position) AS seat FROM drafts d
     WHERE d.user_id = ${uid} AND COALESCE(d.user_seat, d.pick_position) IS NOT NULL
     ORDER BY d.started_at DESC NULLS LAST, d.id DESC LIMIT 1`.catch(() => []);
  const mySeat = mine?.seat ?? null;
  return {
    seats: Array.from({ length: seats }, (_, i) => {
      const n = i + 1;
      const r = by.get(n);
      const ranked = r != null && r.drafters >= minDrafters;
      return {
        seat: n,
        drafters: r?.drafters ?? 0,
        avg: ranked ? Math.round(Number(r.avg_pts) * 10) / 10 : null,
        you: mySeat === n,
      };
    }),
    mySeat,
    minDrafters,
    // Stated rather than implied: a grid of dashes should say why.
    note: rows.length === 0
      ? 'No settled drafts yet. This fills in as rooms settle.'
      : `Minimum ${minDrafters} drafters per seat to show an average.`,
  };
}
