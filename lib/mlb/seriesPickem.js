// lib/mlb/seriesPickem.js - a Pick'em board whose picks are SERIES.
//
// ONE BOARD PER ROUND, FOUR A POSTSEASON. Not one board for the whole
// bracket: the Division Series field does not exist until the Wild Card is
// over, so a bracket-wide board would either open with eight unknowable picks
// or have to be edited underneath the people who filled it in.
//
// IT IS THE SAME CONTEST ROW. game_type 'pickem', sport 'mlb', and week = the
// round's index 1-4, which is what makes (sport, season_year, week) unique per
// round and lets every existing reader - the lobby card, the sequence, the
// stale alarm - find these boards without being taught a new game type.
//
// THE PICK IS KEYED BY THE SERIES, NOT BY A GAME. lib/mlb/series.js's key
// ("division:LAD-PHI") is stable, sorted and independent of who is at home,
// which is exactly what a key stored in a lineup for two weeks has to be. A
// match_id would have keyed the pick to ONE GAME of a best-of-seven.
//
// POINTS BY ROUND, 1 / 2 / 3 / 4. The existing scorer counts one per correct
// pick because every CFB game is worth the same; a World Series pick made
// eleven days earlier is not worth a Wild Card pick, and lib/mlb/postseason.js
// ROUND_POINTS is where that ladder lives.

import { sql } from '../db.js';
import { seriesFor } from './series.js';
import { STAGES, STAGE_LABEL, ROUND_POINTS, BEST_OF, SERIES_IN_ROUND } from './postseason.js';

/** Round -> the contest's week key. 1-4, in bracket order. */
export const weekForStage = (stage) => {
  const i = STAGES.indexOf(stage);
  return i < 0 ? null : i + 1;
};
export const stageForWeek = (week) => STAGES[Number(week) - 1] ?? null;

/**
 * IS THIS A SERIES BOARD? Asked of the board itself, not of the sport, and
 * that is deliberate: the settle path has to answer it for a row it is
 * holding, and `sport === 'mlb'` would be a claim about every MLB board this
 * product might ever have rather than about the one in hand.
 */
export function isSeriesBoard(board) {
  return Array.isArray(board) && board.length > 0 && board[0]?.series_key != null;
}

/**
 * The round's board, from the series that exist. PURE.
 *
 * A SERIES WITH A TEAM MISSING IS NOT ON THE BOARD. It cannot be rendered as
 * two sides and cannot be picked, and a board entry nobody can answer scores
 * as a no-pick for everyone - which is a silent points cap, not a game.
 */
export function boardFromSeries(series = [], seedByTeam = new Map()) {
  return series
    .filter((s) => s.teams?.length === 2 && s.teams.every((t) => t.id != null))
    .map((s) => ({
      series_key: s.key,
      stage: s.stage,
      best_of: s.bestOf,
      // FROZEN AT CREATION, the 067 law: a rescheduled first pitch neither
      // steals editing time nor grants it.
      first_pitch: new Date(s.firstDate).toISOString(),
      points: ROUND_POINTS[s.stage] ?? 1,
      teams: s.teams.map((t) => ({
        team_id: t.id, abbr: t.abbreviation, name: t.name,
        seed: seedByTeam.get(t.id) ?? null,
      })),
    }))
    .sort((a, b) => a.first_pitch.localeCompare(b.first_pitch) || a.series_key.localeCompare(b.series_key));
}

/**
 * THE RESULTS MAP, series-keyed. The counterpart of lib/pickem/settle.js's
 * resultsFor, and the same contract: complete, or a refusal naming what is
 * missing.
 *
 * A ROUND SETTLES WHEN EVERY SERIES IN IT IS DECIDED, which is not the same as
 * every GAME being final - a sweep leaves three scheduled games that will never
 * be played, and waiting for them would hang the board forever. This is why
 * the game-board's "every match final" gate cannot be reused here.
 */
export async function seriesResultsFor(board, season) {
  const stage = board[0]?.stage ?? null;
  const series = await seriesFor(stage, season);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const undecided = board.filter((b) => (byKey.get(b.series_key)?.winner ?? null) == null);
  if (undecided.length) {
    return { complete: false, remaining: undecided.length, results: null };
  }
  const results = {};
  for (const b of board) results[b.series_key] = byKey.get(b.series_key).winner;
  return { complete: true, remaining: 0, results };
}

/**
 * POINTS, not wins. PURE.
 *
 * THE COMPARISON IS ON STRINGS. A lineup comes back out of jsonb and a winner
 * comes out of an integer column; 6979 === "6979" is false and every pick in
 * the postseason would have graded as a loss. Both sides are stringified here
 * rather than trusting either to be a number.
 */
export function scoreSeriesLineup(lineup = {}, results = {}, board = []) {
  const pointsFor = new Map(board.map((b) => [b.series_key, Number(b.points) || 1]));
  let points = 0; let correct = 0;
  for (const [key, teamId] of Object.entries(lineup ?? {})) {
    const won = results?.[key];
    if (won == null || teamId == null) continue;
    if (String(won) === String(teamId)) { correct += 1; points += pointsFor.get(key) ?? 1; }
  }
  return { points, correct };
}

/** The most a board is worth, for the card's "x of y". PURE. */
export const maxPoints = (board = []) =>
  board.reduce((a, b) => a + (Number(b.points) || 1), 0);

/**
 * Plan the round's board without writing. Mirrors lib/pickem/create.js's
 * boardPlan so a read-only verification runs the identical code path.
 */
export async function seriesBoardPlan({ stage, season, now = new Date() } = {}) {
  const week = weekForStage(stage);
  if (!week) return { plan: null, reason: 'not-a-round' };
  const series = await seriesFor(stage, season);
  if (!series.length) return { plan: null, reason: 'no-series-yet' };

  const seedRows = await sql`
    SELECT tr.team_id, tr.playoff_seed AS seed
      FROM team_records tr JOIN leagues l ON l.id = tr.league_id AND l.slug = 'mlb'
     WHERE tr.season = ${season} AND tr.season_type = 'regular'
       AND tr.playoff_seed BETWEEN 1 AND 6`.catch(() => []);
  const board = boardFromSeries(series, new Map(seedRows.map((r) => [r.team_id, Number(r.seed)])));
  if (!board.length) return { plan: null, reason: 'no-playable-series' };

  // A ROUND IS ONLY WORTH OPENING WHOLE. Half the Division Series known means
  // the Wild Card is still being played, and a board that gains entries after
  // people have filled it in is a board they did not agree to.
  const want = SERIES_IN_ROUND[stage];
  if (board.length !== want) {
    return { plan: null, reason: 'round-incomplete', have: board.length, want };
  }

  const firstPitch = new Date(board[0].first_pitch);
  return {
    plan: {
      sport: 'mlb', seasonYear: season, week, stage,
      // LOCKS AT THE ROUND'S FIRST PITCH - the whole round, one lock, unlike
      // the football boards' per-game seal. A series pick is a prediction
      // about the round; letting it be changed after game 1 would make it a
      // prediction about game 2.
      locksAt: firstPitch,
      // OPENS NOW, BUT NEVER AFTER THE LOCK. A round becomes pickable the
      // moment its field is known, which in October is when this runs. For a
      // BACKFILL of a bracket already played, `now` is months after the first
      // pitch and an opens_at later than locks_at is a board that was open and
      // sealed at the same instant - min() makes it simply sealed, which is
      // the truth about a round nobody can pick any more.
      opensAt: new Date(Math.min(new Date(now).getTime(), firstPitch.getTime())),
      // ADVISORY ONLY, the house convention: the gate decides. A best-of-seven
      // that goes the distance ends about a week after it starts.
      settlesAt: new Date(firstPitch.getTime() + 12 * 24 * 3_600_000),
      board,
      maxPoints: maxPoints(board),
    },
    reason: null,
  };
}

/**
 * Create the round's board if it is not there. IDEMPOTENT the house way:
 * existence check on (game_type, sport, season_year, week), then an insert
 * that a race loses harmlessly.
 */
export async function ensureSeriesBoard({ stage, season, now = new Date() } = {}) {
  const { plan, reason, have, want } = await seriesBoardPlan({ stage, season, now });
  if (!plan) return { created: false, reason, have, want };

  const existing = await sql`
    SELECT id FROM contests
     WHERE game_type = 'pickem' AND sport = 'mlb'
       AND season_year = ${plan.seasonYear} AND week = ${plan.week}`;
  if (existing.length) return { id: existing[0].id, created: false, reason: 'exists' };

  const meta = {
    stage: plan.stage,
    stage_label: STAGE_LABEL[plan.stage],
    points_per_pick: ROUND_POINTS[plan.stage],
    best_of: BEST_OF[plan.stage],
    max_points: plan.maxPoints,
    series_board: true,
  };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settles_at, meta)
    VALUES ('pickem', 'mlb', ${plan.seasonYear}, ${plan.week},
            ${JSON.stringify(plan.board)}::jsonb, ${plan.opensAt.toISOString()},
            ${plan.locksAt.toISOString()}, ${plan.settlesAt.toISOString()},
            ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const again = await sql`
      SELECT id FROM contests WHERE game_type = 'pickem' AND sport = 'mlb'
        AND season_year = ${plan.seasonYear} AND week = ${plan.week}`;
    return { id: again[0]?.id, created: false, reason: 'raced' };
  }
  return {
    id: r[0].id, created: true, stage: plan.stage, week: plan.week,
    series: plan.board.length, maxPoints: plan.maxPoints,
    locksAt: plan.locksAt.toISOString(),
  };
}

/**
 * Settle one series board. Called by lib/pickem/settle.js when the board it
 * is holding turns out to be series-shaped.
 */
export async function settleSeriesBoard(contest) {
  const board = contest.board ?? [];
  const r = await seriesResultsFor(board, contest.season_year);
  if (!r.complete) return { contestId: contest.id, settled: false, remaining: r.remaining };
  const entries = await sql`
    SELECT id, user_id, lineup FROM contest_entries WHERE contest_id = ${contest.id}`;
  for (const e of entries) {
    const { points } = scoreSeriesLineup(e.lineup ?? {}, r.results, board);
    await sql`
      UPDATE contest_entries
         SET score = ${points}, base_score = ${points},
             locked_at = COALESCE(locked_at, now()), updated_at = now()
       WHERE id = ${e.id}`;
  }
  await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           perfect = ${JSON.stringify({ results: r.results, max: maxPoints(board) })}::jsonb
     WHERE id = ${contest.id} AND NOT settled`;
  return { contestId: contest.id, settled: true, entries: entries.length };
}

/**
 * SAVE ONE PICK. The door is app/actions/seriesPickem.js; every rule is here.
 *
 * THE LOCK IS THE ROUND'S, NOT THE SERIES'. The football boards seal each game
 * at its own kickoff because each game is its own question. A series pick is a
 * prediction about the ROUND - who comes out of it - and letting it be changed
 * after game 1 would quietly turn it into a prediction about game 2, which is
 * a different and much easier game.
 *
 * THE SERVER CLOCK IS THE ONLY CLOCK, and locks_at is the snapshot taken at
 * creation: a rescheduled first pitch neither steals editing time nor grants
 * it.
 */
export async function saveSeriesPick(userId, contestId, seriesKey, teamId, { now = new Date() } = {}) {
  const contest = (await sql`
    SELECT id, board, settled, opens_at, locks_at FROM contests
     WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  if (!isSeriesBoard(contest.board)) return { ok: false, reason: 'not_a_series_board' };
  const t = new Date(now).getTime();
  if (new Date(contest.opens_at).getTime() > t) return { ok: false, reason: 'not_open' };
  if (new Date(contest.locks_at).getTime() <= t) {
    return { ok: false, reason: 'round_locked', locksAt: contest.locks_at };
  }
  const entry = contest.board.find((b) => b.series_key === seriesKey);
  if (!entry) return { ok: false, reason: 'not_on_board' };
  // THE TEAM HAS TO BE IN THE SERIES. Without this an arbitrary id saves, is
  // never equal to a winner, and grades as a loss the picker cannot explain.
  if (!entry.teams.some((x) => String(x.team_id) === String(teamId))) {
    return { ok: false, reason: 'not_in_series' };
  }
  // A FLAT MAP {series_key: team_id} - the one place jsonb || is honest,
  // because there is no nesting here by construction.
  const patch = JSON.stringify({ [seriesKey]: Number(teamId) });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now()`;
  return { ok: true, seriesKey, teamId: Number(teamId) };
}

/** The round board the route serves: the newest unsettled MLB board, or the last. */
export async function currentSeriesBoard({ now = new Date() } = {}) {
  const [c] = await sql`
    SELECT id, season_year, week, board, meta, opens_at, locks_at, settled, settled_at, perfect
      FROM contests
     WHERE game_type = 'pickem' AND sport = 'mlb' AND opens_at <= ${new Date(now).toISOString()}
     ORDER BY settled ASC, locks_at DESC
     LIMIT 1`;
  return c ?? null;
}

/**
 * THE VIEW, viewer-scoped. Carries the reader's own picks and nobody else's -
 * the same wire law lib/pickem/entry.js is pinned to.
 */
export async function seriesBoardView(userId, { now = new Date() } = {}) {
  const c = await currentSeriesBoard({ now });
  if (!c) return { phase: 'preopen', contest: null, rows: [] };
  const board = c.board ?? [];
  const stage = c.meta?.stage ?? stageForWeek(c.week);
  const [entry] = userId == null ? [] : await sql`
    SELECT lineup, score FROM contest_entries
     WHERE contest_id = ${c.id} AND user_id = ${userId} LIMIT 1`;
  const picks = entry?.lineup ?? {};
  const series = await seriesFor(stage, c.season_year);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const locked = new Date(c.locks_at).getTime() <= new Date(now).getTime();

  const rows = board.map((b) => {
    const s = byKey.get(b.series_key) ?? null;
    const mine = picks[b.series_key] ?? null;
    const won = s?.winner ?? null;
    return {
      seriesKey: b.series_key,
      stage: b.stage,
      bestOf: b.best_of,
      points: b.points,
      firstPitch: b.first_pitch,
      status: s?.status ?? 'scheduled',
      record: s?.record ?? '0-0',
      nextGame: s?.nextGame ?? null,
      // GRADED ONLY WHEN THE SERIES IS DECIDED - not when a game is. A 2-1
      // lead in a best-of-seven is not a result.
      graded: won == null || mine == null ? null : (String(won) === String(mine) ? 'W' : 'L'),
      teams: b.teams.map((t) => ({
        ...t,
        wins: s?.teams?.find((x) => x.id === t.team_id)?.wins ?? 0,
        picked: mine != null && String(mine) === String(t.team_id),
        winner: won != null && String(won) === String(t.team_id),
      })),
    };
  });

  const made = rows.filter((r) => r.teams.some((t) => t.picked)).length;
  return {
    phase: c.settled ? 'settled' : locked ? 'locked' : 'open',
    contest: {
      id: c.id, season: c.season_year, week: c.week, stage,
      label: STAGE_LABEL[stage] ?? stage,
      pointsPerPick: ROUND_POINTS[stage] ?? 1,
      locksAt: c.locks_at, settled: c.settled,
      maxPoints: c.meta?.max_points ?? maxPoints(board),
    },
    rows,
    made,
    total: rows.length,
    score: entry?.score == null ? null : Number(entry.score),
  };
}
