// lib/daily/seasonBoardEditions.js — one FROZEN season-roster board per ET
// edition day (migration 090, daily_boards). PURE where possible; the one
// impure surface is ensureBoardForDate, which is deliberately the ONLY
// place that reads nfl_player_season_totals, draws a board, and writes it.
//
// EDITION DAY IS todayEt() (lib/daily/entries.js), NEVER A SECOND DATE
// FUNCTION (standing ruling). This module takes `editionDate` as a plain
// 'YYYY-MM-DD' string from the caller - it never computes "today" itself.
//
// THE BOARD IS FROZEN, NOT DERIVED (same discipline as puzzle_days, 064).
// nfl_player_season_totals moves - a re-run that reclassified one player
// would silently change a board someone was mid-run on. ceiling and
// best_roster are stored alongside board at creation, never recomputed at
// read time (standing ruling): best_roster IS the receipt ceiling is the
// sum of.
//
// THE ELIGIBLE SEASON SET IS QUERIED, NEVER HARDCODED. A hardcoded season
// list rots the moment a backfill widens the corpus (2000-2014 is exactly
// this kind of future backfill - see the errata). SELECT DISTINCT
// season_year FROM nfl_player_season_totals is the only source of truth for
// "which seasons can this draw from today."
//
// RECENCY IS AGAINST PRIOR EDITIONS, NOT A SIMULATION. boardScheduling.js's
// seasonEligibleOn/RECENCY_WINDOW_DAYS were built and tested against a
// simulated history; here the "recent history" is real - the seasons this
// table actually used in the last RECENCY_WINDOW_DAYS of REAL edition_date
// rows.
//
// IDEMPOTENT BY (edition_date UNIQUE), NOT BY A LOCK. Two concurrent callers
// (a request and a cron, or two requests racing the day's first hit) both
// try the INSERT; ON CONFLICT (edition_date) DO NOTHING means at most one
// wins, and the loser re-selects the winner's row - never two boards for one
// day, and never an error surfaced to either caller.

import { generateBoard } from './boardGenerator.js';
import { solveBoard } from './assignmentSolver.js';
import { SLOTS } from './boardShape.js';
import { RECENCY_WINDOW_DAYS, seasonEligibleOn } from './boardScheduling.js';
import { makeRng } from './pool.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';

// NO REAL EDITION BEFORE THIS DATE. The route (app/daily/board/page.js)
// checks this itself and falls back to the preview path rather than calling
// ensureBoardForDate at all - this module never gates on it internally,
// because a direct caller (a script, a future cron) that explicitly wants a
// board for a specific date should get one; the launch-date gate is a
// ROUTING decision, not a data one.
export const DAILY_V2_EPOCH = '2026-09-08';

// DAILY-LIVE FIRES AT 10:00 AM ET, NOT AT OPEN (amendment). Stored on the
// board row (live_notify_at, migration 091) at creation time, the same
// easternLocalToUtc path as opens_at/closes_at - the tick reads the column,
// never this constant directly.
export const DAILY_LIVE_HOUR_ET = 10;

/**
 * Has a real edition started yet? PURE - 'YYYY-MM-DD' strings compare
 * correctly with a plain >=, no Date parsing needed. The epoch date ITSELF
 * counts as live (the first real edition IS 2026-09-08).
 */
export function isEditionLive(editionDate, epoch = DAILY_V2_EPOCH) {
  return editionDate >= epoch;
}

/** Season-row stat line -> the one-line meta string a board card shows. */
export function metaFor(r) {
  switch (r.position) {
    case 'QB': return `${r.pass_yds ?? 0} yds · ${r.pass_td ?? 0} TD`;
    case 'RB': return `${r.rush_yds ?? 0} rush · ${r.rush_td ?? 0} TD`;
    case 'WR':
    case 'TE': return `${r.rec ?? 0} rec · ${r.rec_yds ?? 0} yds · ${r.rec_td ?? 0} TD`;
    case 'PK': return `${r.fgm ?? 0}/${r.fga ?? 0} FG`;
    default: return '';
  }
}

/** teams[] (boardGenerator shape) -> the render-ready shape SeasonBoard needs. */
function shapeTeams(teams) {
  return teams.map((t) => ({
    key: t.key,
    abbr: t.key,
    record: null, // no win-loss source exists for any season - never fabricated
    card: t.card.map((p) => ({
      position: p.position, name: p.raw_name, meta: metaFor(p), points: p.points,
    })),
  }));
}

/**
 * The season eligible for THIS edition date: present in the corpus, and not
 * used by any prior edition within the trailing RECENCY_WINDOW_DAYS. PURE
 * given its inputs.
 */
export function pickEligibleSeason(seasonsPresent, recentSeasons, editionDate, windowDays = RECENCY_WINDOW_DAYS) {
  const eligible = seasonsPresent
    .filter((s) => seasonEligibleOn(s, recentSeasons, windowDays))
    .sort((a, b) => a - b);
  if (!eligible.length) return null;
  const rng = makeRng(`daily-season-${editionDate}`);
  return eligible[Math.floor(rng() * eligible.length)];
}

/**
 * The frozen board for `editionDate`, creating it on first call and simply
 * returning it on every call after - idempotent, never a second draw for a
 * date that already has one.
 * @param sql a neon() tagged-template client (DEV or PROD - caller's choice)
 * @param editionDate 'YYYY-MM-DD', ET - from todayEt(), never computed here
 */
export async function ensureBoardForDate(sql, editionDate) {
  const existing = await sql`SELECT * FROM daily_boards WHERE edition_date = ${editionDate}`;
  if (existing.length) return existing[0];

  const seasonsPresent = (await sql`
    SELECT DISTINCT season_year FROM nfl_player_season_totals ORDER BY 1
  `).map((r) => r.season_year);

  const recentSeasons = (await sql`
    SELECT DISTINCT season_year FROM daily_boards
     WHERE edition_date >= (${editionDate}::date - (${RECENCY_WINDOW_DAYS} || ' days')::interval)
       AND edition_date < ${editionDate}::date
  `).map((r) => r.season_year);

  const season = pickEligibleSeason(seasonsPresent, recentSeasons, editionDate);
  if (season == null) {
    throw new Error(`no eligible season for edition ${editionDate} - every season in the corpus is inside its ${RECENCY_WINDOW_DAYS}-day cooldown`);
  }

  const rows = await sql`
    SELECT team_key, position, raw_name, pass_yds, pass_td, pass_int, rush_yds, rush_td,
           rec, rec_yds, rec_td, fumbles_lost, fgm, fga, xp, sacks, def_int, def_td
      FROM nfl_player_season_totals WHERE season_year = ${season}`;

  const seed = `daily-${editionDate}`;
  const draw = generateBoard(rows, makeRng(seed));
  if (!draw.ok) {
    throw new Error(`edition ${editionDate}: season ${season} could not draw a board - ${draw.reason}`);
  }
  const optimum = solveBoard(draw.teams, SLOTS);
  if (!optimum.ok) {
    throw new Error(`edition ${editionDate}: season ${season}'s draw has no feasible best roster - ${optimum.reason}`);
  }

  // OPENS/CLOSES ARE THE ET MIDNIGHT BOUNDARY, ENTIRELY POSTGRES-COMPUTED -
  // no JS Date arithmetic anywhere in this function, including for "the next
  // calendar day": that's ${editionDate}::date + 1, not a JS Date increment,
  // so DST is resolved the same one way (easternLocalToUtc's own AT TIME ZONE
  // 'America/New_York') everywhere a v2 edition boundary is computed.
  const [{ next_date: nextDate }] = await sql`SELECT to_char(${editionDate}::date + 1, 'YYYY-MM-DD') AS next_date`;
  const opensAt = await easternLocalToUtc(`${editionDate} 00:00:00`);
  const closesAt = await easternLocalToUtc(`${nextDate} 00:00:00`);
  const liveNotifyAt = await easternLocalToUtc(`${editionDate} ${String(DAILY_LIVE_HOUR_ET).padStart(2, '0')}:00:00`);

  const inserted = await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, opens_at, closes_at, live_notify_at)
    VALUES (${editionDate}, ${season}, ${seed}, ${JSON.stringify(shapeTeams(draw.teams))}::jsonb,
            ${optimum.total}, ${JSON.stringify(optimum.bySlot)}::jsonb, ${opensAt}, ${closesAt}, ${liveNotifyAt})
    ON CONFLICT (edition_date) DO NOTHING
    RETURNING *`;
  if (inserted.length) return inserted[0];

  // LOST THE RACE: another caller's INSERT won between our SELECT and ours.
  // Their row is authoritative - re-select it rather than erroring.
  return (await sql`SELECT * FROM daily_boards WHERE edition_date = ${editionDate}`)[0];
}
