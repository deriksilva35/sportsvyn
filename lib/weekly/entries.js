// lib/weekly/entries.js - saving and reading a weekly lineup.
//
// THE LOCK IS SERVER LAW. Every save re-reads locks_at from the contest row
// and checks it there. The client's countdown is a courtesy; a save that
// arrives a millisecond late is refused however good the lineup is, and
// however convinced the browser was that there was time.
//
// SAVES OVERWRITE AND KEEP NO HISTORY. A weekly lineup is a draft you come
// back to. Storing every intermediate state would be a leak surface - who
// flip-flopped on whom, visible to anyone who could read the table - for no
// reader benefit.
//
// locked_at IS STAMPED AT LOCK, NOT AT SAVE. A saved lineup is not a locked
// one. The distinction is what makes "editable until Thursday" true, and it is
// how the settle job tells a submitted lineup from an abandoned draft.

import { sql } from '../db.js';
import { saveVerdict, normalizeLineup, validateLineup } from './rules.js';

export async function getContest(season, week, { sport = 'nfl' } = {}) {
  const r = await sql`
    SELECT * FROM contests
     WHERE game_type = 'weekly' AND sport = ${sport}
       AND season_year = ${season} AND week = ${week}`;
  return r[0] ?? null;
}

export async function currentContest({ sport = 'nfl', now = new Date() } = {}) {
  // The board a reader should be looking at: the most recent one that has
  // opened. A settled week stays current until the next board opens, so the
  // reveal has somewhere to live.
  const r = await sql`
    SELECT * FROM contests
     WHERE game_type = 'weekly' AND sport = ${sport} AND opens_at <= ${now.toISOString()}
     ORDER BY season_year DESC, week DESC LIMIT 1`;
  return r[0] ?? null;
}

export async function getEntry(contestId, userId) {
  const r = await sql`
    SELECT * FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${userId}`;
  return r[0] ?? null;
}

/**
 * Save (or overwrite) a lineup. Refused once the week has locked.
 *
 * PARTIAL IS FINE. Completeness is asked at settle, not at save - this is a
 * draft, and refusing to store four of six slots would make the builder
 * useless for the four days it is meant to be used.
 */
export async function saveLineup(contestId, userId, lineup, { now = new Date() } = {}) {
  const c = (await sql`SELECT id, locks_at, board FROM contests WHERE id = ${contestId}`)[0];
  if (!c) return { ok: false, reason: 'no such contest' };

  const v = saveVerdict(c.locks_at, now);
  if (!v.ok) return { ok: false, reason: v.reason, lockedAt: c.locks_at };

  const clean = normalizeLineup(lineup, c.board);
  const check = validateLineup(clean, c.board);
  if (!check.ok) return { ok: false, reason: 'invalid', errors: check.errors };

  const r = await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${JSON.stringify(clean)}::jsonb)
    ON CONFLICT (contest_id, user_id)
      DO UPDATE SET lineup = EXCLUDED.lineup, updated_at = now()
    RETURNING id, lineup, updated_at`;
  return { ok: true, entry: r[0], filled: check.filled, msLeft: v.msLeft };
}

/**
 * Stamp locked_at on every entry for a locked contest.
 *
 * IDEMPOTENT and set-once: `WHERE locked_at IS NULL` means a second run finds
 * nothing. Runs from the settle cron rather than a timer, so a missed tick
 * self-heals instead of losing the stamp.
 */
export async function lockEntries(contestId, { now = new Date() } = {}) {
  const c = (await sql`SELECT locks_at FROM contests WHERE id = ${contestId}`)[0];
  if (!c) return { locked: 0 };
  if (new Date(c.locks_at).getTime() > now.getTime()) return { locked: 0, reason: 'not locked yet' };
  const r = await sql`
    UPDATE contest_entries SET locked_at = ${c.locks_at}, updated_at = now()
     WHERE contest_id = ${contestId} AND locked_at IS NULL
     RETURNING id`;
  return { locked: r.length };
}
