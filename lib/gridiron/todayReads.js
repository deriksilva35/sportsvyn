// lib/gridiron/todayReads.js - readers shared by the games lobby and the Today tab.
//
// LIFTED OUT OF lib/games/lobbyV2.js (TODAY TAB v2, Q3). All three were
// module-private there, which was correct while one page used them. Two pages
// consuming a file named for one of them is how a lobby reader becomes an
// accidental framework, so they moved here rather than gaining an export.
//
// NOTHING ABOUT THEIR BEHAVIOUR CHANGED IN THE LIFT except where a ruling
// says so, and each of those is marked. The lobby imports them from here and
// renders exactly what it rendered before; a test pins that.
//
//   weeklyLive      the viewer's Weekly running score and rank of N
//   latestRead      the newest football article, or null
//   liveElseNext    live games first, then the next kickoffs

import { sql } from '../db.js';
import { currentContest, getEntry } from '../weekly/entries.js';
import { liveScoredBoard, liveEntryRows, liveBoard, weeklyBoardTable } from '../weekly/live.js';
import { getSpreadHome } from './oddsReader.js';
import { currentApRanks } from '../cfb/rankings.js';
import { teamColors } from './readers.js';
import { deriveReadTimeMin } from '../articles.js';

/**
 * Scored so far (live running total) and rank of N for the current Weekly.
 *
 * THE RANK IS PRINTED EVEN AT "#1 of 1" (Q4). A rank line that hides itself
 * when the field is small teaches nobody anything, and the number is honest.
 */
export async function weeklyLive(uid, home) {
  if (uid == null || !home || home.state === 'none') return { scored: null, rank: null };
  const contest = await currentContest();
  if (!contest) return { scored: null, rank: null };
  if (contest.settled) {
    const t = await weeklyBoardTable(contest, uid).catch(() => null);
    const mine = t?.self ?? t?.top?.find((r) => r.userId === uid) ?? null;
    return { scored: mine?.points ?? null, rank: mine ? { rank: mine.rank, of: null } : null };
  }
  const entry = await getEntry(contest.id, uid);
  if (!entry) return { scored: null, rank: null };
  const { scored, playedIds } = await liveScoredBoard(contest);
  const mine = liveEntryRows({ lineup: entry.lineup ?? {}, scored, playedIds });
  const rows = await liveBoard(contest, { limit: 100000 }).catch(() => []);
  const me = rows.find((r) => r.userId === uid);
  return { scored: mine.total, rank: me ? { rank: me.rank, of: rows.length } : null };
}

/**
 * THE WEEKLY HERO'S WHOLE READ (TODAY TAB v2, block a). weeklyLive answers
 * "how am I doing"; the hero also has to draw all six slots, the progress bar
 * and the leader, so this returns the rows and the board alongside.
 *
 * ALL SIX SLOTS, INCLUDING EMPTY ONES. liveEntryRows already walks SLOTS and
 * returns a row per slot with a null id where nothing is set - and the hero
 * wants that, because an unset slot is a thing the reader should see. Note
 * stakeForMatches filters those out; this does not.
 */
export async function weeklyHero(uid) {
  if (uid == null) return null;
  const contest = await currentContest();
  if (!contest) return null;
  const entry = await getEntry(contest.id, uid);
  if (!entry) return null;
  const { scored, playedIds } = await liveScoredBoard(contest);
  const mine = liveEntryRows({ lineup: entry.lineup ?? {}, scored, playedIds });
  const board = await liveBoard(contest, { limit: 100000 }).catch(() => []);
  const me = board.find((r) => r.userId === uid) ?? null;
  return {
    contestId: contest.id, week: contest.week, settled: Boolean(contest.settled),
    rows: mine.rows, total: mine.total, playedCount: mine.playedCount, slots: mine.slots,
    rank: me ? me.rank : null,
    of: board.length,
    leader: board.length ? board[0].total : null,
  };
}

/** The latest published football article - nfl or cfb, never soccer.
 *  None -> null, and the page omits the section entirely (R2). */
export async function latestRead() {
  const [a] = await sql`
    SELECT a.slug, a.title, a.subtitle, coalesce(length(a.body), 0) AS body_len
      FROM articles a JOIN leagues l ON l.id = a.league_id
     WHERE a.status = 'published' AND a.type <> 'preview' AND l.slug IN ('nfl', 'cfb')
     ORDER BY a.published_at DESC NULLS LAST LIMIT 1`;
  if (!a) return null;
  return { slug: a.slug, title: a.title, dek: a.subtitle ?? null, readMin: deriveReadTimeMin(a.body_len), href: `/article/${a.slug}` };
}

/** The live label a card shows: "Live · Q3 7:22", or plain Live, or null. */
export function liveLabelOf(status, metadata) {
  if (status !== 'live') return null;
  const live = metadata?.live_state ?? null;
  const period = live?.period ?? live?.quarter ?? null;
  const clock = live?.clock ?? null;
  return period ? `Live · Q${period}${clock ? ` ${clock}` : ''}` : 'Live';
}

/**
 * LIVE GAMES FIRST, THEN THE NEXT KICKOFFS - the shape the lobby's Tonight
 * strip has always used, now shared.
 *
 * `teamIds` scopes it to a set of teams (the Today tab's "Your teams" hands
 * it the reader's follows); omitted, it is the whole gridiron slate, which is
 * what the lobby asks for.
 *
 * ONE ROW PER TEAM when scoped (DISTINCT ON), because a follower wants a
 * schedule, not a fixture list - and the ORDER BY puts a live game ahead of a
 * scheduled one for the same team, which is the whole point of live-else-next.
 */
export async function liveElseNext({ uid = null, teamIds = null, limit = 2 } = {}) {
  const scoped = Array.isArray(teamIds);
  if (scoped && teamIds.length === 0) return [];
  const rows = scoped
    ? await sql`
      SELECT DISTINCT ON (t.id) t.id AS for_team_id, t.name AS for_name, t.abbreviation AS for_abbr,
             m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score, m.metadata, m.week,
             l.slug AS league_slug,
             h.id AS home_id, a.id AS away_id,
             h.name AS home_name, h.short_name AS home_short, h.abbreviation AS home_abbr, h.color_primary AS home_c1, h.color_secondary AS home_c2,
             a.name AS away_name, a.short_name AS away_short, a.abbreviation AS away_abbr, a.color_primary AS away_c1, a.color_secondary AS away_c2,
             NULL::text AS network
        FROM teams t
        JOIN matches m ON (m.home_team_id = t.id OR m.away_team_id = t.id)
        JOIN leagues l ON l.id = m.league_id
        JOIN teams h ON h.id = m.home_team_id
        JOIN teams a ON a.id = m.away_team_id
       WHERE t.id = ANY(${teamIds})
         AND (m.status = 'live' OR (m.status = 'scheduled' AND m.kickoff_at > now()))
       ORDER BY t.id, (m.status = 'live') DESC, m.kickoff_at ASC, m.id ASC`
    : await sql`
      SELECT NULL::integer AS for_team_id, NULL::text AS for_name, NULL::text AS for_abbr,
             m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score, m.metadata, m.week,
             l.slug AS league_slug,
             h.id AS home_id, a.id AS away_id,
             h.name AS home_name, h.short_name AS home_short, h.abbreviation AS home_abbr, h.color_primary AS home_c1, h.color_secondary AS home_c2,
             a.name AS away_name, a.short_name AS away_short, a.abbreviation AS away_abbr, a.color_primary AS away_c1, a.color_secondary AS away_c2,
             bc.broadcaster_name AS network
        FROM matches m
        JOIN leagues l ON l.id = m.league_id
        JOIN teams h ON h.id = m.home_team_id
        JOIN teams a ON a.id = m.away_team_id
        LEFT JOIN LATERAL (
          SELECT broadcaster_name FROM match_broadcasters b
           WHERE b.match_id = m.id AND b.country_code = 'US'
           ORDER BY b.is_primary DESC, b.display_order ASC LIMIT 1
        ) bc ON true
       WHERE l.slug IN ('nfl', 'cfb')
         AND (m.status = 'live' OR (m.status = 'scheduled' AND m.kickoff_at > now()))
       ORDER BY (m.status = 'live') DESC, m.kickoff_at ASC, m.id ASC
       LIMIT ${limit}`;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [spreads, picks, ap] = await Promise.all([
    getSpreadHome(ids).catch(() => new Map()),
    uid == null ? {} : sql`
      SELECT e.lineup FROM contest_entries e JOIN contests c ON c.id = e.contest_id
       WHERE c.game_type = 'pickem' AND NOT c.settled AND e.user_id = ${uid}`
      .then((es) => Object.assign({}, ...es.map((e) => e.lineup ?? {}))).catch(() => ({})),
    currentApRanks().catch(() => ({ ranks: new Map(), season: null, week: null })),
  ]);
  const rankOf = (leagueSlug, teamId) => (leagueSlug === 'cfb' ? ap.ranks.get(teamId) ?? null : null);
  const shaped = rows.map((r) => {
    const side = picks[r.id] ?? picks[String(r.id)] ?? null;
    return {
      id: r.id, slug: r.slug, leagueSlug: r.league_slug, week: r.week, status: r.status, kickoffAt: r.kickoff_at,
      // THE RAW ABBREVIATION, NULL AND ALL: abbrOf() derives one from the name
      // when a side has none, and it must derive the SAME three letters here
      // as on the Scores tab.
      home: { id: r.home_id, name: r.home_short ?? r.home_name, shortName: r.home_short, abbreviation: r.home_abbr ?? null, colors: teamColors(r.home_c1, r.home_c2), score: r.home_score, rank: rankOf(r.league_slug, r.home_id) },
      away: { id: r.away_id, name: r.away_short ?? r.away_name, shortName: r.away_short, abbreviation: r.away_abbr ?? null, colors: teamColors(r.away_c1, r.away_c2), score: r.away_score, rank: rankOf(r.league_slug, r.away_id) },
      liveLabel: liveLabelOf(r.status, r.metadata),
      network: r.network ?? null,
      spreadHome: spreads.get(r.id) ?? null,
      myPick: side === 'home' ? (r.home_abbr ?? r.home_short) : side === 'away' ? (r.away_abbr ?? r.away_short) : null,
      href: `/${r.league_slug}/game/${r.slug}`,
      forTeamId: r.for_team_id ?? null,
      forName: r.for_abbr || r.for_name || null,
    };
  });
  // Scoped: DISTINCT ON gave one row per team in team order, so sort the
  // teams against each other - live first, then soonest.
  if (!scoped) return shaped;
  return shaped
    .sort((x, y) => (x.status === 'live' ? 0 : 1) - (y.status === 'live' ? 0 : 1)
      || new Date(x.kickoffAt) - new Date(y.kickoffAt))
    .slice(0, limit);
}
