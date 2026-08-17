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
 * The season arm 2 looks back at.
 *
 * THE LAST COMPLETED REGULAR SEASON, and it is the only number in this module
 * that ages. It ages harmlessly: leaving it a year stale only widens the safety
 * net, which is the direction that keeps a real player on the board rather than
 * removing one. Arm 1 carries no year at all.
 */
export const ACTIVE_STAT_SEASON = 2025;

const BDL_BASE = 'https://api.balldontlie.io';

/**
 * Every player BDL currently lists as active, as a Set of bdl ids.
 *
 * RETURNS NULL ON FAILURE, NEVER AN EMPTY SET. An empty set would filter the
 * whole board away and read as "nobody is on a roster"; null is the caller's
 * signal to fall back to unfiltered. The distinction is the difference between
 * a bad board and no board.
 */
export async function activeBdlPlayerIds({ fetchImpl = fetch } = {}) {
  const key = process.env.BDL_API_KEY;
  if (!key) return null;
  try {
    const ids = new Set();
    let cursor = null;
    do {
      const url = `${BDL_BASE}/nfl/v1/players/active?per_page=100${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await fetchImpl(url, { headers: { Authorization: key } });
      if (!res.ok) return null;
      const j = await res.json();
      for (const p of j.data ?? []) ids.add(String(p.id));
      cursor = j.meta?.next_cursor ?? null;
    } while (cursor);
    return ids.size ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Every ACTIVE skill player, with the resume the builder shows.
 * Returns the array that gets frozen into contests.board.
 *
 * ============================================================================
 * TWO ARMS, AND EACH COVERS THE OTHER'S BLIND SPOT
 * ============================================================================
 *   arm 1  on BDL's CURRENT active roster  -> current roster, INCLUDING rookies
 *   arm 2  a 2025 REG stat row             -> unsigned-vet safety net
 *
 * ARM 1 IS THE ONLY THING THAT KNOWS ABOUT ROOKIES. A 2026 first-round pick has
 * no NFL history of any kind, so every backward-looking signal - stat rows,
 * nfl_player_seasons, career index - excludes them by construction. Only a
 * current roster source can say Carson Beck belongs on a Week 1 board, and
 * BDL's /players/active flags exactly that, "Rookie" and college attached.
 *
 * ARM 2 CATCHES WHO ARM 1 MISSES. /players/active is a snapshot: in August a
 * genuine veteran between contracts is simply not on it. Measured against the
 * real pool, 62 players survive on this arm alone - Garoppolo, Jonnu Smith,
 * DeAndre Hopkins, Keenan Allen, Taysom Hill. Dropping them because they were
 * unsigned the morning the board was built would be a worse error than the one
 * this filter is here to fix.
 *
 * WHAT IT REMOVES. PROD's unfiltered pool was 1,851 because a bulk BDL player
 * import on 2026-08-04 added 582 historical stubs with team_ids attached -
 * Glenn Gronkowski, Donnel Pumphrey, Jake Dolegala, out of the league for
 * years. None has a single stat row and 573 of 582 fail both arms. They are not
 * rookies and never were; the delta was NEWER than the rest of the table, not
 * older, which is what made it look like retained history and is not.
 *
 * THE NO-CURATION RULING STILL STANDS. This is an ACTIVENESS filter, not a
 * quality floor. Every rookie and every unknown stays: 319 players on the
 * resulting board have no stat row at all, which is the whole point of a
 * prediction game. The Daily's floor rule still does not port - it curates a
 * HISTORICAL board where a sub-floor row is known-worthless, while here the
 * players nobody can price yet are the only picks that can win a week. A blank
 * PPG sorts LAST (poolRows in view.js), the resume still identifies them by
 * draft slot and college ("R1 #2 - LSU"), and search reaches them by name.
 *
 * COST: about 30 paginated requests (~3,000 active players at 100 a page), once,
 * at board creation - so once a week per sport.
 *
 * NO ANNUAL TOUCH-POINT. Calling /players/active at every board creation IS the
 * roster refresh. There is no seasonal import to remember, no table to top up,
 * and no year hardcoded anywhere in arm 1: cuts, signings, promotions and next
 * year's rookie class all arrive on their own. Arm 2's season is the one number
 * that ages, and it ages harmlessly - a stale year only widens the safety net.
 *
 * FAILURE DIRECTION IS DELIBERATE. If the active fetch throws, the pool falls
 * back to UNFILTERED rather than empty. A board with retired stubs on it is a
 * bad board; a board with no players is not a board, and the week has a
 * deadline that does not move.
 */
export async function activePool({
  resumeByPlayer = null, careerByPlayer = null,
  activeBdlIds = null, statSeason = ACTIVE_STAT_SEASON,
} = {}) {
  const all = await sql`
    SELECT np.id, np.bdl_player_id, np.full_name, np.position, t.abbreviation AS team
      FROM nfl_players np
      JOIN teams t ON t.id = np.team_id
     WHERE np.position = ANY(${POOL_POSITIONS})
       AND np.is_team_defense IS NOT TRUE
     ORDER BY np.id`;

  // arm 1 - current roster. Injectable so a test can drive it without a network.
  const active = activeBdlIds ?? await activeBdlPlayerIds();
  // arm 2 - the unsigned-vet safety net.
  const played = new Set((await sql`
    SELECT DISTINCT s.nfl_player_id AS id
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
     WHERE m.season_year = ${statSeason} AND m.season_phase = 'REG'`).map((r) => String(r.id)));

  const rows = active == null
    // The fetch failed. Unfiltered beats empty - see FAILURE DIRECTION above.
    ? all
    : all.filter((r) => active.has(String(r.bdl_player_id)) || played.has(String(r.id)));

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
