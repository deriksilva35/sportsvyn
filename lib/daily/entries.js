// lib/daily/entries.js - reading and writing a player's Daily entry.
//
// EVERY GUARD IS HERE, not in the route handlers. Three routes need the same
// questions answered - is the day open, does this person already have an entry,
// is the clock spent - and three copies of that is how one of them ends up
// subtly different.

import { sql } from '../db.js';
import { displayName } from './handles.js';
import { publicBoard } from './pool.js';
import { dailyHomeView, yesterdayView } from './homeModule.js';
import { clockVerdict, validateLineup, scoreLineup, bonusFor, applyBonus, bandFor } from './play.js';

/** Today's ET date, from Postgres so the boundary is DST-correct. */
export async function todayEt() {
  const r = await sql`SELECT to_char((now() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS d`;
  return r[0].d;
}

/**
 * The day, with a state the caller can branch on rather than re-derive.
 * 'missing' | 'pending' (exists but not open yet) | 'open' | 'closed'
 */
export async function getDay(puzzleDate) {
  const r = await sql`SELECT * FROM puzzle_days WHERE puzzle_date = ${puzzleDate}`;
  const d = r[0];
  if (!d) return { state: 'missing' };
  const now = Date.now();
  if (now < new Date(d.opens_at).getTime()) return { state: 'pending', day: d };
  if (now >= new Date(d.closes_at).getTime() || d.revealed) return { state: 'closed', day: d };
  return { state: 'open', day: d };
}

export async function getEntry(userId, puzzleDate) {
  const r = await sql`SELECT * FROM puzzle_entries WHERE user_id = ${userId} AND puzzle_date = ${puzzleDate}`;
  return r[0] ?? null;
}

/**
 * START: hand out the board and stamp the clock.
 *
 * The started_at row IS the clock. It is written before the board is returned,
 * so a player who reloads mid-round gets the same deadline rather than a fresh
 * three minutes - the entry row is created empty at start, not at lock.
 */
export async function startEntry(userId, puzzleDate) {
  const { state, day } = await getDay(puzzleDate);
  if (state !== 'open') return { ok: false, reason: state };

  const existing = await getEntry(userId, puzzleDate);
  if (existing?.locked_at) return { ok: false, reason: 'already entered' };
  if (existing) {
    const clock = clockVerdict(existing.created_at);
    // DNF: STARTED AND NEVER LOCKED. The attempt is consumed, because the board
    // was seen - handing out a second clock to anyone who abandons the first
    // would make the three minutes optional. You could open the board, read it at
    // leisure, walk away, and return to a fresh timer knowing every name on it.
    //
    // Said plainly rather than by handing back a board that can no longer be
    // submitted. A dead board with a running-out timer is the interface lying
    // about what happened.
    if (!clock.ok) return { ok: false, reason: 'dnf', elapsedMs: clock.elapsedMs };
    // Reload mid-round: same deadline, same board. Restarting the clock here
    // would make refresh a cheat code.
    return {
      ok: true, resumed: true, startedAt: existing.created_at,
      board: publicBoard(day.board), closesAt: day.closes_at,
    };
  }

  const ins = await sql`
    INSERT INTO puzzle_entries (user_id, puzzle_date, lineup)
    VALUES (${userId}, ${puzzleDate}, '{}'::jsonb)
    ON CONFLICT (user_id, puzzle_date) DO NOTHING
    RETURNING created_at`;
  // Lost the race with our own other tab: read back the winner's timestamp.
  const startedAt = ins[0]?.created_at ?? (await getEntry(userId, puzzleDate))?.created_at;
  return { ok: true, resumed: false, startedAt, board: publicBoard(day.board), closesAt: day.closes_at };
}

/**
 * LOCK: validate, score, write. The clock is checked against the STORED start,
 * never against anything the client sends.
 */
export async function lockEntry(userId, puzzleDate, lineup) {
  const { state, day } = await getDay(puzzleDate);
  if (state !== 'open') return { ok: false, reason: state };

  const entry = await getEntry(userId, puzzleDate);
  if (!entry) return { ok: false, reason: 'not started' };
  if (entry.locked_at) return { ok: false, reason: 'already entered' };

  const clock = clockVerdict(entry.created_at);
  if (!clock.ok) return { ok: false, reason: 'clock', detail: clock.reason, elapsedMs: clock.elapsedMs };

  const v = validateLineup(lineup, day.board);
  if (!v.ok) return { ok: false, reason: 'invalid lineup', errors: v.errors };

  const scored = scoreLineup(lineup, day.board);
  const upd = await sql`
    UPDATE puzzle_entries
       SET lineup = ${JSON.stringify(lineup)}::jsonb,
           base_score = ${scored.baseScore},
           score = ${scored.baseScore},
           locked_at = now()
     WHERE user_id = ${userId} AND puzzle_date = ${puzzleDate} AND locked_at IS NULL
     RETURNING id, locked_at`;
  // The WHERE ... locked_at IS NULL is the second lock guard: two simultaneous
  // submits, one row updated, the loser told it already entered.
  if (!upd.length) return { ok: false, reason: 'already entered' };

  return { ok: true, baseScore: scored.baseScore, droppedSlot: scored.droppedSlot, elapsedMs: clock.elapsedMs };
}

/**
 * GUESS: applied after the lineup is locked, never before. A guess cannot
 * change the lineup and the lineup cannot be resubmitted with a guess attached.
 */
export async function submitGuess(userId, puzzleDate, guess) {
  const { state, day } = await getDay(puzzleDate);
  if (state !== 'open') return { ok: false, reason: state };

  const entry = await getEntry(userId, puzzleDate);
  if (!entry?.locked_at) return { ok: false, reason: 'not locked' };
  if (entry.guess_season != null || entry.guess_week != null) return { ok: false, reason: 'already guessed' };

  const pct = bonusFor(guess, { season: day.season_year, week: day.week });
  const score = applyBonus(entry.base_score, pct);
  await sql`
    UPDATE puzzle_entries
       SET guess_season = ${guess?.season ?? null}, guess_week = ${guess?.week ?? null},
           bonus_pct = ${pct}, score = ${score}
     WHERE user_id = ${userId} AND puzzle_date = ${puzzleDate}`;
  // The bonus is reported; WHETHER IT WAS RIGHT IS NOT, pre-close. Telling the
  // player the season now would hand it to everyone they talk to.
  return { ok: true, bonusPct: pct, score };
}

/** The entered-state view: your score and a band, and nothing about anyone else. */
export async function entryView(userId, puzzleDate) {
  const { state, day } = await getDay(puzzleDate);
  if (state === 'missing') return { state };
  const entry = await getEntry(userId, puzzleDate);
  if (!entry) return { state, entry: null };
  if (!entry.locked_at) {
    // Started, never locked. Distinguished from "no entry" because the page
    // must not offer START again, and from "entered" because there is no score.
    const clock = clockVerdict(entry.created_at);
    return clock.ok
      ? { state, entry: null, inProgress: true, startedAt: entry.created_at }
      : { state, entry: null, dnf: true };
  }

  // THE BAND DENOMINATOR IS LOCKED ENTRIES ONLY. A DNF is not a zero - the
  // player never submitted a lineup - and counting them would push everyone
  // else's band up for free on a day with a lot of abandonments.
  const others = await sql`
    SELECT score FROM puzzle_entries WHERE puzzle_date = ${puzzleDate} AND locked_at IS NOT NULL AND score IS NOT NULL`;
  return {
    state,
    entry: {
      score: Number(entry.score), baseScore: Number(entry.base_score), bonusPct: Number(entry.bonus_pct),
      guessed: entry.guess_season != null || entry.guess_week != null,
      // THE GUESS ITSELF, echoed back. Pre-close this is the player's OWN
      // answer being read back to them - it reveals nothing they did not type,
      // and without it the entered screen silently swallows the thing they just
      // committed to. Whether it was RIGHT stays sealed until the reveal.
      guessSeason: entry.guess_season ?? null,
      guessWeek: entry.guess_week ?? null,
      band: bandFor(entry.score, others.map((o) => o.score)),
      entrants: others.length,
      closesAt: day.closes_at,
    },
  };
}

/**
 * Everything the HOMEPAGE module needs. The decision half is dailyHomeView()
 * in homeModule.js, which is pure; this only fetches.
 *
 * NEVER PASSES THE BOARD ALONG. getDay returns the whole row including the
 * sixty-four players, so the column is dropped here before the view is built.
 * The homepage has no use for it and the safest payload is the one that was
 * never assembled.
 */
export async function getDailyHome(userId = null) {
  const date = await todayEt();
  const { state, day } = await getDay(date);
  if (state !== 'open' && state !== 'closed') return null;

  const { board, ...dayNoBoard } = day ?? {};   // eslint-disable-line no-unused-vars
  const entry = userId != null ? await getEntry(Number(userId), date) : null;

  // The band denominator and the entrants count are the same read, and it is
  // only worth doing for a player who has actually locked something.
  const scores = (state === 'open' && entry?.locked_at)
    ? (await sql`
        SELECT score FROM puzzle_entries
         WHERE puzzle_date = ${date} AND locked_at IS NOT NULL AND score IS NOT NULL`)
      .map((r) => r.score)
    : [];

  return dailyHomeView({ date, dayState: state, day: dayNoBoard, entry, scores });
}

/**
 * How many players have LOCKED today's board - the lobby card's pulse. A
 * COUNT only: no score, no identity, nothing the open-day leak law protects
 * leaves the database. Zero is served as zero; the card copes.
 */
export async function todayEntrantCount() {
  const date = await todayEt();
  return (await sql`
    SELECT count(*)::int n FROM puzzle_entries
     WHERE puzzle_date = ${date} AND locked_at IS NOT NULL`)[0].n;
}

/**
 * YESTERDAY'S ANSWER for the homepage strip: the most recent REVEALED day,
 * whatever its date. Not literally "today minus one" - if a close is ever
 * missed the strip should show the last real answer rather than a hole.
 */
export async function getYesterday(userId = null) {
  const rows = await sql`
    SELECT puzzle_date, season_year, week, revealed, perfect
      FROM puzzle_days WHERE revealed ORDER BY puzzle_date DESC LIMIT 1`;
  const day = rows[0];
  if (!day) return null;

  const date = new Date(day.puzzle_date).toISOString().slice(0, 10);
  const [entry, top] = await Promise.all([
    userId == null ? null : getEntry(Number(userId), date),
    sql`
      SELECT e.score, u.handle, u.id
        FROM puzzle_entries e JOIN users u ON u.id = e.user_id
       WHERE e.puzzle_date = ${date} AND e.locked_at IS NOT NULL AND e.score IS NOT NULL
       ORDER BY e.score DESC, u.id ASC LIMIT 1`.then((r) => r[0] ?? null),
  ]);

  return yesterdayView({
    day: { ...day, puzzle_date: date },
    entry,
    winner: top ? { name: displayName({ id: top.id, handle: top.handle }), score: top.score } : null,
  });
}
