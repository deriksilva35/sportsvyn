// lib/weekly/pool.js - the week's player pool. The DB half.
//
// ACTIVE ROSTERS, SNAPSHOTTED AT BOARD CREATION. The pool is frozen into
// contests.board the moment the week's board is made, and it never moves
// again. A player signed on Friday is simply absent from that week - stated in
// the rules - because the alternative is a pool that shifts under a lineup
// somebody already saved, and a saved lineup that silently becomes invalid is
// worse than a pool that is one signing short.
//
// SOURCE IS nfl_players, NOT nfl_player_seasons. nfl_player_seasons is the
// historical artefact the Daily's 2015-24 corpus needs; it stops at 2024 and
// would exclude every rookie. nfl_players carries position and team_id for
// 13,559 players and is refreshed weekly by ingestAllPlayers in the Tuesday
// cron - the one part of that job doing useful work today.
//
// ROOKIES RENDER WHAT EXISTS. The resume line comes from the nflverse
// players.csv path where the player is in it, and is simply shorter where he
// is not. A rookie with no college/draft data gets his name and his position,
// which is what we know.

import { sql } from '../db.js';
import { resumeIndex, careerIndex } from '../daily/create.js';
import { resumeLine } from '../daily/pool.js';

export const POOL_POSITIONS = ['QB', 'RB', 'WR', 'TE'];

/**
 * Every rostered skill player, with the resume the builder shows.
 * Returns the array that gets frozen into contests.board.
 *
 * NO FLOOR, NO CURATION - ALL OF THEM. The 2026 Week 1 board is 1,269 players
 * and 525 of them have no PPG figure at all, which looks like noise worth
 * trimming and is not. THOSE ROWS ARE THE ROOKIES. A 2026 first-round pick has
 * no NFL games by definition, and belongs on a Week 1 board more than half the
 * veterans do.
 *
 * THE DAILY'S FLOOR RULE DOES NOT PORT HERE, and the difference is what the two
 * games ask. The Daily curates a HISTORICAL board where a sub-floor row is
 * known-worthless - the season already happened, the player already did nothing.
 * The Weekly is a PREDICTION, and its unknowns are the entire point; cutting the
 * players nobody can price yet would cut the only picks that can win a week.
 *
 * They are findable rather than in the way: a blank PPG sorts LAST (see
 * poolRows in view.js), the resume line still identifies them by draft slot and
 * college ("R1 #2 · LSU"), and the search field reaches them by name.
 *
 * Revisit only with real Week 1 rostering data.
 */
export async function activePool({ resumeByPlayer = null, careerByPlayer = null } = {}) {
  const rows = await sql`
    SELECT np.id, np.full_name, np.position, t.abbreviation AS team
      FROM nfl_players np
      JOIN teams t ON t.id = np.team_id
     WHERE np.position = ANY(${POOL_POSITIONS})
       AND np.is_team_defense IS NOT TRUE
     ORDER BY np.id`;

  const [resume, career] = await Promise.all([
    resumeByPlayer ? Promise.resolve(resumeByPlayer) : resumeIndex(),
    careerByPlayer ? Promise.resolve(careerByPlayer) : careerIndex(),
  ]);

  return rows.map((r) => {
    const meta = resume.get(r.id) ?? {};
    return {
      id: r.id,
      name: r.full_name,
      pos: r.position,
      team: r.team,
      // THE TEAM IS PUBLIC HERE, unlike the Daily. The Daily hides it because a
      // 2015 Rams row says St Louis and dates the board; this week's team is
      // not a clue, it is the whole point of picking a player.
      resume: resumeLine({
        college: meta.college, draftRound: meta.draftRound, draftPick: meta.draftPick,
        pos: r.position, career: career.get(r.id) ?? null,
      }),
    };
  });
}

/** The week's games, with their stat-line counts - the settle gate's input. */
export async function weekGames(season, week) {
  return sql`
    SELECT m.id, m.status,
           at.abbreviation || '@' || ht.abbreviation AS label,
           m.kickoff_at,
           (SELECT count(*)::int FROM nfl_player_game_stats s WHERE s.match_id = m.id) AS "statLines"
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season}
       AND m.season_phase = 'REG' AND m.week = ${week}
     ORDER BY m.kickoff_at`;
}

/** First kickoff of the week - the lock moment, snapshotted at creation. */
export async function firstKickoff(season, week) {
  const r = await sql`
    SELECT min(m.kickoff_at) AS ko
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season}
       AND m.season_phase = 'REG' AND m.week = ${week}`;
  return r[0]?.ko ?? null;
}

/**
 * Every player's actual PPR for the week, keyed by player id.
 *
 * READS nfl_player_game_stats (BDL), which is what the Tuesday sweep writes and
 * what scoring.js was built around. If BDL proves late or absent in season -
 * and it has never once delivered in season - the settle gate REFUSES rather
 * than settling on a hole, and the fallback is gridiron_player_lines, whose
 * `parsed` shape fantasyPoints already accepts. That swap is a reader change,
 * not a rewrite, which is why the reader is its own function.
 */
export async function weekScores(season, week) {
  const rows = await sql`
    SELECT s.nfl_player_id AS id,
           s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td, s.pass_int,
           s.rush_att, s.rush_yds, s.rush_td,
           s.tgt, s.rec, s.rec_yds, s.rec_td, s.fumbles_lost,
           s.fgm, s.fga, s.fg_long, s.xp
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season}
       AND m.season_phase = 'REG' AND m.week = ${week}`;
  return rows;
}
