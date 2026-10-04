// lib/gridiron/cfbWeeks.js - which CFBD /games pages a windowed tick asks for.
//
// THE OLD TICK ASKED FOR THE WHOLE SEASON. Every five minutes on a live
// window (every thirty otherwise) cfb-games fetched /games?year=Y&seasonType=
// regular - 2.76 MB, ~3,679 games, all of FBS and FCS since August - to keep
// the ~59 inside GAMES_WINDOW_HOURS, then made a postseason call that was
// empty until December. Same quota cost per call, but ~2 s and 2.7 MB of
// parse inside a function that already runs 87-112 s on a Saturday.
//
// THE WEEK COMES FROM OUR OWN matches TABLE, NOT FROM CFBD's /calendar.
//   - It is free: one indexed query on a table the tick reads anyway, where
//     the calendar is a CFBD call and a cache we would have to keep somewhere
//     (a Vercel function has no durable memory between invocations).
//   - It is the RIGHT week by construction. matches.week is exactly CFBD's
//     g.week, written by this sync, and the daily full-season run
//     (gridiron-season, window null, 09:00Z) keeps every row's week and kickoff
//     current. So "which weeks hold a game inside the window" is answered in
//     CFBD's own numbering - including a game whose kickoff was moved but
//     whose week number was not (a postponement keeps its original week: on
//     DEV, week 4 holds a game kicking off 3 Oct inside week 5's dates). A
//     date->week calendar lookup would miss exactly that game.
//   - A straggler still live past midnight is a game in the window whose
//     status is not final, so its week is asked for until it settles - even
//     on a Sunday when the "current" week has moved on.
//
// WHAT THE PLAN ASKS FOR (planCfbFetch, pure):
//   - every REG week holding a game in the window that is NOT final, or that
//     kicked off within RECENT_FINAL_HOURS (CFBD's completed/points/line
//     scores can trail our own final - the live poller often settles first);
//   - plus the week of the next game past the window, so a game moved INTO
//     the window under that week's number is still seen on the next tick,
//     and so a quiet weekday keeps one cheap call (whose header is also the
//     hourly quota reading - runRecorder.probeCfbdBudget);
//   - the postseason page only when the season phase says postseason: a POST
//     row in the window or next, or no REG game left ahead (bowls are
//     imported by the daily run; this keeps December covered regardless).
//   - NO ROWS AT ALL for the season (a fresh season, a new database) -> the
//     whole season, regular and postseason, exactly as before. Same when the
//     caller passes window null (the daily full-season run).
//
// THE GAP, STATED: a game rescheduled into the window under a week number
// that no other in-window or next game carries, AFTER the 09:00Z daily run,
// is not seen by the tick until the next daily run. Before this change it was
// seen on the next tick. Judged acceptable: it needs a same-day reschedule
// across week numbers, and the daily run still catches it within 24 h.

export const RECENT_FINAL_HOURS = 8;
const SETTLED = new Set(['final', 'cancelled']);

/**
 * PURE. rows: [{ season_phase, week, kickoff_at, status, src }] where src is
 * 'window' | 'next'. Returns { regularWeeks: number[] | null, postseason,
 * reason }. regularWeeks null = the whole regular season.
 */
export function planCfbFetch(rows, { now = new Date(), totalRows = rows.length, regLeft = null } = {}) {
  if (!totalRows) return { regularWeeks: null, postseason: true, reason: 'no rows for this season: whole season' };
  const t = now.getTime();
  const weeks = new Set();
  let post = false;
  for (const r of rows) {
    const phase = r.season_phase;
    if (phase === 'POST') { post = true; continue; }
    if (phase !== 'REG' || r.week == null) continue;
    const k = new Date(r.kickoff_at).getTime();
    if (r.src === 'next') { weeks.add(Number(r.week)); continue; }
    const recent = Number.isFinite(k) && k <= t && t - k <= RECENT_FINAL_HOURS * 3600_000;
    if (!SETTLED.has(r.status) || recent || (Number.isFinite(k) && k > t)) weeks.add(Number(r.week));
  }
  if (regLeft === 0) post = true;
  const regularWeeks = [...weeks].sort((a, b) => a - b);
  const reason = `weeks ${regularWeeks.join(',') || 'none'}; postseason ${post ? 'yes' : 'no'}`;
  return { regularWeeks, postseason: post, reason };
}

/**
 * The rows planCfbFetch reads: every game of the season inside the window,
 * plus the first game after it. `regLeft` = REG games kicking off after now.
 */
export async function cfbPlanRows(sql, leagueId, seasonYear, { now = new Date(), hours }) {
  const lo = new Date(now.getTime() - hours * 3600_000).toISOString();
  const hi = new Date(now.getTime() + hours * 3600_000).toISOString();
  const nowIso = now.toISOString();
  const rows = await sql`
    (SELECT season_phase, week, kickoff_at, status, 'window' AS src FROM matches
      WHERE league_id = ${leagueId} AND season_year = ${seasonYear}
        AND kickoff_at BETWEEN ${lo} AND ${hi})
    UNION ALL
    (SELECT season_phase, week, kickoff_at, status, 'next' AS src FROM matches
      WHERE league_id = ${leagueId} AND season_year = ${seasonYear} AND kickoff_at > ${hi}
      ORDER BY kickoff_at LIMIT 1)`;
  const [agg] = await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE season_phase = 'REG' AND kickoff_at > ${nowIso})::int AS reg_left
      FROM matches WHERE league_id = ${leagueId} AND season_year = ${seasonYear}`;
  return { rows, totalRows: agg?.total ?? 0, regLeft: agg?.reg_left ?? null };
}

/** The /games paths a plan asks for, regular first. */
export function cfbGamesPaths(plan, seasonYear) {
  const regular = plan.regularWeeks == null
    ? [`/games?year=${seasonYear}&seasonType=regular`]
    : plan.regularWeeks.map((w) => `/games?year=${seasonYear}&seasonType=regular&week=${w}`);
  const post = plan.postseason ? [`/games?year=${seasonYear}&seasonType=postseason`] : [];
  return { regular, post };
}
