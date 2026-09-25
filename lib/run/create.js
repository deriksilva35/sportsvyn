// lib/run/create.js - one contest per round, opened by the same job that
// settles the one before it.
//
// FOUR CONTESTS A POSTSEASON, keyed (game_type 'run', sport 'mlb', week 1-4).
// The spine's idx_contests_week already makes that unique, so "one Run
// contest per round" is a database fact and nothing new was needed - and
// migration 112 (October's) already widened the shape constraint that would
// otherwise have been in the way.
//
// THE BOARD IS FROZEN AT OPEN: the round's series, the clubs alive in it, and
// the probables. The 067 law - a lineup published after the round opened does
// not change who was pickable when somebody picked.
//
// ROUND 1 OPENS WITH THE MONDAY IMPORT. Every later round opens THE MORNING
// AFTER its predecessor's last series is decided, which is a fact about games
// and not about the calendar - so the opener is driven by the settle, not by
// a cron reading a date.

import { sql } from '../db.js';
import { seriesFor } from '../mlb/series.js';
import { ROUNDS, ROUND_LABEL, weekOf } from './rules.js';
import { probablesByMatch, pickByKickoff } from '../mlb/probables.js';
import { instantsOf } from '../util/scoresOf.js';

/**
 * PURE. The round's series -> the board a card reads.
 *
 * BYES ARE A ROUND-1 FACT AND ARE CARRIED EXPLICITLY. In the Wild Card round
 * the 1 and 2 seeds are not playing, so they are on the board (the mock draws
 * them, dimmed) with bye: true. In every later round every club on the board
 * is playing and the flag is false - the reader never has to ask which rule
 * is in force.
 */
export function boardFor({ round, series = [], byeClubs = [], seeds = new Map(), probablesByKey = new Map() }) {
  const clubs = [];
  const matchIds = [];
  for (const s of series) {
    for (const g of s.games) matchIds.push(g.id);
    for (const t of s.teams) {
      const other = s.teams.find((x) => x.id !== t.id);
      clubs.push({
        teamId: t.id, abbr: t.abbreviation, name: t.name,
        colors: t.colors ?? null, bye: false,
        // THE SEED IS ON EVERY CLUB, not just the ones on a bye. The mock's
        // grid prints "3 · vs 6" under a playing club and "1" under a waiting
        // one; carrying it only for byes left the playing half with a blank
        // where the number goes.
        seed: seeds.get(String(t.id)) ?? null,
        opponent: other?.abbreviation ?? null,
        bestOf: s.bestOf, seriesKey: s.key,
      });
    }
  }
  for (const b of byeClubs) {
    clubs.push({ teamId: b.teamId, abbr: b.abbr, name: b.name, colors: b.colors ?? null,
      bye: true, opponent: null, bestOf: null, seriesKey: null, seed: b.seed ?? null });
  }
  // instantsOf, AND THIS ONE WAS A LIVE HAZARD. new Date(null).getTime() is 0 -
  // the epoch - so a game with no kickoff became the EARLIEST one, and this
  // value is the round's first pitch: the whole round would have locked on
  // 1 Jan 1970. Same rule as a score list, wearing a date.
  const first = instantsOf(series.flatMap((s) => s.games.map((g) => g.kickoffAt)))
    .sort((a, b) => a - b)[0];
  // THE BOARD IS AN ARRAY, because contests.board is an array for every other
  // game in this product - the Weekly's players, Pick'em's games, October's
  // games - and at least one existing query calls jsonb_array_length on it
  // without asking which game it belongs to. The Run storing an object there
  // broke that query the first time a Run contest existed, which is a
  // cross-game collision in a shared column and not The Run's business to
  // introduce. Everything that is not a club goes in `meta`.
  return {
    clubs: clubs.sort((a, b) => Number(a.bye) - Number(b.bye) || String(a.abbr).localeCompare(String(b.abbr))),
    meta: {
      round,
      label: ROUND_LABEL[round],
      matchIds: [...new Set(matchIds)],
      firstPitch: first == null ? null : new Date(first).toISOString(),
      probables: Object.fromEntries([...probablesByKey].map(([k, v]) => [k, v])),
      seriesCount: series.length,
    },
  };
}

/** The twelve seeds, keyed by team id. Empty when standings are not in yet. */
export async function seedsFor(season) {
  const rows = await sql`
    SELECT tr.team_id, tr.playoff_seed AS seed, t.abbreviation, COALESCE(t.short_name, t.name) AS name,
           t.color_primary AS c1, t.color_secondary AS c2
      FROM team_records tr
      JOIN leagues l ON l.id = tr.league_id AND l.slug = 'mlb'
      JOIN teams t ON t.id = tr.team_id
     WHERE tr.season = ${season} AND tr.season_type = 'regular'
       AND tr.playoff_seed BETWEEN 1 AND 6`.catch(() => []);
  return rows.map((r) => ({
    teamId: r.team_id, abbr: r.abbreviation, name: r.name, seed: Number(r.seed),
    colors: r.c1 && r.c2 ? { primary: r.c1, secondary: r.c2 } : null,
  }));
}

/** The 1 and 2 seeds, who are not in the round-1 pool. */
export async function byeClubsFor(season) {
  return (await seedsFor(season)).filter((s) => s.seed <= 2);
}

/**
 * Create a round's contest if its series exist and it is not already there.
 *
 * A ROUND IS ONLY WORTH OPENING WHOLE. Half a Division field means the Wild
 * Card is still being played, and a board that gains clubs after people have
 * set their nine is a board they did not agree to.
 */
export async function ensureRunRound({ round, season, now = new Date(), fileHouse = true } = {}) {
  const week = weekOf(round);
  if (!week) return { created: false, reason: 'not-a-round' };
  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'run' AND sport = 'mlb' AND season_year = ${season} AND week = ${week}`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };

  const series = await seriesFor(round, season);
  if (!series.length) return { created: false, reason: 'no-series-yet' };
  const { SERIES_IN_ROUND } = await import('../mlb/postseason.js');
  if (series.length !== SERIES_IN_ROUND[round]) {
    return { created: false, reason: 'round-incomplete', have: series.length, want: SERIES_IN_ROUND[round] };
  }

  const allSeeds = await seedsFor(season);
  const seeds = new Map(allSeeds.map((s) => [String(s.teamId), s.seed]));
  const byeClubs = round === 'wild_card' ? allSeeds.filter((s) => s.seed <= 2) : [];
  let probables = new Map();
  const days = [...new Set(series.flatMap((s) => s.games.map((g) => new Date(g.kickoffAt).toISOString().slice(0, 10))))];
  for (const d of days) {
    const byKey = await probablesByMatch(d).catch(() => new Map());
    for (const [k, v] of byKey) probables.set(k, pickByKickoff(v, null)?.probables ?? v[0]?.probables ?? null);
  }
  const { clubs, meta } = boardFor({ round, series, byeClubs, seeds, probablesByKey: probables });
  if (!meta.firstPitch) return { created: false, reason: 'no-first-pitch' };
  const board = clubs;

  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('run', 'mlb', ${season}, ${week}, ${JSON.stringify(board)}::jsonb,
            ${new Date(now).toISOString()}, ${meta.firstPitch},
            ${new Date(new Date(meta.firstPitch).getTime() + 14 * 24 * 3_600_000).toISOString()},
            ${JSON.stringify({ ...meta, clubs: board.length,
    alive: board.filter((c) => !c.bye).length, byes: byeClubs.length })}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = 'run' AND sport = 'mlb'
        AND season_year = ${season} AND week = ${week}`;
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
  return { id: r[0].id, created: true, round, week,
    clubs: board.length, alive: board.filter((c) => !c.bye).length,
    locksAt: meta.firstPitch, house };
}

/**
 * Open every round that is ready. The postseason import calls this, and so
 * does the settle - which is what makes "the morning after the last series is
 * decided" true without anybody scheduling it.
 */
export async function ensureRunRounds(season, { now = new Date() } = {}) {
  const out = [];
  for (const round of ROUNDS) out.push({ round, ...await ensureRunRound({ round, season, now }) });
  return out;
}

/**
 * The round a reader is looking at.
 *
 * A DATE-KEYED PREVIEW ROUND SORTS BY ITS DAY, a real one by its week, and a
 * preview round for TODAY beats everything - the same rule October's day
 * reader follows and for the same reason: with four preview rounds open at
 * once, "unsettled, highest week" would hand a reader Sunday's on Thursday,
 * and every preview round has a NULL week anyway.
 */
export async function currentRunRound({ now = new Date() } = {}) {
  const iso = new Date(now).toISOString();
  const [c] = await sql`
    SELECT id, season_year, week, puzzle_date, board, meta, opens_at, locks_at, settled, settled_at
      FROM contests
     WHERE game_type = 'run' AND sport = 'mlb' AND opens_at <= ${iso}
     ORDER BY CASE
                WHEN puzzle_date = (${iso}::timestamptz AT TIME ZONE 'America/New_York')::date THEN 0
                WHEN puzzle_date >  (${iso}::timestamptz AT TIME ZONE 'America/New_York')::date THEN 1
                WHEN puzzle_date IS NULL AND NOT settled THEN 2
                ELSE 3
              END ASC,
              CASE WHEN puzzle_date > (${iso}::timestamptz AT TIME ZONE 'America/New_York')::date
                   THEN puzzle_date END ASC NULLS LAST,
              week DESC NULLS LAST,
              puzzle_date DESC NULLS LAST
     LIMIT 1`;
  return c ?? null;
}

/** Which rounds have settled, for the four pips. */
export async function settledRounds(season) {
  const rows = await sql`
    SELECT week FROM contests
     WHERE game_type = 'run' AND sport = 'mlb' AND season_year = ${season} AND settled
     ORDER BY week`;
  return rows.map((r) => ROUNDS[Number(r.week) - 1]).filter(Boolean);
}
