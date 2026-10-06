// lib/daily/guestRuns.js - a signed-out play of the Daily (Option A).
//
// THE SHAPE. A signed-out reader gets ONE play per device per board. The run is
// stored in daily_guest_runs (migration 130) - never in daily_board_runs - so
// no leaderboard, streak, played tally or "beat N%" count can see it: those
// reads are all over daily_board_runs, and this file is the ONLY module that
// names the guest table (pinned by guestRuns.test.mjs, which walks the tree).
// Signing in CLAIMS the run: one statement copies a finished run into
// daily_board_runs for the account, and only then does it exist anywhere
// public.
//
// WHO IS "THE DEVICE": a signed cookie (sv_gd). A cookie is not a device, so
// start is also capped per IP (GUEST_START_PER_IP) - what bounds clearing it.
//
// THE START TOKEN is signed {run, board, device}. It rides in the start
// response, comes back with the picks, and is honoured only if the cookie's
// device matches the one inside it. The CLOCK is never in the token: elapsed is
// the stored started_at against Postgres now(), as for a signed-in run.
//
// CLAIM EXPIRY: midnight PT at the end of the edition's ET date (written on the
// row at start). That is ~3 hours AFTER the ET close, so a claim can land on a
// board that has already closed. RULING (tue-3): it is saved to the account
// (entry + streak) but flagged late_claim and kept off that board and its
// counts. One claim per account per ET day.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { regradeStoredRun } from './seasonBoardRuns.js';
import { slotsOf, DAILY_ROUND_SECONDS, DAILY_ROUND_GRACE_SECONDS } from './boardShape.js';
import { ownRows, beatPct, openBoardRows } from './openReveal.js';
import { todayLeaderboard } from './seasonBoardLeaderboards.js';
import { boardView } from '../boards/live.js';

export const GUEST_COOKIE = 'sv_gd';
export const GUEST_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/** New guest starts per IP per rolling hour (resumes are free). Household / NAT sized, like SEND_PER_IP. */
export const GUEST_START_PER_IP = Object.freeze({ max: 6, windowMs: 60 * 60 * 1000 });

// ---- signing ---------------------------------------------------------------

function secret() {
  const s = process.env.AUTH_SECRET;
  if (typeof s !== 'string' || s.length < 16) throw new Error('AUTH_SECRET is not set - refusing to sign a guest token');
  return s;
}
const mac = (payload) => createHmac('sha256', secret()).update(`daily-guest:${payload}`).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export const newDeviceId = () => randomUUID();

/** The cookie value for a device id: `<id>.<mac>`. */
export const signDevice = (id) => `${id}.${mac(`dev:${id}`)}`;

/** The device id inside a cookie value, or null if absent / forged. */
export function verifyDevice(value) {
  if (typeof value !== 'string') return null;
  const i = value.lastIndexOf('.');
  if (i < 1) return null;
  const id = value.slice(0, i);
  return safeEqual(value.slice(i + 1), mac(`dev:${id}`)) ? id : null;
}

/** The signed start token for one guest run. */
export function signStartToken({ runId, boardId, deviceId }) {
  const body = Buffer.from(JSON.stringify({ r: Number(runId), b: Number(boardId), d: deviceId })).toString('base64url');
  return `${body}.${mac(`tok:${body}`)}`;
}

/** { runId, boardId, deviceId } for a genuine token, else null. */
export function verifyStartToken(token) {
  if (typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const body = token.slice(0, i);
  if (!safeEqual(token.slice(i + 1), mac(`tok:${body}`))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!Number.isInteger(p.r) || !Number.isInteger(p.b) || typeof p.d !== 'string') return null;
    return { runId: p.r, boardId: p.b, deviceId: p.d };
  } catch { return null; }
}

// ---- start -----------------------------------------------------------------

const nowSql = (sql, now) => (now == null ? sql`now()` : sql`${now}::timestamptz`);

/**
 * START a guest run: claim the device's one play of this board and stamp the
 * clock. Idempotent - a reload resumes the FIRST start's clock.
 *
 * @returns { ok, run, closesAt, resumed, submitted } | { ok:false, reason, status }
 */
export async function startGuestRun(sql, { boardId, deviceId, ip = null, now = null }) {
  if (!deviceId) return { ok: false, reason: 'no device', status: 400 };
  const [board] = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
  if (!board) return { ok: false, reason: 'no such board', status: 404 };
  const [{ closed }] = await sql`SELECT ${nowSql(sql, now)} >= ${board.closes_at}::timestamptz AS closed`;
  if (closed) return { ok: false, reason: 'board closed', status: 409 };

  const [existing] = await sql`SELECT * FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${deviceId}`;
  if (existing) {
    return { ok: true, run: existing, closesAt: board.closes_at, resumed: true, submitted: existing.picks != null };
  }

  // THE IP CAP counts rows this IP created in the window - only NEW plays, so a
  // reload never spends it. No IP (local dev, a script) skips the cap.
  if (ip) {
    const since = new Date((now == null ? Date.now() : new Date(now).getTime()) - GUEST_START_PER_IP.windowMs).toISOString();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM daily_guest_runs WHERE ip = ${ip} AND started_at > ${since}::timestamptz`;
    if (n >= GUEST_START_PER_IP.max) return { ok: false, reason: 'rate limited', status: 429 };
  }

  await sql`
    INSERT INTO daily_guest_runs (board_id, device_id, ip, started_at, claim_expires_at)
    VALUES (${boardId}, ${deviceId}, ${ip}, ${nowSql(sql, now)},
            ((${board.edition_date}::date + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'))
    ON CONFLICT (board_id, device_id) DO NOTHING`;
  const [run] = await sql`SELECT * FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${deviceId}`;
  if (!run) return { ok: false, reason: 'start failed', status: 500 };
  return { ok: true, run, closesAt: board.closes_at, resumed: false, submitted: run.picks != null };
}

// ---- submit ----------------------------------------------------------------

/**
 * Grade and store a guest run. The same refusals, in the same order, as
 * submitRun (lib/daily/seasonBoardRuns.js): closed, never started, already ran,
 * time expired, shape, nothing picked - and the same `AND picks IS NULL`
 * UPDATE so two tabs cannot both land.
 */
export async function submitGuestRun(sql, { runId, boardId, deviceId, picks, now = null }) {
  const [board] = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
  if (!board) return { ok: false, reason: 'no such board', status: 404 };
  const [{ closed }] = await sql`SELECT ${nowSql(sql, now)} >= ${board.closes_at}::timestamptz AS closed`;
  if (closed) return { ok: false, reason: 'board closed', status: 409 };

  const [pre] = await sql`
    SELECT picks IS NOT NULL AS submitted,
           extract(epoch FROM (${nowSql(sql, now)} - started_at))::float AS elapsed
      FROM daily_guest_runs WHERE id = ${runId} AND board_id = ${boardId} AND device_id = ${deviceId}`;
  if (!pre) return { ok: false, reason: 'never started', status: 409 };
  if (pre.submitted) return { ok: false, reason: 'already ran this board', status: 409 };
  const serverElapsed = Number(pre.elapsed ?? 0);
  if (serverElapsed > DAILY_ROUND_SECONDS + DAILY_ROUND_GRACE_SECONDS) {
    return { ok: false, reason: 'time expired', status: 409 };
  }
  const elapsedS = Math.min(DAILY_ROUND_SECONDS, Math.max(0, Math.round(serverElapsed)));

  const regraded = regradeStoredRun(board, picks, slotsOf(board));
  if (!regraded.ok) return { ok: false, reason: regraded.reason, status: 400 };
  const { grade, play } = regraded;
  if (!play.roster.some((r) => r.pick != null)) return { ok: false, reason: 'nothing picked', status: 409 };

  const updated = await sql`
    UPDATE daily_guest_runs
       SET picks = ${JSON.stringify(picks)}::jsonb,
           score = ${grade.mine},
           pct = ${board.ceiling > 0 ? grade.mine / Number(board.ceiling) : 1},
           matched = ${grade.matchedCount},
           elapsed_s = ${elapsedS},
           completed_at = ${nowSql(sql, now)}
     WHERE id = ${runId} AND board_id = ${boardId} AND device_id = ${deviceId} AND picks IS NULL
     RETURNING *`;
  if (updated.length) return { ok: true, run: updated[0], grade, board };
  return { ok: false, reason: 'already ran this board', status: 409 };
}

// ---- read ------------------------------------------------------------------

export async function guestRunFor(sql, { boardId, deviceId }) {
  if (!deviceId) return null;
  const [row] = await sql`SELECT * FROM daily_guest_runs WHERE board_id = ${boardId} AND device_id = ${deviceId}`;
  return row ?? null;
}

/**
 * THE OPEN-DAY REVEAL FOR A GUEST: their own eight slots and total, and "you
 * beat X%" against the FINISHED REAL RUNS - the guest is added to the
 * denominator for their own line only (beatPct's contract) and is in nobody
 * else's. No rank, no streak, no "you" row on the board.
 */
export async function guestRevealFor(sql, { board, run }) {
  const graded = regradeStoredRun(board, run.picks, slotsOf(board));
  const rows = graded.ok ? ownRows(graded.grade) : [];
  const boardRows = openBoardRows(await todayLeaderboard(sql, board.id));
  const mine = Math.round(Number(run.score) * 10) / 10;
  const view = boardView(boardRows, null, { top: 10 });
  return {
    rows, total: mine, rank: null, of: boardRows.length,
    beatPct: beatPct([...boardRows.map((r) => r.points), mine], mine),
    streak: null,
    board: { head: view.head, around: [], gap: false, me: null },
    guest: { claimExpiresAt: new Date(run.claim_expires_at).toISOString() },
  };
}

// ---- claim -----------------------------------------------------------------

/**
 * CLAIM every finished, unexpired, unclaimed guest run on this device for
 * `userId`. ONE STATEMENT: the UPDATE that marks a guest row claimed and the
 * INSERT that gives the account its run are one CTE, so they land together or
 * not at all, and two concurrent claims cannot both win (the row lock on the
 * UPDATE; the loser matches nothing).
 *
 * A run is claimable only while ALL hold: it finished (picks NOT NULL), nobody
 * has claimed it, it has not expired (claim_expires_at > now), and the account
 * has no run of its own on that board (one attempt per account per day - the
 * guest run stays unclaimed, never overwriting or merging).
 *
 * LATE CLAIMS (ruling tue-3): a claim made after the board's ET close still saves
 * the run to the account - the entry and the streak - but marks it late_claim
 * (migration 131), and every board-scoped read skips those. ONE CLAIM PER
 * ACCOUNT PER ET DAY (ruling tue-3): the second is refused, whatever device it
 * comes from.
 *
 * @returns { ok, claimed: [{ boardId, score, late }], reason }  reason is set
 *   when nothing was claimed: 'nothing to claim' | 'expired' | 'already
 *   claimed' | 'account already played' | 'one claim per day'
 */
export async function claimGuestRuns(sql, { deviceId, userId, now = null }) {
  if (!deviceId || userId == null) return { ok: false, claimed: [], reason: 'nothing to claim' };
  const day = sql`((${nowSql(sql, now)}) AT TIME ZONE 'America/New_York')::date`;
  let rows;
  try {
    // `pick` chooses ONE run - the newest edition that is claimable - because an
    // account claims at most one Daily per ET day (uq_daily_guest_runs_claim_day
    // is the backstop for a race). `late` is decided here, against Postgres's
    // clock: a claim at or after the board's ET close is saved to the account
    // but flagged late_claim, so no board field or board count ever sees it.
    rows = await sql`
      WITH pick AS (
        SELECT gr.id, ${nowSql(sql, now)} >= b.closes_at AS late
          FROM daily_guest_runs gr JOIN daily_boards b ON b.id = gr.board_id
         WHERE gr.device_id = ${deviceId}
           AND gr.claimed_by IS NULL
           AND gr.picks IS NOT NULL
           AND gr.claim_expires_at > ${nowSql(sql, now)}
           AND NOT EXISTS (SELECT 1 FROM daily_board_runs r WHERE r.board_id = gr.board_id AND r.user_id = ${userId})
           AND NOT EXISTS (SELECT 1 FROM daily_guest_runs c WHERE c.claimed_by = ${userId} AND c.claimed_day = ${day})
         ORDER BY b.edition_date DESC
         LIMIT 1
      ),
      g AS (
        UPDATE daily_guest_runs gr
           SET claimed_by = ${userId}, claimed_at = ${nowSql(sql, now)}, claimed_day = ${day}
          FROM pick
         WHERE gr.id = pick.id AND gr.claimed_by IS NULL
        RETURNING gr.*, pick.late
      )
      INSERT INTO daily_board_runs (board_id, user_id, started_at, picks, score, pct, matched, elapsed_s, completed_at, late_claim)
      SELECT board_id, ${userId}, started_at, picks, score, pct, matched, elapsed_s, completed_at, late FROM g
      RETURNING board_id, score, late_claim`;
  } catch (err) {
    // The unique index: another claim by this account landed on this ET day first.
    if (err?.code === '23505') return { ok: false, claimed: [], reason: 'one claim per day' };
    throw err;
  }
  if (rows.length) {
    return {
      ok: true, reason: null,
      claimed: rows.map((r) => ({ boardId: r.board_id, score: Number(r.score), late: r.late_claim === true })),
    };
  }

  const left = await sql`
    SELECT gr.claimed_by, gr.picks IS NOT NULL AS finished,
           gr.claim_expires_at <= ${nowSql(sql, now)} AS expired,
           EXISTS (SELECT 1 FROM daily_board_runs r WHERE r.board_id = gr.board_id AND r.user_id = ${userId}) AS account_has_run,
           EXISTS (SELECT 1 FROM daily_guest_runs c WHERE c.claimed_by = ${userId} AND c.claimed_day = ${day}) AS day_used
      FROM daily_guest_runs gr WHERE gr.device_id = ${deviceId}
     ORDER BY gr.started_at DESC`;
  let reason = 'nothing to claim';
  const claimableButForDay = left.some((l) => l.claimed_by == null && l.finished && !l.expired && !l.account_has_run && l.day_used);
  const l = left[0];
  if (claimableButForDay) reason = 'one claim per day';
  else if (l) {
    if (l.claimed_by != null) reason = 'already claimed';
    else if (l.finished && l.expired) reason = 'expired';
    else if (l.finished && l.account_has_run) reason = 'account already played';
  }
  return { ok: false, claimed: [], reason };
}

/**
 * THE BACKSTOP FOR A SIGNED-IN START. A device that already used its guest play
 * of this board must not get a second attempt by signing in and pressing Start:
 * it has seen the cards. Returns the guest row when it blocks (the device holds
 * a guest run for this board, the account has no run of its own there), else
 * null. A finished, claimable run is claimed first (claimGuestRuns) - the page
 * does that on load; this is for a client that never loaded it.
 *
 * @returns { claimed:true } | { blocked:true, run } | null
 */
export async function guestBlocksStart(sql, { boardId, deviceId, userId, now = null }) {
  if (!deviceId || userId == null) return null;
  const [mine] = await sql`SELECT 1 FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId}`;
  if (mine) return null;
  const run = await guestRunFor(sql, { boardId, deviceId });
  if (!run) return null;
  if (run.claimed_by != null && Number(run.claimed_by) === Number(userId)) return null;
  const c = await claimGuestRuns(sql, { deviceId, userId, now });
  if (c.ok && c.claimed.some((x) => x.boardId === boardId)) return { claimed: true };
  return { blocked: true, run };
}
