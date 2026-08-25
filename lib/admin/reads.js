// lib/admin/reads.js - the admin console's readers. READ-ONLY, ALL OF THEM.
//
// EVERY QUERY HERE IS ONE THE USAGE-CHECK RELAYS HAVE RUN BY HAND ALL WEEK,
// moved out of throwaway scripts and into a module. That is the whole point of
// the panel: the cross-game read that has been arriving via chat becomes a
// page. Nothing here writes, and nothing here logs the fact that it ran - an
// admin loading this page is an ordinary request, not an event.
//
// NO NEW TABLES AND NO NEW TRACKING. Every figure comes from a table that
// already existed before this relay: users, puzzle_entries, puzzle_days,
// drafts, draft_picks, contests, contest_entries, player_leagues,
// league_members.

import { sql } from '../db.js';

/**
 * "ACTIVE TODAY" NEEDED A DEFINITION - the mock names the stat, not its
 * meaning. Sessions are the wrong source: they are long-lived in the shell,
 * so a session row proves an install, not a visit. The honest definition is
 * DID SOMETHING: a user who wrote a row today in any game table. Read from
 * the same three tables the funnel reads, so the number can never disagree
 * with the panels beneath it.
 */
export async function activeToday() {
  const r = await sql`
    SELECT count(DISTINCT uid)::int n FROM (
      SELECT user_id AS uid FROM puzzle_entries WHERE created_at >= date_trunc('day', now())
      UNION
      SELECT user_id FROM drafts WHERE started_at >= date_trunc('day', now())
      UNION
      SELECT user_id FROM contest_entries WHERE updated_at >= date_trunc('day', now())
    ) x WHERE uid IS NOT NULL`;
  return r[0].n;
}

/** The five stat cards. One round trip each, all trivially indexed. */
export async function overviewStats() {
  const [users, active, daily, mocks, leagues] = await Promise.all([
    sql`SELECT count(*)::int total,
               count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int today
          FROM users`,
    activeToday(),
    // Entrants on the most recent REVEALED day - the same revealed-only law
    // the boards obey, so the panel cannot leak an open day's participation.
    sql`SELECT count(e.id)::int entrants FROM puzzle_days p
          LEFT JOIN puzzle_entries e ON e.puzzle_date = p.puzzle_date
         WHERE p.revealed = true
           AND p.puzzle_date = (SELECT max(puzzle_date) FROM puzzle_days WHERE revealed)`,
    sql`SELECT count(*)::int started,
               count(*) FILTER (WHERE status = 'completed')::int completed
          FROM drafts WHERE mode = 'sim' AND started_at >= now() - interval '7 days'`,
    sql`SELECT (SELECT count(*)::int FROM player_leagues) leagues,
               (SELECT count(*)::int FROM league_members) members`,
  ]);
  const m = mocks[0];
  return {
    users: users[0].total,
    usersToday: users[0].today,
    activeToday: active,
    dailyEntrants: daily[0].entrants,
    totalUsers: users[0].total,
    mocksStarted: m.started,
    mockCompletionPct: m.started ? Math.round((m.completed / m.started) * 100) : null,
    leagues: leagues[0].leagues,
    leagueMembers: leagues[0].members,
  };
}

/**
 * The cross-game activity feed. ONE UNION, not four readers behind a tab -
 * the structural call, and the reason is the ordering: a feed sorted by time
 * across games cannot be assembled from per-game readers without pulling
 * everything and merging in JS anyway. The rows ARE the same shape (who,
 * game, when, what, result), so a shared reader is honest here; the
 * sibling-not-extension law applies where the shapes DISAGREE, and these do
 * not.
 */
export async function recentActivity({ limit = 25, game = null } = {}) {
  const rows = await sql`
    SELECT * FROM (
      SELECT u.handle, u.id AS user_id, 'daily' AS game,
             e.created_at AS at,
             CASE WHEN e.locked_at IS NULL THEN 'started' ELSE 'entered' END AS action,
             CASE WHEN p.revealed THEN e.score::text ELSE NULL END AS result,
             to_char(e.puzzle_date, 'YYYY-MM-DD') AS ref
        FROM puzzle_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN puzzle_days p ON p.puzzle_date = e.puzzle_date
      UNION ALL
      SELECT u.handle, u.id, CASE WHEN d.mode = 'tracker' THEN 'tracker' ELSE 'mock' END,
             d.started_at,
             CASE WHEN d.status = 'completed' THEN 'completed draft' ELSE 'started draft' END,
             (SELECT count(*)::text FROM draft_picks pk
               WHERE pk.draft_id = d.id AND pk.picked_by = 'user'),
             d.id::text
        FROM drafts d JOIN users u ON u.id = d.user_id
      UNION ALL
      SELECT u.handle, u.id, 'pickem', ce.updated_at, 'saved picks',
             (SELECT count(*)::text FROM jsonb_object_keys(COALESCE(ce.lineup, '{}'::jsonb))),
             ce.contest_id::text
        FROM contest_entries ce
        JOIN users u ON u.id = ce.user_id
        JOIN contests c ON c.id = ce.contest_id AND c.game_type = 'pickem'
    ) f
    WHERE (${game}::text IS NULL OR f.game = ${game})
    ORDER BY f.at DESC NULLS LAST
    LIMIT ${limit}`;
  return rows;
}

export const GAME_FILTERS = ['all', 'daily', 'mock', 'tracker', 'pickem'];

/**
 * GAMES ACTIVITY - a DIFFERENT SHAPE from the feed above, and that is the
 * structural call worth stating. The feed answers "what just happened" (one
 * row per event, newest first). This answers "what is the state of each
 * attempt" - started, status, score-or-progress. Same tables, different
 * question, so it gets its own reader rather than a mode flag on
 * recentActivity(). Both are UNIONs over the same four games because the
 * COLUMNS agree; where a game's row genuinely disagreed it would earn a
 * sibling reader, not a branch inside this one.
 */
export async function gamesActivity({ game = 'all', limit = 50 } = {}) {
  const g = GAME_FILTERS.includes(game) ? game : 'all';
  const want = g === 'all' ? null : g;
  return sql`
    SELECT * FROM (
      SELECT u.handle, u.id AS user_id, 'daily' AS game, e.created_at AS started,
             CASE WHEN p.revealed THEN 'Revealed'
                  WHEN e.locked_at IS NOT NULL THEN 'Locked'
                  ELSE 'In progress' END AS status,
             -- REVEALED-ONLY: an unrevealed day's score is not the admin's to
             -- see either. The panel obeys the same law the boards do.
             CASE WHEN p.revealed THEN to_char(e.score, 'FM990.0') END AS result
        FROM puzzle_entries e
        JOIN users u ON u.id = e.user_id
        LEFT JOIN puzzle_days p ON p.puzzle_date = e.puzzle_date
      UNION ALL
      SELECT u.handle, u.id, CASE WHEN d.mode = 'tracker' THEN 'tracker' ELSE 'mock' END,
             d.started_at,
             CASE WHEN d.status = 'completed' THEN 'Completed'
                  WHEN d.status = 'abandoned' THEN 'Abandoned'
                  ELSE 'In progress' END,
             (SELECT count(*)::text FROM draft_picks pk
               WHERE pk.draft_id = d.id AND pk.picked_by = 'user')
               -- ROUNDS IS NOT A COLUMN. It is the sum of the config's roster
               -- slots, which is where the room itself gets it; deriving it
               -- anywhere else would let the panel disagree with the room.
               || '/' || COALESCE(
                    (SELECT sum(v::int)::text FROM jsonb_each_text(cf.roster_slots) AS e(k, v)),
                    '?')
        FROM drafts d
        JOIN users u ON u.id = d.user_id
        LEFT JOIN draft_configs cf ON cf.id = d.config_id
      UNION ALL
      SELECT u.handle, u.id, 'pickem', ce.created_at,
             CASE WHEN c.settled THEN 'Settled'
                  WHEN c.locks_at <= now() THEN 'Locked' ELSE 'Open' END,
             (SELECT count(*)::text FROM jsonb_object_keys(COALESCE(ce.lineup, '{}'::jsonb)))
               || ' picks'
        FROM contest_entries ce
        JOIN users u ON u.id = ce.user_id
        JOIN contests c ON c.id = ce.contest_id AND c.game_type = 'pickem'
    ) a
    WHERE (${want}::text IS NULL OR a.game = ${want})
    ORDER BY a.started DESC NULLS LAST
    LIMIT ${limit}`;
}

/**
 * The signed-in admin's own handle, for the page header. Read, not assumed:
 * the NextAuth database session carries {id,name,email,image} and NO handle,
 * so hardcoding a fallback here would print a name the session never proved.
 * Null renders as the user id instead.
 */
export async function handleFor(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id)) return null;
  const [r] = await sql`SELECT handle FROM users WHERE id = ${id}`;
  return r?.handle ?? null;
}

/** Search by handle or email. Exact-ish, case-insensitive, capped. */
export async function findUsers(q) {
  const term = String(q ?? '').trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_]/g, '')}%`;
  return sql`
    SELECT id, handle, email, created_at, first_seen_context
      FROM users
     WHERE handle ILIKE ${like} OR email ILIKE ${like}
     ORDER BY id LIMIT 10`;
}

/**
 * ONE USER, EVERY GAME - the read the usage checks have been doing by hand.
 * Returns the head card's facts plus a row per game.
 */
export async function userDetail(userId) {
  const id = Number(userId);
  const [u] = await sql`SELECT id, handle, email, created_at, first_seen_context FROM users WHERE id = ${id}`;
  if (!u) return null;

  const [daily, drafts, pickem, leagues, lastSeen] = await Promise.all([
    sql`SELECT count(*)::int entries,
               count(*) FILTER (WHERE p.revealed)::int revealed,
               max(e.score) FILTER (WHERE p.revealed) AS best
          FROM puzzle_entries e LEFT JOIN puzzle_days p ON p.puzzle_date = e.puzzle_date
         WHERE e.user_id = ${id}`,
    sql`SELECT count(*) FILTER (WHERE mode = 'sim')::int mocks,
               count(*) FILTER (WHERE mode = 'sim' AND status = 'completed')::int mocks_done,
               count(*) FILTER (WHERE mode = 'tracker')::int trackers
          FROM drafts WHERE user_id = ${id}`,
    sql`SELECT count(*)::int entries FROM contest_entries ce
          JOIN contests c ON c.id = ce.contest_id AND c.game_type = 'pickem'
         WHERE ce.user_id = ${id}`,
    sql`SELECT pl.name, lm.joined_at FROM league_members lm
          JOIN player_leagues pl ON pl.id = lm.league_id
         WHERE lm.user_id = ${id} ORDER BY lm.joined_at`,
    // Last activity = the newest write across the same three tables the
    // "active today" definition uses, so the two can never disagree.
    sql`SELECT max(at) AS at FROM (
          SELECT max(created_at) AS at FROM puzzle_entries WHERE user_id = ${id}
          UNION ALL SELECT max(started_at) FROM drafts WHERE user_id = ${id}
          UNION ALL SELECT max(updated_at) FROM contest_entries WHERE user_id = ${id}
        ) x`,
  ]);

  return {
    user: u,
    lastActive: lastSeen[0]?.at ?? null,
    daily: daily[0],
    drafts: drafts[0],
    pickem: pickem[0],
    leagues,
  };
}
