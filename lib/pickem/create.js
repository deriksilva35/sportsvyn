// lib/pickem/create.js - making a Pick 'em board.
//
// THE WINDOW IS THE LAW, RATIFIED AUG 20: a board's slate is every CFB game
// whose kickoff falls inside a rolling Monday-to-Monday ET window. CFBD week
// numbers may inform a label; they NEVER define membership - CFBD 2026 has no
// week 0 and its "week 1" spans two of our windows (Aug 29 through Labor Day),
// so a week-keyed builder either finds nothing or sweeps in 91 extra games.
//
// LOCKS_AT = FIRST KICKOFF OF THE WINDOW, derived at creation, snapshotted per
// 067, never chases. OPENS_AT is the Tuesday-morning-ET anchor the Weekly
// ratified (tuesdayBefore): the lobby card flips on the contest existing, so
// the builder refuses to create a board before its own open - otherwise the
// cron going live would un-ghost the card days early.

import { sql } from '../db.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { tuesdayBefore } from '../weekly/create.js';

/**
 * The Mon-to-Mon ET window containing an instant, plus the spine's week key.
 *
 * ET calendar math runs in Postgres - the daily-puzzle house pattern:
 * AT TIME ZONE on a STORED timestamptz is day bucketing, not the
 * provider-datetime conversion ingest.js reserves for easternLocalToUtc().
 * date_trunc('week', ...) is ISO, so it lands on Monday by definition.
 *
 * WEEK = ISO WEEK OF THE WINDOW'S MONDAY. It is a pure function of the date,
 * so a re-derivation can never disagree with a stored row, and it cannot
 * collide inside one season_year: a CFB season runs Aug (wk ~34) into
 * January (wk ~3) with no overlap. It is a KEY, not a label - display copy
 * reads meta/board, never this number.
 */
export async function windowFor(instant) {
  const iso = new Date(instant).toISOString();
  const r = (await sql`
    SELECT to_char(monday, 'YYYY-MM-DD') AS monday,
           to_char(monday + 7, 'YYYY-MM-DD') AS next_monday,
           extract(week FROM monday)::int AS week
      FROM (SELECT date_trunc('week', (${iso}::timestamptz AT TIME ZONE 'America/New_York'))::date AS monday) w`)[0];
  return {
    mondayEt: r.monday,
    week: r.week,
    startUtc: new Date(await easternLocalToUtc(`${r.monday} 00:00:00`)),
    endUtc: new Date(await easternLocalToUtc(`${r.next_monday} 00:00:00`)),
  };
}

/** The window's slate, kickoff order. Membership is the window - nothing else. */
async function slateFor(leagueSlug, startUtc, endUtc) {
  return sql`
    SELECT m.id AS match_id, m.slug, m.kickoff_at, m.season_year,
           m.home_team_id, m.away_team_id,
           COALESCE(ht.short_name, ht.name) AS home,
           COALESCE(at.short_name, at.name) AS away
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at ON at.id = m.away_team_id
     WHERE l.slug = ${leagueSlug}
       AND m.kickoff_at >= ${startUtc.toISOString()} AND m.kickoff_at < ${endUtc.toISOString()}
     ORDER BY m.kickoff_at ASC, m.id ASC`;
}

/**
 * Compute everything the next board would be, WITHOUT writing. This is the
 * whole builder minus the INSERT - ensurePickemBoard() consumes it, and a
 * read-only verification against PROD runs the identical code path.
 */
export async function boardPlan({ leagueSlug = 'cfb', now = new Date() } = {}) {
  const nowIso = new Date(now).toISOString();
  const next = (await sql`
    SELECT min(m.kickoff_at) AS ko
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${leagueSlug} AND m.kickoff_at >= ${nowIso}`)[0]?.ko;
  if (!next) return { plan: null, reason: 'no-upcoming-games' };

  const win = await windowFor(next);
  const slate = await slateFor(leagueSlug, win.startUtc, win.endUtc);
  // min(kickoff_at) >= now is inside the window by construction, so the slate
  // cannot be empty here; guarded anyway so a future caller with a hand-built
  // window gets a reason, not a crash.
  if (!slate.length) return { plan: null, reason: 'empty-window' };

  const locksAt = new Date(slate[0].kickoff_at);
  const opensAt = new Date(await easternLocalToUtc(tuesdayBefore(locksAt.toISOString())));
  const lastKo = new Date(slate[slate.length - 1].kickoff_at);
  return {
    plan: {
      sport: leagueSlug,
      seasonYear: slate[0].season_year,
      week: win.week,
      window: { mondayEt: win.mondayEt, startUtc: win.startUtc, endUtc: win.endUtc },
      opensAt,
      locksAt,
      // Advisory only, the Weekly's convention: the settle gate decides.
      settlesAt: new Date(lastKo.getTime() + 12 * 3_600_000),
      board: slate.map((g) => ({
        match_id: g.match_id,
        slug: g.slug,
        kickoff_at: new Date(g.kickoff_at).toISOString(),
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        home: g.home,
        away: g.away,
      })),
    },
    reason: null,
  };
}

/**
 * Create the next Pick 'em board if its open has arrived and it is not
 * already there. IDEMPOTENT the ensureWeek way: existence check + ON CONFLICT
 * DO NOTHING against 067's partial unique index; a double fire is a no-op,
 * a race loses to the row that won and says so.
 */
export async function ensurePickemBoard({ leagueSlug = 'cfb', now = new Date() } = {}) {
  const { plan, reason } = await boardPlan({ leagueSlug, now });
  if (!plan) return { created: false, reason };

  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'pickem' AND sport = ${plan.sport}
       AND season_year = ${plan.seasonYear} AND week = ${plan.week}`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };

  if (new Date(now) < plan.opensAt) {
    return { created: false, reason: 'before-open', opensAt: plan.opensAt.toISOString() };
  }

  const meta = { window_monday_et: plan.window.mondayEt,
    window_start: plan.window.startUtc.toISOString(), window_end: plan.window.endUtc.toISOString() };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', ${plan.sport}, ${plan.seasonYear}, ${plan.week},
            ${JSON.stringify(plan.board)}::jsonb, ${plan.opensAt.toISOString()},
            ${plan.locksAt.toISOString()}, ${plan.settlesAt.toISOString()}, ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = 'pickem' AND sport = ${plan.sport}
        AND season_year = ${plan.seasonYear} AND week = ${plan.week}`;
    return { id: again[0]?.id, created: false, reason: 'raced' };
  }
  return { id: r[0].id, created: true, week: plan.week, games: plan.board.length,
    locksAt: plan.locksAt.toISOString() };
}
