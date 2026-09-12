// lib/games/lobbyV2.js - the Games tab v2 reader (GAMES TAB v2 relay).
//
// One call, every card. Each read is caught to null the way gamesLobby()'s
// are: a failed read ghosts its own card, never the page. Shapes come from
// lobbyV2Shape.js (pure); this file only fetches. PROD reads only.

import { sql } from '../db.js';
import { currentApRanks } from '../cfb/rankings.js';
import { dailyV2Home } from '../daily/seasonBoardHome.js';
import { todayEt, getDailyHome } from '../daily/entries.js';
import { todayLeaderboard, streakLeaderboard } from '../daily/seasonBoardLeaderboards.js';
import { getWeeklyHome, currentContest, getEntry } from '../weekly/entries.js';
import { liveScoredBoard, liveEntryRows, liveBoard, weeklyBoardTable } from '../weekly/live.js';
import { pickemCardData } from '../pickem/entry.js';
import { getDraftHome } from '../draft/entry.js';
import { nextDraftContest, DRAFT_ROUNDS } from '../draft/contest.js';
import { getSpreadHome } from '../gridiron/oddsReader.js';
import { teamColors } from '../gridiron/readers.js';
import { deriveReadTimeMin } from '../articles.js';
import { dailyCard, weeklyCard, pickemRow, draftRow, introLine } from './lobbyV2Shape.js';

const nul = (p) => p.catch(() => null);

/** Yesterday's (latest closed) edition: this reader's score, and their rank of N. */
async function latestGraded(uid) {
  const [board] = await sql`
    SELECT id FROM daily_boards WHERE now() >= closes_at ORDER BY edition_date DESC LIMIT 1`;
  if (!board) return { yesterday: null, rank: null };
  const rows = await todayLeaderboard(sql, board.id).catch(() => []);
  const mine = uid == null ? null : rows.find((r) => r.userId === uid) ?? null;
  // R5: dense rank on the latest graded edition; no run -> "-" of N, N kept.
  return {
    yesterday: mine ? { score: mine.primary } : null,
    rank: { rank: mine?.rank ?? null, of: rows.length },
  };
}

async function bestScore(uid) {
  if (uid == null) return null;
  const [r] = await sql`SELECT max(score) AS best FROM daily_board_runs WHERE user_id = ${uid} AND completed_at IS NOT NULL`;
  return r?.best == null ? null : Number(r.best);
}

async function currentStreak(uid, editionDate) {
  if (uid == null) return 0;
  const rows = await streakLeaderboard(sql, editionDate);
  return rows.find((r) => r.userId === uid)?.primary ?? rows.find((r) => r.userId === uid)?.current ?? 0;
}

/** Scored so far (live running total) and rank of N for the current Weekly. */
async function weeklyLive(uid, home) {
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

/** Live games first, else the next kickoffs, NFL and CFB together, two cards. */
async function tonight(uid) {
  const rows = await sql`
    SELECT m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score, m.metadata, m.week,
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
     LIMIT 2`;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [spreads, picks, ap] = await Promise.all([
    getSpreadHome(ids).catch(() => new Map()),
    uid == null ? {} : sql`
      SELECT e.lineup FROM contest_entries e JOIN contests c ON c.id = e.contest_id
       WHERE c.game_type = 'pickem' AND NOT c.settled AND e.user_id = ${uid}`
      .then((es) => Object.assign({}, ...es.map((e) => e.lineup ?? {}))).catch(() => ({})),
    // THE SAME AP READER THE SCORES TAB USES (R4). One module, one season and
    // week resolution, so a number here can never disagree with the number on
    // the Scores card for the same game.
    currentApRanks().catch(() => ({ ranks: new Map(), season: null, week: null })),
  ]);
  const rankOf = (leagueSlug, teamId) => (leagueSlug === 'cfb' ? ap.ranks.get(teamId) ?? null : null);
  return rows.map((r) => {
    const live = r.metadata?.live_state ?? null;
    const period = live?.period ?? live?.quarter ?? null;
    const clock = live?.clock ?? null;
    const side = picks[r.id] ?? picks[String(r.id)] ?? null;
    return {
      id: r.id, slug: r.slug, leagueSlug: r.league_slug, week: r.week, status: r.status, kickoffAt: r.kickoff_at,
      // THE RAW ABBREVIATION, NULL AND ALL: abbrOf() derives one from the
      // name when a side has none (an FCS visitor), and it must derive the
      // SAME three letters here as on the Scores tab.
      home: { name: r.home_short ?? r.home_name, shortName: r.home_short, abbreviation: r.home_abbr ?? null, colors: teamColors(r.home_c1, r.home_c2), score: r.home_score, rank: rankOf(r.league_slug, r.home_id) },
      away: { name: r.away_short ?? r.away_name, shortName: r.away_short, abbreviation: r.away_abbr ?? null, colors: teamColors(r.away_c1, r.away_c2), score: r.away_score, rank: rankOf(r.league_slug, r.away_id) },
      liveLabel: r.status === 'live' ? (period ? `Live · Q${period}${clock ? ` ${clock}` : ''}` : 'Live') : null,
      network: r.network ?? null,   // match_broadcasters, US primary (R3)
      spreadHome: spreads.get(r.id) ?? null,
      myPick: side === 'home' ? (r.home_abbr ?? r.home_short) : side === 'away' ? (r.away_abbr ?? r.away_short) : null,
      href: `/${r.league_slug}/game/${r.slug}`,
    };
  });
}

/** The latest published football article - nfl or cfb, never soccer (R4).
 *  None -> null, and the page omits the section entirely. */
async function latestRead() {
  const [a] = await sql`
    SELECT a.slug, a.title, a.subtitle, coalesce(length(a.body), 0) AS body_len
      FROM articles a JOIN leagues l ON l.id = a.league_id
     WHERE a.status = 'published' AND a.type <> 'preview' AND l.slug IN ('nfl', 'cfb')
     ORDER BY a.published_at DESC NULLS LAST LIMIT 1`;
  if (!a) return null;
  return { slug: a.slug, title: a.title, dek: a.subtitle ?? null, readMin: deriveReadTimeMin(a.body_len), href: `/article/${a.slug}` };
}

async function liveCount() {
  const [r] = await sql`
    SELECT count(*)::int AS n FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug IN ('nfl', 'cfb') AND m.status = 'live'`;
  return r?.n ?? 0;
}

async function nflWeek(now) {
  const [r] = await sql`
    SELECT week FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND upper(m.season_phase) = 'REG' AND m.kickoff_at > ${now.toISOString()}::timestamptz - interval '1 day'
     ORDER BY m.kickoff_at ASC LIMIT 1`;
  return r?.week ?? null;
}

export async function lobbyV2(userId = null, { now = new Date() } = {}) {
  const uid = userId == null ? null : Number(userId);
  const editionDate = await todayEt();
  const [v2, v1, graded, best, streak, wHome, pkNfl, pkCfb, dHome, dNext, games, read, week, live, me] = await Promise.all([
    nul(dailyV2Home(uid, { editionDate })),
    nul(getDailyHome(uid)),
    latestGraded(uid).catch(() => ({ yesterday: null, rank: null })),
    nul(bestScore(uid)),
    currentStreak(uid, editionDate).catch(() => 0),
    uid == null ? nul(getWeeklyHome(null)) : nul(getWeeklyHome(uid)),
    nul(pickemCardData(uid, { sport: 'nfl', now })),
    nul(pickemCardData(uid, { sport: 'cfb', now })),
    uid == null ? null : nul(getDraftHome(uid, { now })),
    nul(nextDraftContest({ now })),
    tonight(uid).catch(() => []),
    nul(latestRead()),
    nul(nflWeek(now)),
    liveCount().catch(() => 0),
    uid == null ? null : sql`SELECT handle FROM users WHERE id = ${uid}`.then((r) => r[0] ?? null).catch(() => null),
  ]);
  const wl = await weeklyLive(uid, wHome).catch(() => ({ scored: null, rank: null }));
  const daily = dailyCard({ board: v2?.board ?? null, run: v2?.run ?? null, yesterday: graded.yesterday, best, rank: graded.rank,
    edition: v1?.edition ?? null, playingToday: v2?.playingToday ?? 0, uid, now });
  const weekly = weeklyCard({ home: wHome, scored: wl.scored, rank: wl.rank, uid });
  const pickem = { ...pickemRow({ nfl: pkNfl, cfb: pkCfb, uid }), sports: { nfl: pkNfl, cfb: pkCfb } };
  const draft = draftRow({ home: dHome, next: dNext ? { opensAt: dNext.opens_at, week: dNext.week } : null, rounds: DRAFT_ROUNDS });
  const intro = introLine({ daily, weekly, pickem, draft, liveCount: live });
  return {
    now: now.toISOString(), week, streak: Number(streak) || 0, handle: me?.handle ?? null,
    intro, daily, weekly, pickem, draft, tonight: games, read,
  };
}
