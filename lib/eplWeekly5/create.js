// lib/eplWeekly5/create.js - one EPL Weekly 5 contest per Premier League round.
//
// WEEK-KEYED: contests (game_type 'epl_weekly_5', sport 'epl', season_year,
// week = the round) and idx_contests_week makes "one per gameweek" a database
// fact. The round is matches.week, written by the epl-fixtures ingest from the
// provider's "Regular Season - N".
//
// THE BOARD IS THE ROUND'S FIXTURES, its window is whatever they span (a Fri-Mon
// round is Fri-Mon; a midweek round is one evening). The board freezes WHICH
// fixtures belong to the gameweek; it does NOT freeze when they kick off - every
// lock reads the live matches.kickoff_at (lib/eplWeekly5/rules.js).
//
// A GAMEWEEK OPENS WHEN THE ONE BEFORE IT IS DONE: the lowest round that still
// has a fixture to play is the one being picked, so MW6 opened the moment MW5's
// last whistle had gone (picks were open by Wed 7 Oct with days to spare).
//
// A POSTPONEMENT DOES NOT PIN THE ROUND (ruling sat-5 E1). "Still to play" is
// 'scheduled' or 'live' - a postponed fixture is not to play, so a round whose
// only remaining fixture is postponed is done and the next one opens on time.
// And when the league RE-DATES that fixture (the feed flips it back to
// 'scheduled' with a new kickoff, still under its old round number) it must
// not drag "next" back to a round long finished either: a fixture that kicks
// off AFTER some later round's fixture has kicked off is a STRAGGLER and does
// not hold its round open (nextRoundOf below).
//
// WHERE A RE-DATED FIXTURE IS PLAYED, IT SCORES. Its old gameweek treats it as
// 'moved' once it is MOVED_OUT_H past the rest of that board (rules.js
// effectiveFixtures: off there, never holds that settle). The first gameweek
// to OPEN after the new date is known, whose window it falls in, carries it on
// its own board (carriedRows) - a double gameweek for its two clubs, scored
// in full under ruling E2. One fixture, one gameweek that counts it.

import { sql } from '../db.js';
import { GAME_KEY, SPORT, movedOutOf, effectiveFixtures } from './rules.js';
import { instantsOf } from '../util/scoresOf.js';

/** PURE. A round's rows -> the board snapshot. */
export function boardFor(rows = []) {
  return rows.map((r) => ({
    match_id: r.match_id,
    slug: r.slug,
    kickoff_at: new Date(r.kickoff_at).toISOString(),
    home: { id: r.home_team_id, abbr: r.home_abbr, name: r.home_name },
    away: { id: r.away_team_id, abbr: r.away_abbr, name: r.away_name },
  }));
}

/** The round's fixtures, in kickoff order. */
export async function roundRows(season, week) {
  return sql`
    SELECT m.id AS match_id, m.slug, m.kickoff_at, m.status, m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, COALESCE(h.short_name, h.name) AS home_name,
           a.abbreviation AS away_abbr, COALESCE(a.short_name, a.name) AS away_name
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'epl'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.season_year = ${season} AND m.week = ${week}
       AND m.status NOT IN ('cancelled', 'not_needed')
     ORDER BY m.kickoff_at ASC, m.id ASC`;
}

/**
 * THE ROUND TO OPEN, PURE over fixture rows { season, week, status,
 * kickoff_at }: the lowest round with a fixture still to play ('scheduled' or
 * 'live' - never 'postponed'), where a STRAGGLER does not count - a fixture
 * some LATER round's fixture (not called off) kicks off before.
 */
const VOID = new Set(['postponed', 'cancelled', 'not_needed']);
export function nextRoundOf(rows = []) {
  const all = (rows ?? []).filter((r) => r.week != null)
    .map((r) => ({ season: Number(r.season ?? r.season_year), week: Number(r.week), status: r.status, ko: instantsOf([r.kickoff_at])[0] ?? NaN }));
  // The earliest kickoff of any later round, per (season, week): one pass from the top.
  const firstKo = new Map();
  for (const r of all) {
    if (VOID.has(r.status) || !Number.isFinite(r.ko)) continue;
    const k = `${r.season}:${r.week}`;
    firstKo.set(k, Math.min(firstKo.get(k) ?? Infinity, r.ko));
  }
  const laterStart = (r) => {
    let min = Infinity;
    for (const [k, ko] of firstKo) {
      const [s, w] = k.split(':').map(Number);
      if (s === r.season && w > r.week) min = Math.min(min, ko);
    }
    return min;
  };
  const toPlay = all.filter((r) => (r.status === 'scheduled' || r.status === 'live') && !(laterStart(r) < r.ko))
    .sort((a, b) => a.season - b.season || a.week - b.week);
  return toPlay.length ? { season: toPlay[0].season, week: toPlay[0].week } : null;
}

/** The round to open (nextRoundOf's rule, in SQL so a season's rows stay in the database). */
export async function nextRound({ season = null } = {}) {
  const [r] = await sql`
    SELECT m.season_year AS season, m.week
      FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'epl'
     WHERE m.week IS NOT NULL AND m.status IN ('scheduled', 'live')
       AND (${season}::int IS NULL OR m.season_year = ${season}::int)
       AND NOT EXISTS (
         SELECT 1 FROM matches g
          WHERE g.league_id = m.league_id AND g.season_year = m.season_year AND g.week > m.week
            AND g.status NOT IN ('postponed', 'cancelled', 'not_needed')
            AND g.kickoff_at < m.kickoff_at)
     ORDER BY m.season_year ASC, m.week ASC
     LIMIT 1`;
  return r ? { season: Number(r.season), week: Number(r.week) } : null;
}

/**
 * RE-DATED FIXTURES THIS GAMEWEEK CARRIES. PURE over candidates { match_id,
 * week, kickoff_at, others: [kickoffs of its own round's other fixtures - its
 * old board's snapshot when that gameweek exists] }: an earlier round's
 * fixture, still to play after `now`, moved out of its own round (the same
 * movedOutOf the old board reads), and kicking off no later than this round's
 * last fixture.
 */
export function carriedOf(cands = [], { week, lastKickoff, now = new Date() } = {}) {
  const last = new Date(lastKickoff).getTime();
  const t = new Date(now).getTime();
  return (cands ?? []).filter((c) => {
    const ko = new Date(c.kickoff_at).getTime();
    return Number(c.week) < Number(week) && ko > t && ko <= last && movedOutOf(c.kickoff_at, c.others);
  });
}

/** The candidates carriedOf() chooses from, read for one round. */
async function carriedRows(season, week, { lastKickoff, now }) {
  const cands = await sql`
    SELECT m.id AS match_id, m.slug, m.kickoff_at, m.status, m.week, m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, COALESCE(h.short_name, h.name) AS home_name,
           a.abbreviation AS away_abbr, COALESCE(a.short_name, a.name) AS away_name,
           (SELECT c.board FROM contests c
             WHERE c.game_type = ${GAME_KEY} AND c.sport = ${SPORT} AND c.season_year = m.season_year
               AND c.week = m.week AND c.puzzle_date IS NULL) AS own_board,
           (SELECT array_agg(o.kickoff_at) FROM matches o
             WHERE o.league_id = m.league_id AND o.season_year = m.season_year AND o.week = m.week
               AND o.id <> m.id AND o.status NOT IN ('postponed', 'cancelled', 'not_needed')) AS own_others
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'epl'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.season_year = ${season} AND m.week < ${week} AND m.status = 'scheduled'
       AND m.kickoff_at > ${new Date(now).toISOString()} AND m.kickoff_at <= ${new Date(lastKickoff).toISOString()}
       -- never carried twice: not on any OTHER round's board already
       AND NOT EXISTS (SELECT 1 FROM contests c
                        WHERE c.game_type = ${GAME_KEY} AND c.sport = ${SPORT} AND c.puzzle_date IS NULL
                          AND c.week <> m.week AND c.board @> jsonb_build_array(jsonb_build_object('match_id', m.id)))
     ORDER BY m.kickoff_at ASC, m.id ASC`;
  const shaped = cands.map((c) => ({
    ...c,
    others: Array.isArray(c.own_board)
      ? c.own_board.filter((g) => String(g.match_id) !== String(c.match_id)).map((g) => g.kickoff_at)
      : (c.own_others ?? []),
  }));
  return carriedOf(shaped, { week, lastKickoff, now });
}

/** Create the gameweek if it is not there. IDEMPOTENT on idx_contests_week. */
export async function ensureGameweek({ season, week, now = new Date() }) {
  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND season_year = ${season} AND week = ${week}
       AND puzzle_date IS NULL`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };
  const native = await roundRows(season, week);
  if (!native.length) return { created: false, reason: 'no-fixtures' };
  const nativeLast = native.reduce((a, r) => Math.max(a, new Date(r.kickoff_at).getTime()), -Infinity);
  const carried = await carriedRows(season, week, { lastKickoff: new Date(nativeLast), now });
  const rows = [...native, ...carried]
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at) || Number(a.match_id) - Number(b.match_id));
  const board = boardFor(rows);
  const first = new Date(board[0].kickoff_at);
  const last = new Date(board[board.length - 1].kickoff_at);
  const meta = { games: board.length, first_kickoff: first.toISOString(), last_kickoff: last.toISOString(),
    ...(carried.length ? { carried: carried.map((r) => ({ match_id: r.match_id, from_week: Number(r.week) })) } : {}) };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES (${GAME_KEY}, ${SPORT}, ${season}, ${week}, ${JSON.stringify(board)}::jsonb,
            ${new Date(now).toISOString()}, ${last.toISOString()},
            ${new Date(last.getTime() + 26 * 3_600_000).toISOString()},
            ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = ${GAME_KEY} AND sport = ${SPORT}
         AND season_year = ${season} AND week = ${week} AND puzzle_date IS NULL`;
    return { id: again[0]?.id, created: false, reason: 'raced' };
  }
  return { id: r[0].id, created: true, season, week, games: board.length, firstKickoff: first.toISOString() };
}

/** Open the next gameweek. The cron calls this. */
export async function ensureNextGameweek({ now = new Date() } = {}) {
  const next = await nextRound();
  if (!next) return { created: false, reason: 'no-round' };
  return { ...next, ...await ensureGameweek({ ...next, now }) };
}

/** One gameweek by number. */
export async function gameweek(season, week) {
  const [c] = await sql`
    SELECT id, season_year, week, board, meta, opens_at, locks_at, settles_at, settled, settled_at, perfect FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND season_year = ${season} AND week = ${week}
       AND puzzle_date IS NULL`;
  return c ?? null;
}

/**
 * The gameweek a reader is looking at: one with a fixture LIVE, else the
 * earliest unsettled one with a fixture still ahead (open for picks - a round
 * half played is still this one), else the most recent. A finished GW 5 never
 * hides an open GW 6; its final is a tap away (?gw=5).
 */
export async function currentGameweek({ now = new Date() } = {}) {
  const iso = new Date(now).toISOString();
  const rows = await sql`
    SELECT id, season_year, week, board, meta, opens_at, locks_at, settles_at, settled, settled_at, perfect
      FROM contests
     WHERE game_type = ${GAME_KEY} AND sport = ${SPORT} AND puzzle_date IS NULL AND opens_at <= ${iso}
     ORDER BY season_year DESC, week DESC
     LIMIT 6`;
  if (!rows.length) return null;
  const ids = [...new Set(rows.flatMap((c) => (c.board ?? []).map((g) => g.match_id)))];
  const live = ids.length ? await sql`SELECT id, status, kickoff_at FROM matches WHERE id = ANY(${ids})` : [];
  const raw = new Map(live.map((m) => [String(m.id), m]));
  const t = new Date(now).getTime();
  // Each gameweek reads its fixtures as IT sees them: one re-dated out of it is 'moved', not ahead.
  const has = (c, test) => {
    const by = effectiveFixtures(c.board ?? [], raw);
    return (c.board ?? []).some((g) => { const m = by.get(String(g.match_id)); return m && test(m); });
  };
  const asc = [...rows].reverse();
  return asc.find((c) => !c.settled && has(c, (m) => m.status === 'live'))
    ?? asc.find((c) => !c.settled && has(c, (m) => m.status === 'scheduled' && new Date(m.kickoff_at).getTime() > t))
    ?? rows[0];
}
