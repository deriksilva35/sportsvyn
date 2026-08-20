// lib/daily/boards.js - the leaderboard reads. The decision half is
// standings.js, which is pure; this only fetches.
//
// EVERY QUERY IN THIS FILE FILTERS ON puzzle_days.revealed. That is the leak
// rule expressed as SQL, and it is written into the WHERE clause rather than
// left to a caller, because a caller that forgets turns the overall board into
// a side channel for today's scores - see the law at the top of standings.js.
//
// A locked entry on an OPEN day is invisible here. Not filtered later, not
// rendered muted: it never leaves the database.

import { sql } from '../db.js';
import { tierFor } from './reveal.js';
import { seasonStandings, dayLeaderboard, topWithSelf, seasonKeyFor } from './standings.js';
import { displayName } from './handles.js';

/** The most recent day whose answer is public. Everything else keys off this. */
export async function lastRevealedDate() {
  const r = await sql`
    SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS d
      FROM puzzle_days WHERE revealed ORDER BY puzzle_date DESC LIMIT 1`;
  return r[0]?.d ?? null;
}

/**
 * One revealed day's board, ranked, with the reader's row pinned if outside.
 * `date` MUST be a revealed day; the query enforces it rather than trusting so.
 */
export async function dayBoard(date, userId = null, n = 25, { memberIds = null } = {}) {
  // memberIds scopes to a player league (073) - explicit ANY, never a falsy
  // shortcut: an EMPTY league gets an empty board, not the world's. The
  // revealed JOIN is identical in both branches; the scope can never widen
  // what the leak rule narrows.
  const rows = memberIds == null
    ? await sql`
      SELECT e.user_id, e.score, e.locked_at, u.handle,
             d.perfect->>'total' AS perfect
        FROM puzzle_entries e
        JOIN puzzle_days d ON d.puzzle_date = e.puzzle_date AND d.revealed
        JOIN users u ON u.id = e.user_id
       WHERE e.puzzle_date = ${date}`
    : await sql`
      SELECT e.user_id, e.score, e.locked_at, u.handle,
             d.perfect->>'total' AS perfect
        FROM puzzle_entries e
        JOIN puzzle_days d ON d.puzzle_date = e.puzzle_date AND d.revealed
        JOIN users u ON u.id = e.user_id
       WHERE e.puzzle_date = ${date} AND e.user_id = ANY(${memberIds})`;
  if (!rows.length) return null;

  const perfect = Number(rows[0].perfect) || null;
  const ranked = dayLeaderboard(rows.map((r) => ({
    userId: r.user_id,
    name: displayName({ id: r.user_id, handle: r.handle }),
    handle: r.handle ?? null,
    score: r.locked_at ? Number(r.score) : null,
    dnf: !r.locked_at,
    tier: r.locked_at ? tierFor(r.score, perfect)?.label ?? null : null,
    pct: r.locked_at && perfect ? Math.round((Number(r.score) / perfect) * 100) : null,
  })));

  const { top, self } = topWithSelf(ranked, userId == null ? null : Number(userId), n);
  return { date, perfect, entries: ranked.length, top, self };
}

/** Yesterday's podium: top 5 plus your own row. */
export async function podium(userId = null) {
  const date = await lastRevealedDate();
  if (!date) return null;
  const b = await dayBoard(date, userId, 5);
  return b && { ...b, date };
}

/**
 * The overall table for a season, FROM REVEALED DAYS ONLY.
 *
 * The join to puzzle_days carries `AND d.revealed` and the season window is
 * derived from the same rows, so a day that closes later cannot retroactively
 * appear in a standing computed before it did.
 */
export async function overall(userId = null, n = 10, seasonKey = null, { memberIds = null } = {}) {
  // THE SEASON IS DERIVED FROM THE LAST REVEALED DAY, not hardcoded. Defaulting
  // to FIRST_SEASON would have pinned the board to 2026-27 forever: come
  // September 2027 the standings would silently keep serving the previous
  // season while the label still read "through <yesterday>". The board is
  // "through the last revealed day", so that day's season IS its season.
  const through = await lastRevealedDate();
  const key = seasonKey ?? (through ? seasonKeyFor(through) : null);
  if (!key) return { seasonKey: null, daysPlayable: 0, players: 0, top: [], self: null, through };
  const rows = memberIds == null
    ? await sql`
      SELECT e.user_id, e.score, u.handle,
             to_char(e.puzzle_date, 'YYYY-MM-DD') AS d,
             dd.perfect->>'total' AS perfect
        FROM puzzle_entries e
        JOIN puzzle_days dd ON dd.puzzle_date = e.puzzle_date AND dd.revealed
        JOIN users u ON u.id = e.user_id
       WHERE e.locked_at IS NOT NULL AND e.score IS NOT NULL`
    : await sql`
      SELECT e.user_id, e.score, u.handle,
             to_char(e.puzzle_date, 'YYYY-MM-DD') AS d,
             dd.perfect->>'total' AS perfect
        FROM puzzle_entries e
        JOIN puzzle_days dd ON dd.puzzle_date = e.puzzle_date AND dd.revealed
        JOIN users u ON u.id = e.user_id
       WHERE e.locked_at IS NOT NULL AND e.score IS NOT NULL
         AND e.user_id = ANY(${memberIds})`;

  const inSeason = rows.filter((r) => seasonKeyFor(r.d) === key);
  const daysPlayable = new Set(inSeason.map((r) => r.d)).size;

  const table = seasonStandings(inSeason.map((r) => {
    const perfect = Number(r.perfect) || null;
    return {
      userId: r.user_id,
      handle: r.handle ?? null,
      tier: tierFor(r.score, perfect)?.label ?? null,
      score: Number(r.score),
      perfect,
    };
  }), daysPlayable);

  for (const e of table) e.name = displayName({ id: e.userId, handle: e.handle });
  const { top, self } = topWithSelf(table, userId == null ? null : Number(userId), n);
  return {
    seasonKey: key, daysPlayable, players: table.length, top, self,
    // The label is load-bearing, not decoration: it is the promise that this
    // table cannot contain today.
    through,
  };
}
