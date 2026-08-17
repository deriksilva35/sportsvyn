// lib/weekly/create.js - making a week's board.
//
// THE POOL AND THE DEADLINE ARE BOTH SNAPSHOTTED HERE, and neither moves
// again. See pool.js for why the pool freezes; locks_at freezes for the same
// class of reason - a deadline that chases a rescheduled kickoff either steals
// time from someone who set an alarm or locks them out early, and both break a
// promise already made.

import { sql } from '../db.js';
import { activePool, firstKickoff } from './pool.js';

/**
 * Create the board for one NFL week if it is not already there.
 * IDEMPOTENT: ON CONFLICT DO NOTHING against the partial unique index, so a
 * re-tick cannot produce a second board for a week someone is already building.
 */
export async function ensureWeek(season, week, { sport = 'nfl', opensAt = null } = {}) {
  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'weekly' AND sport = ${sport}
       AND season_year = ${season} AND week = ${week}`;
  if (existing.length) return { id: existing[0].id, created: false };

  const ko = await firstKickoff(season, week);
  if (!ko) return { created: false, error: 'no kickoff found for that week' };

  const board = await activePool();
  if (!board.length) return { created: false, error: 'empty player pool' };

  // Opens two days before the lock unless told otherwise: enough runway to be
  // worth building, short enough that the pool snapshot is still current.
  const opens = opensAt ?? new Date(new Date(ko).getTime() - 2 * 86_400_000);
  // Settles when the week's last game is comfortably done. Advisory only - the
  // settle gate decides, not the clock.
  const last = (await sql`
    SELECT max(m.kickoff_at) ko FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug='nfl' AND m.season_year=${season} AND m.season_phase='REG' AND m.week=${week}`)[0]?.ko;
  const settles = new Date(new Date(last ?? ko).getTime() + 12 * 3_600_000);

  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at)
    VALUES ('weekly', ${sport}, ${season}, ${week}, ${JSON.stringify(board)}::jsonb,
            ${opens.toISOString()}, ${new Date(ko).toISOString()}, ${settles.toISOString()})
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type='weekly' AND sport=${sport}
        AND season_year=${season} AND week=${week}`;
    return { id: again[0]?.id, created: false, raced: true };
  }
  return { id: r[0].id, created: true, poolSize: board.length, locksAt: ko };
}
