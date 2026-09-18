// lib/games/lobbyV3.js - the Games tab v3 reader.
//
// ONE CALL, EVERY CHIP, AND NOTHING THE SITE DOES NOT ALREADY COMPUTE. It
// composes readers that exist - lobbyV2's own fifteen, plus three small reads
// the v3 rows need and nothing else did - and hands the result to two pure
// shapers (nowCard.js, v3Rows.js). Every read is caught to null the way
// gamesLobby()'s are: a failed read ghosts its own row, never the page.
//
// THE THREE NEW READS, and why each is new rather than lifted:
//   the Weekly's six names   liveEntryRows needs the week's scored board, which
//                            the lobby never fetched - the card only ever
//                            showed a total.
//   the Pick'em record       there is no live grader anywhere in the app; this
//                            builds one from FINAL games only (v3Rows.js).
//   the Daily's last seven   the History pane had it per edition; the Results
//                            chip wants it per DAY with elapsed, which
//                            migration 097's two stamps make derivable.

import { sql } from '../db.js';
import { lobbyV2 } from './lobbyV2.js';
import { nowCard } from './nowCard.js';
import { weeklyRowV3, pickemRecord, pickemRowV3, dailyRowV3, draftRowV3, elapsedOf } from './v3Rows.js';
import { pctOfCeiling } from '../daily/format.js';
import { currentContest, getEntry } from '../weekly/entries.js';
import { liveScoredBoard, liveEntryRows } from '../weekly/live.js';
import { DRAFT_ROUNDS } from '../draft/contest.js';

const nul = (p) => (p && typeof p.catch === 'function' ? p.catch(() => null) : p);

/** The reader's six, with names and points, or []. One read, only when needed. */
async function weeklySix(uid) {
  if (uid == null) return [];
  const contest = await currentContest();
  if (!contest) return [];
  const entry = await getEntry(contest.id, Number(uid));
  if (!entry) return [];
  const { scored, playedIds } = await liveScoredBoard(contest);
  return liveEntryRows({ lineup: entry.lineup ?? {}, scored, playedIds }).rows;
}

/**
 * The reader's record on one sport's open board, from FINAL games only.
 *
 * ONE QUERY, NOT pickemBoardView. That reader also fetches AP ranks, spreads,
 * team colours and networks for a board page; the lobby needs a status and a
 * winner.
 */
async function pickemFinals(uid, sport) {
  if (uid == null) return null;
  const [c] = await sql`
    SELECT id, board FROM contests
     WHERE game_type = 'pickem' AND sport = ${sport} AND NOT settled AND opens_at <= now()
     ORDER BY week DESC LIMIT 1`;
  if (!c) return null;
  const [e] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${Number(uid)}`;
  const ids = (c.board ?? []).map((g) => g.match_id).filter(Boolean);
  if (!ids.length) return null;
  const rows = await sql`
    SELECT m.id, m.status, m.home_score, m.away_score
      FROM matches m WHERE m.id = ANY(${ids})`;
  const games = rows.map((m) => ({
    id: m.id,
    status: m.status,
    // A PUSH IS A NULL WINNER, not a loss - the same rule pickemTable applies
    // at settle. A final with equal scores resolves to nobody.
    winner: m.status !== 'final' || m.home_score === m.away_score ? null
      : (Number(m.home_score) > Number(m.away_score) ? 'home' : 'away'),
  }));
  return { record: pickemRecord({ picks: e?.lineup ?? {}, games }) };
}

/**
 * Yesterday's PERCENTAGE, and its matched count - not its score.
 *
 * v2's Daily card carries `Yesterday` as the raw score (fmt1 of mine.primary),
 * which is the right number for a stat block headed "Yesterday" and the WRONG
 * one for a line that says "yesterday 99.7%". Reading the card's stat and
 * appending a % sign would have put 2363.1% on the screen - caught on the
 * first run against PROD.
 *
 * THE ONE FORMATTER, off the stored ratio where there is one: daily_board_runs
 * .pct already holds score/ceiling, so the ceiling here is 1 and pctOfCeiling
 * does the rounding exactly once (lib/daily/format.js).
 */
async function dailyYesterday(uid) {
  if (uid == null) return { pct: null, matched: null };
  const [row] = await sql`
    SELECT r.pct, r.picks, b.slots
      FROM daily_boards b
      LEFT JOIN daily_board_runs r ON r.board_id = b.id AND r.user_id = ${Number(uid)}
     WHERE now() >= b.closes_at
     ORDER BY b.edition_date DESC LIMIT 1`;
  if (!row || row.pct == null) return { pct: null, matched: null };
  return { pct: pctOfCeiling(row.pct, 1), matched: null, slots: Array.isArray(row.slots) ? row.slots.length : 8 };
}

/** The reader's last seven played Daily editions, with elapsed. */
async function dailyWeek(uid) {
  if (uid == null) return [];
  const rows = await sql`
    SELECT b.edition_date, b.season_year, r.score, r.pct, r.started_at, r.completed_at, r.picks
      FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
     WHERE r.user_id = ${Number(uid)} AND r.completed_at IS NOT NULL
     ORDER BY b.edition_date DESC LIMIT 7`;
  return rows.map((r) => ({
    date: String(r.edition_date).slice(0, 10),
    day: new Date(`${String(r.edition_date).slice(0, 10)}T12:00:00Z`)
      .toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    season: r.season_year ?? null,
    pct: pctOfCeiling(r.pct, 1),
    pctNum: r.pct == null ? null : Number(r.pct),
    elapsed: elapsedOf({ startedAt: r.started_at, completedAt: r.completed_at }),
    matched: null,   // regraded on the Results screen only - see the note below
    you: true,
  }));
}

/**
 * THE WHOLE SCREEN.
 *
 * @param {number|null} userId
 * @param {{now?: Date, chip?: string}} opts
 */
export async function lobbyV3(userId = null, { now = new Date() } = {}) {
  const uid = userId == null ? null : Number(userId);
  const v2 = await lobbyV2(uid, { now });
  if (!v2) return null;

  const [six, pkNfl, pkCfb, days, yday] = await Promise.all([
    nul(weeklySix(uid)) ?? [],
    nul(pickemFinals(uid, 'nfl')),
    nul(pickemFinals(uid, 'cfb')),
    nul(dailyWeek(uid)) ?? [],
    nul(dailyYesterday(uid)),
  ]);

  // ---- the four rows -----------------------------------------------------
  const w = v2.weekly ?? {};
  const weekly = weeklyRowV3({
    rows: six ?? [],
    state: w.state, filled: Number(w.sub?.match?.(/(\d+) of 6/)?.[1] ?? 0) || (six ?? []).filter((r) => r.id != null).length,
    live: w.state === 'locked',
    scored: w.stats?.find?.((s) => s.label === 'Scored')?.value ?? null,
    toPlay: (six ?? []).length ? (six ?? []).filter((r) => r.id != null && !r.played).length : null,
  });
  const pickem = pickemRowV3({ nfl: pkNfl, cfb: pkCfb });
  const d = v2.daily ?? {};
  const daily = dailyRowV3({
    pct: yday?.pct ?? null, matched: yday?.matched ?? null, slots: yday?.slots ?? 8,
    streak: v2.streak ?? 0, state: d.state, opensAt: d.closesAt ?? null,
  });
  const draft = draftRowV3({ state: v2.draft?.pill?.label === 'Live' ? 'drafting' : 'none' });

  const rows = [daily, weekly, pickem, draft];

  // ---- the now card, over the same view ----------------------------------
  const card = nowCard({
    daily: { ...d, gradedLine: yday?.pct ?? null, streakLine: (v2.streak ?? 0) > 0 ? `${v2.streak}-day streak` : null,
      shape: '8 slots · 12 teams · about 3 minutes' },
    weekly: { ...w, live: w.state === 'locked', scored: weekly.right == null ? null : Number(weekly.right) },
    draft: { state: v2.draft?.pill?.label === 'Live' ? 'drafting' : 'none' },
  }, { now });

  const avg = days.length
    ? Math.round((days.reduce((a, r) => a + (r.pctNum ?? 0), 0) / days.length) * 1000) / 10
    : null;
  const best = days.length ? Math.max(...days.map((r) => r.pctNum ?? 0)) : null;

  return {
    handle: v2.handle ?? null,
    week: {
      now: card, rows, week: v2.week ?? null,
      practice: [
        { key: 'draft', label: 'Mock draft', title: 'The Draft', href: '/sim',
          sub: `12 · ${DRAFT_ROUNDS} rounds · this season` },
        { key: 'league', label: 'Mock draft', title: 'Your league', href: '/leagues', sub: 'your rules' },
      ],
      foot: 'Everything scores on its own · graded Tuesday',
    },
    boards: { boards: [], boardKey: null },
    results: {
      dailyDays: days,
      dailySummary: days.length
        ? `${days.length} played this week · avg ${avg}% · best ${pctOfCeiling(best, 1) ?? '-'}`
        : null,
      gradedWeek: [],
    },
    alerts: { follows: [], matchAlerts: [], nextAlertAt: null },
  };
}
