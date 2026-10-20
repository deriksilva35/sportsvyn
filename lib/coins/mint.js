// lib/coins/mint.js - THE MINT: one hourly job turns settled play into arcade
// points and coins (Rules v0.1 s3; ruling coins-2: ONE job, not a hook in
// every settle path).
//
// WHAT IT READS. Every contest that settled in the look-back window (contests
// .settled, not void-all, an eligible game - lib/coins/rules.js ELIGIBLE), and
// every Daily board past closes_at (the Daily has no settle step: a closed
// board IS its settlement). Rank is computed here with competitionRank over
// the scored field, ties sharing the place - no game stores a rank.
//
// WHO COUNTS. House accounts and test sentinels (@example.invalid) are not
// players: they are out of the field, the entrant count and the points. Daily
// guests have no account and are never in daily_board_runs (a late claim is
// off the board too). Under 10 scored entrants: nothing for anybody.
//
// IDEMPOTENT. Each award is one arcade_points row on UNIQUE (user_id,
// contest_key, event); a rerun inserts nothing it already holds. The coins are
// a pure function of points so far, minus coins minted so far, capped per week
// - re-running mints only what is newly owed. A regrade after the points were
// written does not move them: the first settlement is the one paid.
//
// WHICH WEEK. Points belong to the week their contest settled in (Daily: the
// week its board closed in). A week already drawn takes nothing more: a late
// settlement for it lands in the week that is open now.
//
// The close job (lib/coins/close.js) runs this first, so a Weekly that settled
// minutes before the Close is in the drawing.

import { sql as defaultSql } from '../db.js';
import { competitionRank } from '../games/rank.js';
import { weekOf } from './week.js';
import { POINTS, MIN_ENTRANTS, ELIGIBLE, DEFAULT_PRIZES, isEligibleContest, finishTier, mintQty } from './rules.js';

export const coinsEnabled = (env = process.env) => String(env?.COINS ?? '').trim().toLowerCase() === 'on';
export const LOOKBACK_DAYS = 8;
/** Test rows' addresses. A test that needs its own fixture minted passes a pattern that matches nothing. */
export const SENTINEL_LIKE = '%@example.invalid';
const CHUNK = 400;

// A PLAYER, not a house persona or a test row - written out in every query below
// (over `u`): NOT COALESCE(u.is_house, false) AND COALESCE(u.email, '') NOT LIKE SENTINEL

/** The week row containing `at`, created (with the posted prizes) if new. */
export async function ensureWeek(db, at = new Date()) {
  const { opensAt, closesAt } = weekOf(at);
  const made = await db`
    INSERT INTO coin_weeks (opens_at, closes_at) VALUES (${opensAt.toISOString()}, ${closesAt.toISOString()})
    ON CONFLICT (opens_at) DO NOTHING RETURNING id`;
  const [row] = await db`SELECT * FROM coin_weeks WHERE opens_at = ${opensAt.toISOString()}`;
  // THE PRIZES POST WHEN THE WEEK OPENS (s5) and never change after: only a
  // week this call created gets the defaults.
  if (made.length) {
    await db`
      INSERT INTO drum_prizes (week_id, prize_key, title, kind, value_cents, count)
      SELECT ${row.id}, x.prize_key, x.title, x.kind, x.value_cents, x.count
        FROM jsonb_to_recordset(${JSON.stringify(DEFAULT_PRIZES)}::jsonb)
             AS x(prize_key text, title text, kind text, value_cents int, count int)
      ON CONFLICT DO NOTHING`;
  }
  return row;
}

/** Score used for rank: a confidence/percentage board ranks by share of its max. */
export function rankScore(gameType, e) {
  if (e.score == null) return null;
  const s = Number(e.score);
  if (gameType === 'pickem' && e.max_score != null && Number(e.max_score) > 0) return s / Number(e.max_score);
  return s;
}

/** Did this entry finish? Run and October keep a DNF row at score 0. */
export function finished(gameType, e) {
  if (e.score == null) return false;
  if (gameType === 'run' && e.meta?.run?.state === 'DNF') return false;
  if (gameType === 'october' && e.meta?.october?.state === 'DNF') return false;
  return true;
}

/**
 * PURE. One settled field -> its awards: 25 for every finisher, plus the one
 * best finish tier. Nothing under MIN_ENTRANTS. rows: [{ user_id, score }].
 */
export function awardsFor(rows = []) {
  const field = rows.filter((r) => r.score != null && Number.isFinite(Number(r.score)));
  if (field.length < MIN_ENTRANTS) return [];
  const ranked = competitionRank(field, (r) => Number(r.score), () => null);
  const atRank = new Map();
  for (const r of ranked) atRank.set(r.rank, (atRank.get(r.rank) ?? 0) + 1);
  const out = [];
  for (const r of ranked) {
    out.push({ user_id: Number(r.user_id), event: 'settled', points: POINTS.settled, detail: { rank: r.rank, of: field.length } });
    const t = finishTier({ rank: r.rank, n: field.length, atRank: atRank.get(r.rank) });
    if (t) out.push({ user_id: Number(r.user_id), event: t.event, points: t.points, detail: { rank: r.rank, of: field.length } });
  }
  return out;
}

async function insertPoints(db, rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const got = await db`
      INSERT INTO arcade_points (user_id, contest_key, event, points, week_id, detail)
      SELECT x.user_id, x.contest_key, x.event, x.points, x.week_id, COALESCE(x.detail, '{}'::jsonb)
        FROM jsonb_to_recordset(${JSON.stringify(rows.slice(i, i + CHUNK))}::jsonb)
             AS x(user_id int, contest_key text, event text, points int, week_id int, detail jsonb)
      ON CONFLICT (user_id, contest_key, event) DO NOTHING
      RETURNING id`;
    n += got.length;
  }
  return n;
}

/**
 * THE RUN. -> { decision, week, contests, boards, points: {event: n}, coins, minters }.
 * Off unless COINS=on, or `force` (tests). `now` is an argument so a test can
 * run the job at any instant.
 */
export async function runMint({ now = new Date(), db = defaultSql, force = false, sentinelLike = SENTINEL_LIKE } = {}) {
  if (!force && !coinsEnabled()) return { decision: 'skipped-off' };
  const current = await ensureWeek(db, now);
  const [{ start }] = await db`SELECT min(opens_at) AS start FROM coin_weeks`;
  const programStart = new Date(start);
  const since = new Date(Math.max(programStart.getTime(), new Date(now).getTime() - LOOKBACK_DAYS * 86_400_000));
  const nowIso = new Date(now).toISOString();

  // Which week an instant's points go to (null before the program began).
  const weekCache = new Map();
  const weekFor = async (at) => {
    if (new Date(at) < programStart) return null;
    const key = weekOf(at).opensAt.toISOString();
    if (!weekCache.has(key)) {
      const w = await ensureWeek(db, at);
      weekCache.set(key, w.drawn_at ? current : w);
    }
    return weekCache.get(key);
  };

  const rows = [];
  const tally = { contests: 0, boards: 0 };

  // CONTESTS: settled in the window, eligible, not void-all.
  const contests = (await db`
    SELECT c.id, c.game_type, c.sport, c.settled_at FROM contests c
     WHERE c.settled AND c.settled_at >= ${since.toISOString()} AND c.settled_at <= ${nowIso}
       AND c.game_type = ANY(${Object.keys(ELIGIBLE)})
       AND NOT COALESCE((c.meta->>'void_all')::boolean, false)
     ORDER BY c.id`).filter(isEligibleContest);
  for (let i = 0; i < contests.length; i += 50) {
    const batch = contests.slice(i, i + 50);
    const entries = await db`
      SELECT e.contest_id, e.user_id, e.score, e.max_score, e.meta FROM contest_entries e JOIN users u ON u.id = e.user_id
       WHERE e.contest_id = ANY(${batch.map((c) => c.id)}) AND e.score IS NOT NULL AND NOT COALESCE(u.is_house, false) AND COALESCE(u.email, '') NOT LIKE ${sentinelLike}`;
    for (const c of batch) {
      const field = entries.filter((e) => e.contest_id === c.id && finished(c.game_type, e))
        .map((e) => ({ user_id: e.user_id, score: rankScore(c.game_type, e) }));
      const awards = awardsFor(field);
      if (!awards.length) continue;
      const w = await weekFor(c.settled_at);
      if (!w) continue;
      tally.contests += 1;
      for (const a of awards) rows.push({ ...a, contest_key: `contest:${c.id}`, week_id: w.id, detail: { ...a.detail, game: c.game_type, sport: c.sport } });
    }
  }

  // THE DAILY: a board past closes_at is settled; a late claim is off the board.
  const boards = await db`
    SELECT b.id, b.closes_at FROM daily_boards b
     WHERE b.closes_at >= ${since.toISOString()} AND b.closes_at <= ${nowIso} ORDER BY b.id`;
  for (const b of boards) {
    const runs = await db`
      SELECT r.user_id, r.score FROM daily_board_runs r JOIN users u ON u.id = r.user_id
       WHERE r.board_id = ${b.id} AND r.score IS NOT NULL AND NOT COALESCE(r.late_claim, false) AND NOT COALESCE(u.is_house, false) AND COALESCE(u.email, '') NOT LIKE ${sentinelLike}`;
    const awards = awardsFor(runs.map((r) => ({ user_id: r.user_id, score: Number(r.score) })));
    if (!awards.length) continue;
    const w = await weekFor(b.closes_at);
    if (!w) continue;
    tally.boards += 1;
    for (const a of awards) rows.push({ ...a, contest_key: `daily:${b.id}`, week_id: w.id, detail: { ...a.detail, game: 'daily' } });
  }

  // FIRST PLAY IN A WEEK (any eligible public game, on the spot): every week
  // not yet drawn whose window has started.
  const open = await db`SELECT * FROM coin_weeks WHERE drawn_at IS NULL AND opens_at <= ${nowIso} ORDER BY opens_at`;
  for (const w of open) {
    const until = new Date(Math.min(new Date(w.closes_at).getTime(), new Date(now).getTime())).toISOString();
    const played = await db`
      SELECT DISTINCT e.user_id, c.game_type, c.sport FROM contest_entries e
        JOIN contests c ON c.id = e.contest_id JOIN users u ON u.id = e.user_id
       WHERE e.created_at >= ${w.opens_at} AND e.created_at < ${until}
         AND c.game_type = ANY(${Object.keys(ELIGIBLE)}) AND NOT COALESCE(u.is_house, false) AND COALESCE(u.email, '') NOT LIKE ${sentinelLike}`;
    const daily = await db`
      SELECT DISTINCT r.user_id FROM daily_board_runs r JOIN users u ON u.id = r.user_id
       WHERE r.completed_at >= ${w.opens_at} AND r.completed_at < ${until}
         AND NOT COALESCE(r.late_claim, false) AND NOT COALESCE(u.is_house, false) AND COALESCE(u.email, '') NOT LIKE ${sentinelLike}`;
    const users = new Set([...played.filter(isEligibleContest).map((r) => Number(r.user_id)), ...daily.map((r) => Number(r.user_id))]);
    for (const u of users) rows.push({ user_id: u, contest_key: `week:${w.id}`, event: 'first-play', points: POINTS.firstPlay, week_id: w.id, detail: {} });
  }

  const inserted = await insertPoints(db, rows);

  // THE 3-WEEK STREAK (awarded at the third, then every third): a run of
  // consecutive weeks with a first play, its length a multiple of 3.
  const weeks = await db`SELECT id, opens_at FROM coin_weeks ORDER BY opens_at`;
  const firsts = await db`SELECT user_id, week_id FROM arcade_points WHERE event = 'first-play'`;
  const playedIn = new Map();
  for (const f of firsts) {
    if (!playedIn.has(f.user_id)) playedIn.set(f.user_id, new Set());
    playedIn.get(f.user_id).add(f.week_id);
  }
  const streakRows = [];
  for (const w of open) {
    const idx = weeks.findIndex((x) => x.id === w.id);
    for (const [u, set] of playedIn) {
      if (!set.has(w.id)) continue;
      let len = 0;
      for (let k = idx; k >= 0 && set.has(weeks[k].id); k -= 1) {
        // Consecutive means 7 days apart: a week the job never opened breaks the run.
        if (k < idx && new Date(weeks[k + 1].opens_at) - new Date(weeks[k].opens_at) !== 7 * 86_400_000) break;
        len += 1;
      }
      if (len >= 3 && len % 3 === 0) streakRows.push({ user_id: Number(u), contest_key: `week:${w.id}`, event: 'streak3', points: POINTS.streak3, week_id: w.id, detail: { weeks: len } });
    }
  }
  const streaks = await insertPoints(db, streakRows);

  // THE MINT: whole hundreds of progress become coins, up to the cap, in
  // every week not yet drawn (oldest first).
  let coins = 0; const minters = new Set();
  for (const w of open) {
    const owed = await db`
      WITH wk AS (SELECT id FROM coin_weeks WHERE opens_at <= ${w.opens_at}),
           p AS (SELECT user_id, sum(points)::int AS tp FROM arcade_points WHERE week_id IN (SELECT id FROM wk) GROUP BY 1),
           m AS (SELECT user_id, sum(qty)::int AS me, (sum(qty) FILTER (WHERE week_id = ${w.id}))::int AS mw
                   FROM coin_mint WHERE week_id IN (SELECT id FROM wk) GROUP BY 1)
      SELECT p.user_id, p.tp, COALESCE(m.me, 0) AS me, COALESCE(m.mw, 0) AS mw FROM p LEFT JOIN m USING (user_id)`;
    const mints = owed.map((o) => {
      const qty = mintQty({ totalPoints: o.tp, mintedEver: o.me, mintedThisWeek: o.mw });
      // seq = coins ever after this row (148): a racing run computes the same
      // seq and its INSERT does nothing.
      return { user_id: Number(o.user_id), qty, seq: o.me + qty };
    }).filter((m) => m.qty > 0);
    if (mints.length) {
      const got = await db`
        INSERT INTO coin_mint (user_id, week_id, qty, seq, source)
        SELECT x.user_id, ${w.id}, x.qty, x.seq, 'meter' FROM jsonb_to_recordset(${JSON.stringify(mints)}::jsonb) AS x(user_id int, qty int, seq int)
        ON CONFLICT (user_id, seq) DO NOTHING RETURNING user_id, qty`;
      for (const m of got) { coins += m.qty; minters.add(Number(m.user_id)); }
    }
  }

  const byEvent = {};
  for (const r of rows) byEvent[r.event] = (byEvent[r.event] ?? 0) + 1;
  return { decision: 'ran', week: current.id, ...tally, offered: rows.length + streakRows.length, inserted: inserted + streaks, byEvent, coins, minters: minters.size };
}
