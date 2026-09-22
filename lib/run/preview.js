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
import { ROUND_LABEL, ROUNDS } from './rules.js';

const ET = 'America/New_York';

/** The clubs playing on one ET day, with their opponent and first pitch. */
export async function clubsOnDay(season, day) {
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
       AND (m.kickoff_at AT TIME ZONE ${ET})::date = ${day}::date
     ORDER BY m.kickoff_at ASC, m.id ASC`;
  return rows;
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
  const first = rows.length ? new Date(rows[0].kickoff_at).toISOString() : null;
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
      firstPitch: first,
      seriesCount: 0,
      clubs: clubs.length,
      alive: clubs.length,
      byes: 0,
    },
  };
}

/** Create one preview round. Idempotent on (game_type, sport, puzzle_date). */
export async function ensureRunPreviewDay({ season, day, roundIndex, now = new Date() }) {
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
  return {
    id: r[0].id, created: true, day, roundIndex,
    clubs: clubs.length, games: meta.matchIds.length, locksAt: meta.firstPitch,
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
