// lib/six/night.js - one Tonight's Six card per ET day with NBA games.
//
// THE CONTEST SPINE IS OCTOBER'S, NO MIGRATION: game_type 'six', sport 'nba',
// puzzle_date = the ET day. idx_contests_date (UNIQUE game_type, sport,
// puzzle_date) makes "one card a night" a database fact, and
// contests_key_shape (112) already admits a date-keyed contest that is not the
// Daily. The lineup is contest_entries.lineup, one key per slot.
//
// THE NIGHT IS THE ET CALENDAR DAY of each game's CURRENT tip - a 10:30 PM ET
// tip in Denver is the same night as the 7:00 in Orlando, and a UTC day would
// split them (lib/nba/dayPickem.js etDay, the same bucketing).
//
// THE BOARD IS A SNAPSHOT OF WHICH GAMES, NOT OF WHEN. Its kickoff_at is kept
// for order and display fallback; every lock reads matches.kickoff_at at the
// moment it decides (lib/six/rules.js). locks_at - the join window's close,
// the last tip - is refreshed hourly from matches (refreshSixLocks), as the
// day board's is.
//
// OPENED BY THE HOURLY nba-schedule CRON (lib/six/tick.js), no cron of its own:
// the same hook that opens the NBA Pick'em day board opens this card, after the
// re-sync has written the night's tips.

import { sql } from '../db.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { etDay, previousDay } from '../nba/dayPickem.js';
import { VOID_STATUSES } from './rules.js';

export const GAME_TYPE = 'six';
export const SPORT = 'nba';
/** A night opens at this ET wall time - after the previous night's last game -
 * or at its first tip, whichever is first. */
export const OPEN_ET = '06:00:00';

/** The night's games: every NBA match whose current tip falls on the ET day. */
export async function nightSlate(dayEt, { leagueSlug = 'nba' } = {}) {
  return sql`
    SELECT m.id AS match_id, m.slug, m.kickoff_at, m.season_year, m.status,
           m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           COALESCE(h.short_name, h.name) AS home_name, COALESCE(a.short_name, a.name) AS away_name,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = ${leagueSlug}
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     -- DAY BUCKETING of a STORED timestamptz (lib/nba/dayPickem.js daySlate's
     -- own expression), not a provider-datetime conversion.
     WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = ${dayEt}::date
       AND m.status <> ALL(${VOID_STATUSES}::text[])
     ORDER BY m.kickoff_at ASC, m.id ASC`;
}

/** PURE. Slate rows -> the board snapshot. */
export function boardFor(rows = []) {
  return rows.map((r) => ({
    match_id: Number(r.match_id),
    slug: r.slug,
    kickoff_at: new Date(r.kickoff_at).toISOString(),
    home_team_id: Number(r.home_team_id),
    away_team_id: Number(r.away_team_id),
    home: { abbr: r.home_abbr, name: r.home_name, c1: r.home_c1 ?? null, c2: r.home_c2 ?? null },
    away: { abbr: r.away_abbr, name: r.away_name, c1: r.away_c1 ?? null, c2: r.away_c2 ?? null },
  }));
}

/** The card for an ET day, or null. */
export async function sixNightFor(dayEt) {
  const [c] = await sql`
    SELECT id, season_year, to_char(puzzle_date, 'YYYY-MM-DD') AS day, board, meta,
           opens_at, locks_at, settles_at, settled, settled_at, perfect
      FROM contests WHERE game_type = ${GAME_TYPE} AND sport = ${SPORT} AND puzzle_date = ${dayEt}::date
     LIMIT 1`;
  return c ?? null;
}

/**
 * Create the ET day's card once its open has arrived. IDEMPOTENT the house
 * way: an existence check, then an insert a race loses against the unique index.
 *
 * @param rows  optional slate rows (a test or a replay hands its own); read
 *              from matches otherwise
 */
export async function ensureSixNight({ dayEt = null, now = new Date(), rows = null } = {}) {
  const day = dayEt ?? etDay(now);
  const have = await sixNightFor(day);
  if (have) return { id: have.id, created: false, reason: 'exists', dayEt: day };
  const slate = rows ?? await nightSlate(day);
  if (!slate.length) return { created: false, reason: 'no-games', dayEt: day };
  const board = boardFor(slate);
  const tips = board.map((g) => Date.parse(g.kickoff_at));
  const firstTip = new Date(Math.min(...tips));
  const lastTip = new Date(Math.max(...tips));
  const openAt = new Date(await easternLocalToUtc(`${day} ${OPEN_ET}`));
  const opensAt = new Date(Math.min(openAt.getTime(), firstTip.getTime()));
  if (new Date(now) < opensAt) return { created: false, reason: 'before-open', dayEt: day, opensAt: opensAt.toISOString() };
  const meta = { day_et: day, games: board.length, first_tip: firstTip.toISOString() };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board, opens_at, locks_at, settles_at, meta)
    VALUES (${GAME_TYPE}, ${SPORT}, ${Number(slate[0].season_year)}, ${day}::date, ${JSON.stringify(board)}::jsonb,
            ${opensAt.toISOString()}, ${lastTip.toISOString()},
            ${new Date(lastTip.getTime() + 6 * 3_600_000).toISOString()}, ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sixNightFor(day);
    return { id: again?.id ?? null, created: false, reason: 'raced', dayEt: day };
  }
  return { id: r[0].id, created: true, dayEt: day, games: board.length, locksAt: lastTip.toISOString() };
}

/**
 * THE CARD A READER IS LOOKING AT: tonight's once it has opened; otherwise
 * last night's while it is still being played or graded (a west-coast game is
 * in the fourth quarter at 1 AM ET), and last night's final until tonight's
 * opens. Null on a night with no card and none behind it.
 */
export async function currentSixNight({ now = new Date(), includeSettled = true } = {}) {
  const today = etDay(now);
  const t = await sixNightFor(today);
  if (t && new Date(t.opens_at).getTime() <= new Date(now).getTime()) return t;
  const y = await sixNightFor(previousDay(today));
  if (y && (!y.settled || includeSettled)) return y;
  return null;
}

/** Keep locks_at the night's CURRENT last tip, for every unsettled card. */
export async function refreshSixLocks() {
  return sql`
    UPDATE contests c
       SET locks_at = t.last_tip
      FROM (
        SELECT c2.id, max(m.kickoff_at) AS last_tip
          FROM contests c2
          CROSS JOIN LATERAL jsonb_array_elements(c2.board) g
          JOIN matches m ON m.id = (g->>'match_id')::int
         WHERE c2.game_type = ${GAME_TYPE} AND c2.sport = ${SPORT} AND NOT c2.settled
           AND m.status <> ALL(${VOID_STATUSES}::text[])
         GROUP BY c2.id) t
     WHERE c.id = t.id AND t.last_tip IS NOT NULL AND c.locks_at IS DISTINCT FROM t.last_tip
    RETURNING c.id, c.locks_at`;
}

/** The board's matches as they stand NOW: status, tip, scores, live state. */
export async function liveRows(board = []) {
  const ids = (board ?? []).map((g) => Number(g.match_id));
  if (!ids.length) return new Map();
  const rows = await sql`
    SELECT id, status, kickoff_at, home_score, away_score, metadata->'live_state' AS live_state
      FROM matches WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** PURE. The two maps every rule takes, from liveRows(). */
export function lockMaps(byId) {
  return {
    statusBy: new Map([...byId].map(([k, m]) => [k, m?.status ?? 'scheduled'])),
    kickoffBy: new Map([...byId].map(([k, m]) => [k, m?.kickoff_at ? new Date(m.kickoff_at).toISOString() : null])),
  };
}
