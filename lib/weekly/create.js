// lib/weekly/create.js - making a week's board.
//
// THE POOL AND THE DEADLINE ARE BOTH SNAPSHOTTED HERE, and neither moves
// again. See pool.js for why the pool freezes; locks_at freezes for the same
// class of reason - a deadline that chases a rescheduled kickoff either steals
// time from someone who set an alarm or locks them out early, and both break a
// promise already made.

import { sql } from '../db.js';
import { activePool, firstKickoff } from './pool.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';

/**
 * Create the board for one NFL week if it is not already there.
 * IDEMPOTENT: ON CONFLICT DO NOTHING against the partial unique index, so a
 * re-tick cannot produce a second board for a week someone is already building.
 */
/**
 * The 9am ET Tuesday on or before a kickoff, as a naive ET timestamp string.
 *
 * ON OR BEFORE, not "the previous Tuesday": a Tuesday kickoff would otherwise
 * open its own board a week early. The NFL has played on Tuesday (weather
 * reschedules, and the 2020 season did it twice), so this is not hypothetical.
 */
export function tuesdayBefore(kickoffIso, hour = 9) {
  const d = new Date(kickoffIso);
  // getUTCDay on the kickoff instant is close enough to pick the weekday: the
  // result is anchored to a DATE, and the exact ET time of day is applied by
  // easternLocalToUtc afterwards.
  const back = (d.getUTCDay() - 2 + 7) % 7;   // 2 = Tuesday
  const t = new Date(d.getTime() - back * 86_400_000);
  const day = t.toISOString().slice(0, 10);
  return `${day} ${String(hour).padStart(2, '0')}:00:00`;
}

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

  // OPENS TUESDAY MORNING ET, because that is what every surface promises.
  //
  // This was `kickoff - 2 days`, which for 2026 Week 1 put the board live at
  // 8:20pm on MONDAY - fourteen hours before the "Boards open Tuesday morning"
  // line the pitch, the rules, the homepage module and the pre-board state all
  // carry. Subtracting a fixed interval from a kickoff that moves between
  // Wednesday, Thursday and Sunday cannot land on a weekday at all; only naming
  // the weekday does.
  //
  // TUESDAY IS THE RIGHT ANCHOR because it is when the PREVIOUS week settles
  // (settles_at is Tuesday morning too). The season reads as one loop: last
  // week's result and next week's board arrive together.
  //
  // DST-AWARE VIA THE SANCTIONED HELPER. easternLocalToUtc is the only place
  // this codebase converts ET-local to UTC, and a hand-rolled offset here would
  // be off by an hour for every board after the November change.
  const opens = opensAt ?? new Date(await easternLocalToUtc(tuesdayBefore(ko)));
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
