// lib/gridiron/landingModules.js — the league landing's bottom half, read.
//
// FOUR MODULES, FOUR READS, ONE RULE THEY ALL SHARE: a module whose read comes
// back empty does not render. Not a frame, not a dash, not "no data yet" - the
// module is absent. A screen of empty shells reads as broken; a shorter screen
// reads as a quiet week.

import { sql } from '../db.js';
import { getLeagueRecords } from '../standings/read.js';

/**
 * THE STANDINGS SNAPSHOT: one group, top five.
 *
 * THE GROUP IS THE READER'S, WHEN WE KNOW IT. A signed-in reader who follows a
 * team gets that team's conference or division, because the standings they care
 * about are the ones their team is in. Everyone else gets the default. We never
 * guess from a location, a previous visit or anything else - a follow is the
 * only statement of allegiance the reader has actually made.
 */
export const DEFAULT_GROUP = Object.freeze({ cfb: 'ACC', nfl: 'AFC East' });

export async function followedGroup(userId, leagueSlug, season) {
  if (userId == null) return null;
  try {
    const rows = await sql`
      SELECT tr.conference, tr.division
        FROM user_team_follows f
        JOIN teams t ON t.id = f.team_id
        JOIN leagues l ON l.id = t.league_id AND l.slug = ${leagueSlug}
        JOIN team_records tr ON tr.team_id = t.id AND tr.league_id = l.id
                            AND tr.season = ${season} AND tr.season_type = 'regular'
       WHERE f.user_id = ${userId}
       ORDER BY f.followed_at ASC
       LIMIT 1`;
    const r = rows[0];
    if (!r) return null;
    // The NFL groups conference THEN division; college groups by conference
    // alone. The label is the one the snapshot will match on.
    return leagueSlug === 'nfl'
      ? [r.conference, r.division].filter(Boolean).join(' ') || null
      : r.conference ?? null;
  } catch { return null; }
}

const groupLabel = (leagueSlug, r) => (leagueSlug === 'nfl'
  ? [r.conference, r.division].filter(Boolean).join(' ')
  : (r.conference ?? ''));

export async function standingsSnapshot(leagueSlug, season, { userId = null, limit = 5 } = {}) {
  try {
    const [rows, followed] = await Promise.all([
      getLeagueRecords(leagueSlug, season, leagueSlug === 'cfb' ? { classification: 'fbs' } : {}),
      followedGroup(userId, leagueSlug, season),
    ]);
    if (!rows.length) return null;
    const want = followed && rows.some((r) => groupLabel(leagueSlug, r) === followed)
      ? followed
      : DEFAULT_GROUP[leagueSlug];
    const mine = rows.filter((r) => groupLabel(leagueSlug, r) === want);
    if (!mine.length) return null;
    const top = mine.slice(0, limit);
    // A COLUMN APPEARS ONLY WHEN SOMEBODY HAS A NUMBER IN IT. CFBD publishes no
    // streak and no points for college, so a CFB snapshot would otherwise draw
    // two columns of dashes - the same rule the NFL standings page applies to
    // its SEED column, for the same reason.
    return {
      group: want,
      fromFollow: want === followed,
      rows: top,
      hasStreak: top.some((r) => r.streak != null && r.streak !== 0),
      hasPoints: top.some((r) => r.points_for != null),
    };
  } catch { return null; }
}

/**
 * THE MARKET MODULE: the next three priced games for a league.
 *
 * ONE SOURCE FOR THE LINE. The spread comes through oddsReader - the same
 * odds_markets rows, guards and side resolution the Market page and the pick'em
 * board read. This file does not open its own odds query, and a test forbids it.
 *
 * isPreGame AT THE FETCH: only scheduled games are asked for, because a line on
 * a game that has kicked is a fossil the ingest froze.
 */
export async function marketRows(leagueSlug, { limit = 3, now = new Date() } = {}) {
  try {
    const games = await sql`
      SELECT m.id, m.slug, m.kickoff_at,
             h.abbreviation AS home_abbr, a.abbreviation AS away_abbr
        FROM matches m
        JOIN leagues l ON l.id = m.league_id AND l.slug = ${leagueSlug}
        LEFT JOIN teams h ON h.id = m.home_team_id
        LEFT JOIN teams a ON a.id = m.away_team_id
       WHERE m.status = 'scheduled' AND m.kickoff_at > ${new Date(now).toISOString()}
       ORDER BY m.kickoff_at ASC
       LIMIT 24`;
    if (!games.length) return [];
    const { getSpreadHome, getTotalPoints } = await import('./oddsReader.js');
    const ids = games.map((g) => g.id);
    const [spreads, totals] = await Promise.all([
      getSpreadHome(ids).catch(() => new Map()),
      getTotalPoints(ids).catch(() => new Map()),
    ]);
    // ONLY PRICED GAMES. A row with no spread is not a market row - the module
    // is about the line, and a line-less row would be a fixture list wearing a
    // market heading.
    return games
      // BOTH SIDES MUST BE NAMEABLE. The spread names its favourite, so a row
      // missing an abbreviation cannot state which team is favoured - and a
      // market row that will not say who is a fixture wearing a market
      // heading. Dropped, not rendered with a blank.
      .filter((g) => spreads.has(g.id) && g.home_abbr && g.away_abbr)
      .slice(0, limit)
      .map((g) => ({
        matchId: g.id, slug: g.slug, kickoffAt: g.kickoff_at,
        homeAbbr: g.home_abbr, awayAbbr: g.away_abbr,
        spreadHome: spreads.get(g.id) ?? null,
        total: totals.get(g.id) ?? null,
      }));
  } catch { return []; }
}

/**
 * WEEK LEADERS: the passing, rushing and receiving yards leader for one REG week.
 *
 * REG-ONLY AND WEEK-SCOPED. A leader is a claim about a specific week of a
 * specific season; a query that forgets either would crown somebody on a career
 * total. The two codes keep separate tables with separate column names
 * (rush_car vs rush_att), so the column list is per code rather than assumed.
 *
 * LIVE DURING GAMES for the NFL, because nfl_player_game_stats is written by
 * the existing tick; CFB fills at final via the hourly import.
 */
const LEADER_CATS = Object.freeze([
  { key: 'pass', label: 'PASSING', col: 'pass_yds' },
  { key: 'rush', label: 'RUSHING', col: { cfb: 'rush_yds', nfl: 'rush_yds' } },
  { key: 'rec', label: 'RECEIVING', col: 'rec_yds' },
]);

export async function weekLeaders(leagueSlug, season, week) {
  if (!season || !week) return [];
  const isCfb = leagueSlug === 'cfb';
  const table = isCfb ? 'cfb_player_game_stats' : 'nfl_player_game_stats';
  const playerJoin = isCfb ? 'g.player_id' : 'g.nfl_player_id';
  const out = [];
  for (const cat of LEADER_CATS) {
    const col = typeof cat.col === 'string' ? cat.col : cat.col[leagueSlug];
    try {
      const rows = await sql.query(
        `SELECT p.full_name, p.slug, g.${col} AS yards, t.abbreviation
           FROM ${table} g
           JOIN matches m ON m.id = g.match_id
           JOIN leagues l ON l.id = m.league_id AND l.slug = $1
           JOIN players p ON p.id = ${playerJoin}
           LEFT JOIN teams t ON t.id = p.current_team_id
          WHERE m.season_year = $2 AND m.week = $3 AND m.season_phase = 'REG'
            AND g.${col} IS NOT NULL
          ORDER BY g.${col} DESC
          LIMIT 1`,
        [leagueSlug, season, week],
      );
      const r = rows[0];
      // A category nobody has a number in does not get a row.
      if (r && Number(r.yards) > 0) {
        out.push({
          key: cat.key, label: cat.label, name: r.full_name,
          slug: r.slug ?? null, abbr: r.abbreviation ?? null, yards: Number(r.yards),
        });
      }
    } catch { /* one category failing must not empty the module */ }
  }
  return out;
}

/**
 * READS: published articles for this league, newest first.
 *
 * ZERO IS THE HONEST ANSWER TODAY. Every published article on the platform
 * belongs to a World Cup league; neither gridiron code has one yet, so the
 * module is absent on both. It appears the day an article is published against
 * their league_id, with no further work.
 */
export async function leagueReads(leagueSlug, { limit = 3 } = {}) {
  try {
    return await sql`
      SELECT a.slug, a.title, a.subtitle, a.published_at
        FROM articles a
        JOIN leagues l ON l.id = a.league_id AND l.slug = ${leagueSlug}
       WHERE a.status = 'published'
       ORDER BY a.published_at DESC NULLS LAST
       LIMIT ${limit}`;
  } catch { return []; }
}
