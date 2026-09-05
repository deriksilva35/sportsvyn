// lib/draft/contest.js - The Draft's ranked contest, on the shared spine.
//
// ADAPTED FROM lib/weekly/create.js, and the divergences are three:
//
//   1. NO POOL SNAPSHOT ON THE CONTEST. The Weekly freezes a 1,000-player board
//      because the builder picks from it. The Draft's board is the same frozen
//      board - it has to be, because settlement scores against contests.board -
//      but the DRAFTING happens against the ADP pool the sim already uses. Two
//      pools, one join, and sim_player_pool.matched_player_id is the join;
//      measured at 712 of 712 on the live snapshot.
//   2. ONE CONFIG, NOT A CONSOLE. The sim lets a member build any league they
//      like. A ranked week cannot: everybody drafts the same shape or the
//      scores are not comparable, which is the same reason the Daily gives
//      everyone one board.
//   3. IT OPENS WITH THE WEEKLY AND LOCKS WITH IT. Same Tuesday 9am open, same
//      first-kickoff lock, same Tuesday settle - one week, two games.

import { sql } from '../db.js';
import { activePool } from '../weekly/pool.js';
import { firstKickoff } from '../weekly/pool.js';
import { tuesdayBefore } from '../weekly/create.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';

/**
 * THE RANKED CONFIG. Eight rounds, all starters, no bench.
 *
 * EIGHT AND NOT FIFTEEN because every pick has to matter in a one-week game. A
 * bench in best-ball is dead weight - it never scores and never has to be
 * decided - so a fifteen-round ranked draft would be seven rounds of real
 * choices followed by eight of noise, on a 30-second clock.
 *
 * EIGHT AND NOT SIX - RULED, so the question stops resurfacing. An early spec
 * described this format as six rounds, matching the six-slot lineup, and the
 * two numbers are not the same thing:
 *
 *   8 PICKS FEED A BEST-6; THE LINEUP GRAMMAR IS SCORING LAW, NOT DRAFT LAW.
 *
 * The draft is deliberately LARGER than the lineup, and that gap is the game.
 * Best-ball fills six slots from whatever you took, so rounds seven and eight
 * are the ones where a construction decision actually costs something - a
 * fourth receiver you will only start if he outscores the three above him. Cut
 * the draft to six and every pick becomes forced: one QB, one RB, one WR, one
 * TE and two flexes, in whatever order, with no roster left over to be right or
 * wrong about. See lib/draft/bestball.js for the scoring side of the same line.
 *
 * THE SHAPE GUARANTEES A LEGAL SIX. canFieldSix needs one QB and five bodies
 * from RB/WR/TE; this deals 1 + 7. A roster that cannot field a lineup is
 * therefore only reachable by abandoning the room, never by drafting badly.
 *
 * PPR / 12 TEAMS is one of LAUNCH_PRESET_PAIRS, so the daily ADP snapshot
 * already covers it. Choosing a pair outside that list would mean the pool the
 * room drafts from is the NEAREST snapshot rather than the real one, and a
 * ranked game should not draft against approximate ADP.
 */
export const DRAFT_CONFIG = {
  teamsCount: 12,
  scoringFormat: 'ppr',
  clockSeconds: 30,
  rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 },
};

export const DRAFT_ROUNDS = Object.values(DRAFT_CONFIG.rosterSlots).reduce((a, b) => a + b, 0);

/** The current ranked contest: the most recent one that has opened. */
export async function currentDraftContest({ sport = 'nfl', now = new Date() } = {}) {
  const r = await sql`
    SELECT * FROM contests
     WHERE game_type = 'draft' AND sport = ${sport} AND opens_at <= ${now.toISOString()}
     ORDER BY season_year DESC, week DESC LIMIT 1`;
  return r[0] ?? null;
}

/** The next draft contest that has NOT opened yet - the pre-launch hero's
 * "Opens ... · Locks ..." line. Only used once currentDraftContest() has
 * already returned null. */
export async function nextDraftContest({ sport = 'nfl', now = new Date() } = {}) {
  const r = await sql`
    SELECT * FROM contests
     WHERE game_type = 'draft' AND sport = ${sport} AND opens_at > ${now.toISOString()}
     ORDER BY opens_at ASC LIMIT 1`;
  return r[0] ?? null;
}

/**
 * Create the ranked contest for one NFL week if it is not already there.
 *
 * THE BOARD IS THE WEEKLY'S BOARD, deliberately. Both games settle against
 * contests.board, and if the two boards differed by even one player the same
 * performance would be worth different things in the two games - which would
 * make the shared tier ladder, and therefore the season standings, a lie.
 */
export async function ensureDraftWeek(season, week, { sport = 'nfl' } = {}) {
  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'draft' AND sport = ${sport}
       AND season_year = ${season} AND week = ${week}`;
  if (existing.length) return { id: existing[0].id, created: false };

  const ko = await firstKickoff(season, week);
  if (!ko) return { created: false, error: 'no kickoff found for that week' };

  // Prefer the Weekly's already-frozen board so the two games are scored
  // against identical rows; fall back to building one if the Weekly is absent.
  const weekly = await sql`
    SELECT board FROM contests
     WHERE game_type = 'weekly' AND sport = ${sport}
       AND season_year = ${season} AND week = ${week}`;
  const board = weekly[0]?.board ?? await activePool();
  if (!board?.length) return { created: false, error: 'empty player pool' };

  const opens = await easternLocalToUtc(tuesdayBefore(ko));
  const last = (await sql`
    SELECT max(m.kickoff_at) ko FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug='nfl' AND m.season_year=${season} AND m.season_phase='REG' AND m.week=${week}`)[0]?.ko;
  const settles = new Date(new Date(last ?? ko).getTime() + 12 * 3_600_000);

  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('draft', ${sport}, ${season}, ${week}, ${JSON.stringify(board)}::jsonb,
            ${opens}, ${new Date(ko).toISOString()}, ${settles.toISOString()},
            ${JSON.stringify({ config: DRAFT_CONFIG })}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type='draft' AND sport=${sport}
        AND season_year=${season} AND week=${week}`;
    return { id: again[0]?.id, created: false, raced: true };
  }
  return { id: r[0].id, created: true, poolSize: board.length, locksAt: ko, rounds: DRAFT_ROUNDS };
}
