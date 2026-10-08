// lib/leagues/results.js - every member's result in every game the league
// plays, from each game's OWN tables, as rows lib/leagues/standings.js can rank.
// Read-only; nothing is re-scored or stored.
//
//   contest games (pickem, weekly, draft, october, run, six, epl_weekly_5):
//     contest_entries.score on contests of the league's (game_type, sport)
//     pairs. FINAL = contests.settled. A contest counts once it locks at or
//     after the league's starts_at.
//   THE DAILY: daily_board_runs (the live v2 Daily) - NOT puzzle_entries, the
//     dead v1 table the old league tab read (recon bug, fixed here). A run
//     counts once completed; FINAL = its board's closes_at has passed (the
//     Daily has no settled flag). A board counts once it closes after starts_at.
//
// BUCKETS: a week is Tuesday 00:00 ET to Monday night - the NFL week every
// weekly surface opens and settles on - keyed by its Tuesday's date; a day is
// the ET date. A week game always lands in a week; a day game lands in the day
// of its puzzle_date (or of its lock).

import { sql } from '../db.js';
import { GAME_PERIOD } from './settings.js';
import { formatAt, pickemLeagueScore, pickemRecord, pickemAtsRecord } from './pickFormat.js';
import { etDateOf } from './start.js';

/** The Tuesday on or before an ET date ('YYYY-MM-DD'). */
export function tuesdayOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const back = (t.getUTCDay() - 2 + 7) % 7;
  return new Date(t.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** 'week' or 'day': what a winner is named for in this league. */
export function bucketUnit({ span, games = [] }) {
  if (span === 'weekly') return 'week';
  if (span === 'daily') return 'day';
  return games.some((g) => GAME_PERIOD[g] === 'week') ? 'week' : 'day';
}

const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** "Week 5" when an NFL week sits in the bucket, else "Week of Tue, Oct 6"; a day is "Sat, Oct 3". */
export function bucketLabel(bucket, unit, nflWeeks = new Map()) {
  if (unit === 'day') return fmtDay(bucket);
  const w = nflWeeks.get(bucket);
  return w != null ? `Week ${w}` : `Week of ${fmtDay(bucket)}`;
}

/**
 * Pure: raw rows -> standings rows. contestRows: { game, sport, season_year,
 * week, pd, locks_at, settled, user_id, score, submitted_at? }; dailyRows:
 * { d, closes_at, user_id, score, completed_at? }. submittedAt rides along to
 * order the table's ties (lib/games/rank.js).
 */
export function shapeResults({ contestRows = [], dailyRows = [], unit, now = new Date(), league = null }) {
  const out = [];
  // PICK'EM IS SCORED ON THE LEAGUE'S FORMAT (S2, lib/leagues/pickFormat.js):
  // REGULAR counts wins (a confidence board's points re-counted), CONFIDENCE
  // takes the board's own points. The format is the one in force at the
  // contest's lock, so weeks before a one-time switch stay as they were scored.
  const leagueScore = (r) => (r.game === 'pickem'
    ? pickemLeagueScore(formatAt(league, r.locks_at), { conf: r.conf === true, score: r.score, settled: r.settled, lineup: r.pk_lineup, results: r.pk_results, ats: r.pk_ats })
    : (r.score == null ? null : Number(r.score)));
  const nflWeeks = new Map();
  for (const r of contestRows) {
    const day = r.pd ? String(r.pd).slice(0, 10) : etDateOf(new Date(r.locks_at));
    const isWeekGame = GAME_PERIOD[r.game] === 'week';
    const bucket = unit === 'week' ? tuesdayOf(day) : day;
    const period = r.pd ? String(r.pd).slice(0, 10) : `${r.season_year}-w${r.week}`;
    if (unit === 'week' && isWeekGame && r.sport === 'nfl' && r.week != null) nflWeeks.set(bucket, r.week);
    // THE RECORD rides along on a settled Pick'em entry - the table prints it second.
    // An ATS week's record is W-L-P over the frozen lines (a push is its own count).
    const atsWeek = r.game === 'pickem' && formatAt(league, r.locks_at) === 'ats';
    const record = r.game === 'pickem' && r.settled
      ? (atsWeek ? (r.pk_ats ? pickemAtsRecord(r.pk_lineup, r.pk_ats) : null)
        : (r.pk_results ? pickemRecord(r.pk_lineup ?? {}, r.pk_results) : null))
      : null;
    out.push({ game: r.game, sport: r.sport, period, bucket, userId: Number(r.user_id), score: leagueScore(r), final: !!r.settled, submittedAt: r.submitted_at ?? null, record });
  }
  for (const r of dailyRows) {
    const day = String(r.d).slice(0, 10);
    out.push({
      game: 'daily', sport: 'all', period: day, bucket: unit === 'week' ? tuesdayOf(day) : day,
      userId: Number(r.user_id), score: r.score == null ? null : Number(r.score), final: new Date(r.closes_at) <= new Date(now),
      submittedAt: r.completed_at ?? null,
    });
  }
  return { results: out, nflWeeks };
}

/** Load a league's results. lg: { starts_at, span, games, gameRows: [{game_type, sport}], pick_format* }. */
export async function loadLeagueResults(lg, memberIds, { now = new Date() } = {}) {
  const unit = bucketUnit(lg);
  if (!memberIds.length) return { results: [], nflWeeks: new Map(), unit };
  const pairs = (lg.gameRows ?? []).filter((g) => g.game_type !== 'daily').map((g) => `${g.game_type}:${g.sport}`);
  const start = lg.starts_at ? new Date(lg.starts_at).toISOString() : null;
  const contestRows = pairs.length ? await sql`
    SELECT c.game_type AS game, c.sport, c.season_year, c.week, c.puzzle_date::text AS pd, c.locks_at, c.settled,
           e.user_id, e.score, COALESCE(e.submitted_at, e.created_at) AS submitted_at,
           -- A CONFIDENCE PICK'EM BOARD stores POINTS in e.score. A REGULAR league
           -- scores WINS exactly as it always did, so every Pick'em entry's picks
           -- and its board's results ride along (re-counted, and the W-L record).
           (c.game_type = 'pickem' AND c.meta->>'scoring' = 'confidence') AS conf,
           CASE WHEN c.game_type = 'pickem' THEN e.lineup END AS pk_lineup,
           CASE WHEN c.game_type = 'pickem' THEN c.perfect->'results' END AS pk_results,
           CASE WHEN c.game_type = 'pickem' THEN c.perfect->'ats'->'results' END AS pk_ats
      FROM contests c JOIN contest_entries e ON e.contest_id = c.id
     WHERE (c.game_type || ':' || c.sport) = ANY(${pairs})
       AND e.user_id = ANY(${memberIds})
       -- AN ALL-VOID CLOSE IS NOT A RESULT (ruling sun-10 item 4).
       AND NOT COALESCE((c.meta->>'void_all')::boolean, false)
       AND (${start}::timestamptz IS NULL OR c.locks_at >= ${start}::timestamptz)` : [];
  const dailyRows = (lg.games ?? []).includes('daily') ? await sql`
    SELECT b.edition_date::text AS d, b.closes_at, r.user_id, r.score, r.completed_at
      FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
     WHERE r.user_id = ANY(${memberIds})
       AND r.completed_at IS NOT NULL AND r.score IS NOT NULL AND NOT r.late_claim
       AND (${start}::timestamptz IS NULL OR b.closes_at > ${start}::timestamptz)` : [];
  return { ...shapeResults({ contestRows, dailyRows, unit, now, league: lg }), unit };
}
