// lib/run/preview.js - four rounds on four days of the regular season.
//
// THE RULES ARE THE RULES. Nine (two arms, seven bats), three max per club,
// one lock at the day's first pitch, the burn across all four, DNF for an
// unset nine. Not one of those mentions the postseason, so the preview is the
// identical game with a different definition of "a round": one DAY instead of
// one series round.
//
// DATE-KEYED, AND THAT IS LOAD-BEARING. A real Run round is keyed
// (game_type, sport, season_year, week) 1-4 through idx_contests_week, which
// is UNIQUE and partial on `puzzle_date IS NULL`. If the preview reused weeks
// 1-4 it would occupy the real postseason's keys and the October import would
// silently find "round 1 exists" and never open the real one. Setting
// puzzle_date puts these rows under idx_contests_date instead, where they
// cannot collide - migration 112's shape rule is what permits a date-keyed
// contest that is not the Daily, and this is the second game to use it.
//
// ALIVE MEANS PLAYING TODAY. In the postseason "alive" is a fact about a
// series; here it is simply whether the club has a game on the day, which is
// the same question the roster rules are actually asking.

import { sql } from '../db.js';
import { ROUND_LABEL, ROUNDS, reopenPreview } from './rules.js';
import { instantsOf } from '../util/scoresOf.js';

const ET = 'America/New_York';

/**
 * PURE. The ET calendar day a kickoff belongs to, 'YYYY-MM-DD'.
 *
 * THE DAY IS THE AMERICAN CALENDAR DAY - lib/october/create.js's rule. A
 * 5:05 PM PT first pitch on Wednesday is 00:05Z THURSDAY, and a UTC day would
 * file it under Thursday's round: Wednesday's slate split across two rounds,
 * and Thursday locking at a game that was thrown the night before.
 */
export function etDayOf(kickoff) {
  const t = new Date(kickoff);
  if (!Number.isFinite(t.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(t);
}

/** PURE. The rows whose ET day is `day`, earliest first pitch first. */
export function rowsForEtDay(rows = [], day) {
  return rows
    .filter((r) => etDayOf(r.kickoff_at) === String(day).slice(0, 10))
    .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at)
      || Number(a.match_id) - Number(b.match_id));
}

/**
 * The clubs playing on one ET day, with their opponent and first pitch.
 *
 * THE SQL READS A WIDE UTC WINDOW AND rowsForEtDay() DECIDES THE DAY, so the
 * rule that files a game under a round is one pure function a test can call,
 * not a cast buried in a WHERE clause.
 */
export async function clubsOnDay(season, day) {
  const d = String(day).slice(0, 10);
  const from = new Date(`${d}T00:00:00Z`);
  const to = new Date(from.getTime() + 2 * 24 * 3_600_000);
  const rows = await sql`
    SELECT m.id AS match_id, m.slug, m.kickoff_at,
           m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, COALESCE(h.short_name, h.name) AS home_name,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.abbreviation AS away_abbr, COALESCE(a.short_name, a.name) AS away_name,
           a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.season_year = ${season}
       AND m.kickoff_at >= ${from.toISOString()} AND m.kickoff_at < ${to.toISOString()}
     ORDER BY m.kickoff_at ASC, m.id ASC`;
  return rowsForEtDay(rows, d);
}

/**
 * PURE. One day's games -> the board (an ARRAY of clubs) and its meta.
 *
 * A DOUBLEHEADER GIVES A CLUB ONE TILE, NOT TWO. The grid is clubs, and a
 * club that plays twice is still one club you may take three players from -
 * its players simply score both games, which is the round rule working.
 */
export function previewBoardFor(day, rows = [], roundIndex = 1) {
  const byTeam = new Map();
  const matchIds = [];
  for (const r of rows) {
    matchIds.push(r.match_id);
    for (const side of ['home', 'away']) {
      const id = side === 'home' ? r.home_team_id : r.away_team_id;
      if (id == null) continue;
      const other = side === 'home' ? r.away_abbr : r.home_abbr;
      const cur = byTeam.get(String(id)) ?? {
        teamId: id,
        abbr: side === 'home' ? r.home_abbr : r.away_abbr,
        name: side === 'home' ? r.home_name : r.away_name,
        colors: (side === 'home' ? r.home_c1 : r.away_c1) && (side === 'home' ? r.home_c2 : r.away_c2)
          ? { primary: side === 'home' ? r.home_c1 : r.away_c1, secondary: side === 'home' ? r.home_c2 : r.away_c2 }
          : null,
        // NO BYES IN THE PREVIEW. Every club on the board is playing, so the
        // flag is false on every entry and the rule that reads it is inert -
        // the same posture every non-wild-card round takes.
        bye: false,
        seed: null,
        bestOf: null,
        seriesKey: null,
        games: 0,
        opponent: other ?? null,
      };
      cur.games += 1;
      byTeam.set(String(id), cur);
    }
  }
  const clubs = [...byTeam.values()].sort((a, b) => String(a.abbr).localeCompare(String(b.abbr)));
  // THE EARLIEST FIRST PITCH, read as a minimum - not rows[0], which is only
  // the earliest if every caller remembered to sort - and through instantsOf,
  // so a row with no kickoff is absent rather than the epoch.
  const first = instantsOf(rows.map((r) => r.kickoff_at)).sort((a, b) => a - b)[0];
  return {
    clubs,
    meta: {
      preview: true,
      season_label: 'PREVIEW · regular season',
      round: ROUNDS[roundIndex - 1] ?? 'wild_card',
      roundIndex,
      label: `${ROUND_LABEL[ROUNDS[roundIndex - 1]] ?? 'Round'} · preview`,
      day,
      matchIds,
      firstPitch: first == null ? null : new Date(first).toISOString(),
      seriesCount: 0,
      clubs: clubs.length,
      alive: clubs.length,
      byes: 0,
    },
  };
}

/** Create one preview round. Idempotent on (game_type, sport, puzzle_date). */
export async function ensureRunPreviewDay({ season, day, roundIndex, now = new Date(), fileHouse = true }) {
  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'run' AND sport = 'mlb' AND puzzle_date = ${day}`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };

  const rows = await clubsOnDay(season, day);
  if (!rows.length) return { created: false, reason: 'no-games' };
  const { clubs, meta } = previewBoardFor(day, rows, roundIndex);
  if (!meta.firstPitch) return { created: false, reason: 'no-first-pitch' };

  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, puzzle_date, board,
                          opens_at, locks_at, settles_at, meta)
    VALUES ('run', 'mlb', ${season}, NULL, ${day}, ${JSON.stringify(clubs)}::jsonb,
            ${new Date(now).toISOString()}, ${meta.firstPitch},
            ${new Date(new Date(meta.firstPitch).getTime() + 18 * 3_600_000).toISOString()},
            ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = 'run' AND sport = 'mlb' AND puzzle_date = ${day}`;
    return { id: again[0]?.id, created: false, reason: 'raced' };
  }
  // THE HOUSE FILES AT ROUND OPEN, on the one pass that created the round -
  // October's rule (lib/october/create.js). Imported dynamically so a pass
  // that creates nothing never loads the house, awaited so the pool it warms
  // is cached before the pass returns, and caught: a house that cannot file is
  // missing rows on a board, never a missing round.
  let house = null;
  if (fileHouse) {
    const row = (await sql`
      SELECT id, season_year, week, puzzle_date, board, meta, opens_at, locks_at, settled
        FROM contests WHERE id = ${r[0].id}`)[0];
    house = await (async () => (await import('../house/run.js')).fileRunRound(row, { now }))()
      .catch((e) => ({ error: String(e?.message ?? e).slice(0, 120) }));
  }
  return {
    id: r[0].id, created: true, day, roundIndex,
    clubs: clubs.length, games: meta.matchIds.length, locksAt: meta.firstPitch, house,
  };
}

/** The four preview rounds, in order. */
export async function ensureRunPreview(season, { days = [], now = new Date() } = {}) {
  const out = [];
  for (const [i, day] of days.entries()) {
    out.push({ day, ...await ensureRunPreviewDay({ season, day, roundIndex: i + 1, now }) });
  }
  return out;
}

/**
 * THE PREVIEW SETTLES ON THE DAY'S LAST FINAL, not on a series - there are no
 * series. Every match on the board final is the same gate in a different
 * vocabulary, and it is the honest one: when the last game ends, no club on
 * this board can score again.
 */
export async function previewRoundComplete(contest) {
  const ids = contest?.meta?.matchIds ?? [];
  if (!ids.length) return { complete: false, remaining: 0 };
  const rows = await sql`SELECT id, status FROM matches WHERE id = ANY(${ids})`;
  const pending = rows.filter((r) => r.status !== 'final');
  return { complete: pending.length === 0, remaining: pending.length };
}

/**
 * REOPEN A PREVIEW ROUND - the mercy reopenPreview() rules on, written.
 *
 * REFUSES A ROUND WITH ENTRIES. A roster set before the reopen may hold a
 * player whose club has just left the pool, and rewriting someone's nine is
 * not a thing a reopen gets to do. The house is filed afterwards by the
 * caller, through the door, against the reopened board.
 */
export async function reopenRunPreviewRound(contestId, { now = new Date() } = {}) {
  const [c] = await sql`
    SELECT id, board, meta, settled FROM contests WHERE id = ${contestId} AND game_type = 'run'`;
  if (!c) return { ok: false, reason: 'no-round' };
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM contest_entries WHERE contest_id = ${contestId}`;
  if (n > 0) return { ok: false, reason: 'has-entries', entries: n };
  const { roundMatches, roundGames } = await import('./pool.js');
  const games = roundGames(await roundMatches(c));
  const r = reopenPreview({ meta: c.meta ?? {}, clubs: c.board ?? [], games, now });
  if (!r.ok) return r;
  // THE CACHED POOL LOSES THE CLUBS THAT LEFT, rather than being rebuilt: a
  // rebuild is thirty provider fetches and the players who stay are the same.
  const keep = new Set(r.clubs.map((k) => String(k.teamId)));
  const pool = c.meta?.pool
    ? { ...c.meta.pool, byClub: Object.fromEntries(Object.entries(c.meta.pool.byClub ?? {}).filter(([k]) => keep.has(k))) }
    : null;
  const patch = { ...r.meta, ...(pool ? { pool } : {}) };
  await sql`
    UPDATE contests
       SET board = ${JSON.stringify(r.clubs)}::jsonb,
           meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
           locks_at = ${r.meta.firstPitch}, settled = false, settled_at = NULL
     WHERE id = ${contestId} AND game_type = 'run'`;
  return { ok: true, id: contestId, locksAt: r.meta.firstPitch, clubs: r.clubs.length, ...r.meta.reopen };
}
