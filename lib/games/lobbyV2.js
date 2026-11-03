// lib/games/lobbyV2.js - the Games tab v2 reader (GAMES TAB v2 relay).
//
// One call, every card. Each read is caught to null the way gamesLobby()'s
// are: a failed read ghosts its own card, never the page. Shapes come from
// lobbyV2Shape.js (pure); this file only fetches. PROD reads only.

import { sql } from '../db.js';
// THE THREE LIFTED READERS (TODAY TAB v2, Q3). They were private here while
// one page used them; the Today tab is the second, and two pages consuming a
// file named for one of them is how a lobby reader becomes an accidental
// framework. Nothing they do changed - tonight() is liveElseNext() unscoped,
// which is the same query with the same ORDER BY and the same LIMIT 2.
import { weeklyLive, latestRead, liveElseNext } from '../gridiron/todayReads.js';
import { dailyV2Home } from '../daily/seasonBoardHome.js';
import { todayEt, getDailyHome } from '../daily/entries.js';
import { todayLeaderboard, streakLeaderboard } from '../daily/seasonBoardLeaderboards.js';
import { getWeeklyHome } from '../weekly/entries.js';
import { pickemCardData } from '../pickem/entry.js';
import { getDraftHome } from '../draft/entry.js';
import { nextDraftContest, DRAFT_ROUNDS } from '../draft/contest.js';
import { section, shaped } from './lobbySection.js';
import { dailyCard, weeklyCard, pickemRow, draftRow, introLine } from './lobbyV2Shape.js';

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

export async function lobbyV2(userId = null, { now = new Date(), route = null, log = null, inject = null, health = null } = {}) {
  const uid = userId == null ? null : Number(userId);
  // EVERY MODULE FAILS ALONE (lib/games/lobbySection.js): a throw is logged to
  // app_errors and the module's fallback stands in; the rest of the lobby builds.
  const pending = [];
  const ctx = { route, uid, log, pending, inject, health };
  const S = (name, fn, fb = null) => section(name, fn, fb, ctx);
  const editionDate = await S('edition-date', () => todayEt());
  const [v2, v1, graded, best, streak, wHome, pkNfl, pkCfb, dHome, dNext, games, read, week, live, me] = await Promise.all([
    S('daily-home', () => dailyV2Home(uid, { editionDate })),
    S('daily-v1', () => getDailyHome(uid)),
    S('daily-graded', () => latestGraded(uid), { yesterday: null, rank: null }),
    S('daily-best', () => bestScore(uid)),
    S('daily-streak', () => currentStreak(uid, editionDate), 0),
    S('weekly-home', () => getWeeklyHome(uid)),
    S('pickem-nfl', () => pickemCardData(uid, { sport: 'nfl', now })),
    S('pickem-cfb', () => pickemCardData(uid, { sport: 'cfb', now })),
    uid == null ? null : S('draft-home', () => getDraftHome(uid, { now })),
    S('draft-next', () => nextDraftContest({ now })),
    S('tonight', () => liveElseNext({ uid, limit: 2 }), []),
    S('read', () => latestRead()),
    S('nfl-week', () => nflWeek(now)),
    S('live-count', () => liveCount(), 0),
    uid == null ? null : S('handle', () => sql`SELECT handle FROM users WHERE id = ${uid}`.then((r) => r[0] ?? null)),
  ]);
  const wl = await S('weekly-live', () => weeklyLive(uid, wHome), { scored: null, rank: null });
  const daily = shaped('daily-card', () => dailyCard({ board: v2?.board ?? null, run: v2?.run ?? null, yesterday: graded.yesterday, best, rank: graded.rank,
    edition: v1?.edition ?? null, playingToday: v2?.playingToday ?? 0, uid, now }), null, ctx);
  const weekly = shaped('weekly-card', () => weeklyCard({ home: wHome, scored: wl.scored, rank: wl.rank, uid }), null, ctx);
  const pickem = shaped('pickem-row', () => ({ ...pickemRow({ nfl: pkNfl, cfb: pkCfb, uid }), sports: { nfl: pkNfl, cfb: pkCfb } }),
    () => ({ sports: { nfl: pkNfl, cfb: pkCfb } }), ctx);
  const draft = shaped('draft-row', () => draftRow({ home: dHome, next: dNext ? { opensAt: dNext.opens_at, week: dNext.week } : null, rounds: DRAFT_ROUNDS }), null, ctx);
  const intro = shaped('intro-line', () => introLine({ daily, weekly, pickem, draft, liveCount: live }), null, ctx);
  await Promise.all(pending);
  return {
    now: now.toISOString(), week, streak: Number(streak) || 0, handle: me?.handle ?? null,
    intro, daily, weekly, pickem, draft, tonight: games, read,
    // THE RAW VIEWS THE PLAY REGISTRY READS (lib/games/playRegistry.js): the
    // same three reads the cards above are shaped from, so the Play tab's
    // Weekly and Draft items are the cards' facts, not a second read of them.
    weeklyHome: wHome ?? null, draftHome: dHome ?? null,
    // THE PLAY LOBBY'S DAILY BANNER (mon-2) reads today's edition, the
    // reader's run and the finisher count from this same read.
    dailyHome: v2 ?? null, editionDate,
    draftNext: dNext ? { opensAt: dNext.opens_at, week: dNext.week } : null,
  };
}
