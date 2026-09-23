// lib/october/create.js - one contest per postseason day.
//
// THE DAY IS THE UNIT, and `contests` already has the column for it:
// puzzle_date, with a UNIQUE index on (game_type, sport, puzzle_date) that
// makes "one October contest per day" a database fact rather than a
// convention. Nothing new was needed for the spine.
//
// LINEUPS AND PROBABLES ARE FROZEN AT CREATION. The board snapshot is the
// 067 law applied to a five-a-day card: a rescheduled first pitch neither
// steals editing time nor grants it, and a lineup published after the card
// opened does not silently change who was pickable when somebody picked.
//
// THE DAY IS THE AMERICAN CALENDAR DAY. A 01:45Z first pitch is the previous
// evening's game in every sense a reader has, and a UTC day would split one
// night's slate across two cards.

import { sql } from '../db.js';
import { fetchProbablesByMatch, matchKey, pickByKickoff, statsApiEnabled } from '../mlb/statsapi.js';

const ET = 'America/New_York';

/**
 * THE PREVIEW RUNS ON THE REGULAR SEASON, and it is the same game.
 *
 * October's rules are about a DAY's games - one arm, four bats, only from
 * today, the cap that scales with the slate, the burn - and not one of them
 * mentions the postseason. So the preview is the identical contest sourced
 * from regular-season dates instead of staged ones, which is why this is a
 * second QUERY and not a second game.
 *
 * ITS BURN IS ITS OWN. usedPlayers() scopes by season_year and game_type, so
 * a preview day and a postseason day of the same season would share a pool -
 * which would mean a reader who spent Judge in a September preview could not
 * pick him in the World Series. The preview's contests carry meta.preview and
 * the burn read excludes across that line; see lib/october/pool.js.
 */
export async function regularSeasonDays(season, fromDay, toDay) {
  const rows = await sql`
    SELECT to_char((m.kickoff_at AT TIME ZONE ${ET})::date, 'YYYY-MM-DD') AS day,
           m.id AS match_id, m.slug, m.kickoff_at, m.stage, m.status,
           m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           COALESCE(h.short_name, h.name) AS home_name,
           COALESCE(a.short_name, a.name) AS away_name,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.stage IS NULL AND m.season_year = ${season}
       AND (m.kickoff_at AT TIME ZONE ${ET})::date BETWEEN ${fromDay}::date AND ${toDay}::date
     ORDER BY m.kickoff_at ASC, m.id ASC`;
  return groupByDay(rows);
}

function groupByDay(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.day)) by.set(r.day, []);
    by.get(r.day).push(r);
  }
  return by;
}

/** The postseason days we hold games for, ET, with their games. */
export async function postseasonDays(season) {
  const rows = await sql`
    SELECT to_char((m.kickoff_at AT TIME ZONE ${ET})::date, 'YYYY-MM-DD') AS day,
           m.id AS match_id, m.slug, m.kickoff_at, m.stage, m.status,
           m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr,
           COALESCE(h.short_name, h.name) AS home_name,
           COALESCE(a.short_name, a.name) AS away_name,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.stage IS NOT NULL AND m.season_year = ${season}
     ORDER BY m.kickoff_at ASC, m.id ASC`;
  return groupByDay(rows);
}

/** PURE. One day's rows -> the board snapshot a card reads. */
export function boardFor(rows = [], probablesByKey = new Map()) {
  return rows.map((r) => {
    const day = new Date(r.kickoff_at).toISOString().slice(0, 10);
    const hits = probablesByKey.get(matchKey(r.away_abbr, r.home_abbr, day)) ?? [];
    const hit = pickByKickoff(hits, r.kickoff_at);
    return {
      match_id: r.match_id,
      slug: r.slug,
      kickoff_at: new Date(r.kickoff_at).toISOString(),
      stage: r.stage,
      home_team_id: r.home_team_id,
      away_team_id: r.away_team_id,
      home: { abbr: r.home_abbr, name: r.home_name, c1: r.home_c1, c2: r.home_c2 },
      away: { abbr: r.away_abbr, name: r.away_name, c1: r.away_c1, c2: r.away_c2 },
      // FROZEN. Whoever was announced when the card opened is who the card
      // says is starting, for as long as the card exists.
      probables: hit?.probables ?? null,
    };
  });
}

/**
 * Create the day's contest if it is not there. IDEMPOTENT on the unique index.
 *
 * OPENS THE MOMENT IT IS CREATED and LOCKS AT THE LAST FIRST PITCH - the
 * contest-level locks_at is the close of the join window, exactly as the
 * football boards use it; the lock that seals a PICK is per slot and lives in
 * lib/october/rules.js.
 */
export async function ensureOctoberDay({ season, day, rows, preview = false, now = new Date(), fileHouse = true }) {
  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'october' AND sport = 'mlb' AND puzzle_date = ${day}`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };
  if (!rows?.length) return { created: false, reason: 'no-games' };

  let probables = new Map();
  if (statsApiEnabled(process.env)) {
    probables = await fetchProbablesByMatch(day).catch(() => new Map());
  }
  const board = boardFor(rows, probables);
  const first = new Date(board[0].kickoff_at);
  const last = new Date(board[board.length - 1].kickoff_at);
  const meta = {
    stage: rows[0].stage,
    games: board.length,
    first_pitch: first.toISOString(),
    probables_frozen: board.some((g) => g.probables != null),
    // THE PREVIEW SAYS SO ON THE ROW, not just on the card. Every reader of a
    // contest - the board, the lobby row, the settle - can ask one field
    // whether this is the real thing, and a preview that only announced
    // itself in the UI would settle into the same leaderboard as the real
    // October.
    ...(preview ? { preview: true, season_label: 'PREVIEW · regular season' } : {}),
  };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, puzzle_date, board,
                          opens_at, locks_at, settles_at, meta)
    VALUES ('october', 'mlb', ${season}, ${day}, ${JSON.stringify(board)}::jsonb,
            ${new Date(now).toISOString()}, ${last.toISOString()},
            ${new Date(last.getTime() + 12 * 3_600_000).toISOString()},
            ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = 'october' AND sport = 'mlb' AND puzzle_date = ${day}`;
    return { id: again[0]?.id, created: false, reason: 'raced' };
  }
  // THE HOUSE FILES NOW, ON THE ONE PASS THAT CREATED THE DAY.
  //
  // HERE AND NOT ON A CRON, because this is the only place an October day comes
  // into existence and the card opens the moment this returns - so the house is
  // on the board before the first reader loads it. Only on a real create: the
  // 'exists' and 'raced' paths above return early, so a re-run of the importer
  // does not re-file (and saveOctoberPick is idempotent anyway, being the same
  // merge the card does).
  //
  // IMPORTED DYNAMICALLY so an importer that creates nothing never loads the
  // house at all, and AWAITED rather than fired off: an importer that returned
  // while filings were still in flight would race its own transaction's view of
  // the contest row that octoberPool writes its cache into.
  //
  // AND IT CANNOT TAKE THE DAY DOWN. A house that cannot file is a missing set
  // of rows on a board; a throw here would be a missing CARD for everybody.
  let house = null;
  if (fileHouse) {
    house = await (async () => {
      const { fileOctoberDay } = await import('../house/october.js');
      return fileOctoberDay(
        { id: r[0].id, board, season_year: season, meta, puzzle_date: day },
        { now },
      );
    })().catch((e) => ({ error: String(e?.message ?? e).slice(0, 120) }));
  }

  return {
    id: r[0].id, created: true, day, games: board.length, stage: rows[0].stage,
    firstPitch: first.toISOString(), locksAt: last.toISOString(),
    house,
  };
}

/** Every postseason day that has games. The postseason import calls this. */
export async function ensureOctoberDays(season, { now = new Date() } = {}) {
  const days = await postseasonDays(season);
  const out = [];
  for (const [day, rows] of [...days].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push({ day, ...await ensureOctoberDay({ season, day, rows, now }) });
  }
  return out;
}

/** Every preview day in a window. Same contest, regular-season slate. */
export async function ensureOctoberPreview(season, { from, to, now = new Date() } = {}) {
  const days = await regularSeasonDays(season, from, to);
  const out = [];
  for (const [day, rows] of [...days].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push({ day, ...await ensureOctoberDay({ season, day, rows, preview: true, now }) });
  }
  return out;
}

/**
 * The day a reader is looking at.
 *
 * TODAY'S CARD FIRST, and that is the change the preview forced. The old
 * ordering was "unsettled, newest" - fine when every open day was in the
 * future, wrong the moment six preview days exist at once, because it would
 * hand a reader Sunday's card on Tuesday. The day whose ET date is TODAY is
 * the one they came for; only when there is no card for today does the next
 * one with games stand in, and only when there is none of those does the last
 * one played.
 */
export async function currentOctoberDay({ now = new Date() } = {}) {
  const iso = new Date(now).toISOString();
  const [c] = await sql`
    SELECT id, season_year, puzzle_date, board, meta, opens_at, locks_at, settled, settled_at
      FROM contests
     WHERE game_type = 'october' AND sport = 'mlb' AND opens_at <= ${iso}
     ORDER BY CASE
                WHEN puzzle_date = (${iso}::timestamptz AT TIME ZONE ${ET})::date THEN 0
                WHEN puzzle_date >  (${iso}::timestamptz AT TIME ZONE ${ET})::date THEN 1
                ELSE 2
              END ASC,
              CASE WHEN puzzle_date > (${iso}::timestamptz AT TIME ZONE ${ET})::date
                   THEN puzzle_date END ASC NULLS LAST,
              puzzle_date DESC
     LIMIT 1`;
  return c ?? null;
}
