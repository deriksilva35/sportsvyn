// lib/daily/morningPush.js - "Yesterday's picks are out - see how you did."
//
// ONE PUSH PER PLAYER PER BOARD, AT 9:00 AM IN THE PLAYER'S ZONE (relay
// mon-12). Fired from the droplet's five-minute daily tick
// (lib/daily/seasonBoardTick.js -> services/daily-tick), beside daily-live
// and daily-revealed, and through the same send-once ledger every push uses
// (lib/push/notify.js notifyPersonalized: the claim row in sync_runs is
// written BEFORE the send).
//
// THE WAVE IS (BOARD, ZONE). Everyone who played edition D in zone Z reaches
// 9:00 at the same instant, so they are one send with one claim:
// 'daily-morning:<D>:<Z>'. A player's zone is stamped on THEIR RUN at start
// (migration 129, from the sv_tz cookie) and never moves, so each player is
// in exactly one wave per board - that is the once-per-user guarantee, and the
// claim is what makes a wave once. A run with no zone (before 129, or a start
// without the cookie) belongs to the ET wave: the Daily's own zone.
//
// 9:00 AM, BUT NEVER BEFORE THE ANSWER. The board closes at midnight ET; in
// zones east of ET that is already morning (Tokyo: 13:00), so the push is due
// at the FIRST 9:00 local at or after closes_at - the next morning there.
//
// LATE IS SKIPPED, NOT SENT. A wave is due for MORNING_WINDOW_HOURS after its
// 9:00. A tick that was down all morning does not send "yesterday's picks"
// at teatime; that wave is simply missed. Boards older than two days are not
// even read.
//
// THE TIME ARITHMETIC IS HERE, IN JS, AND PURE (Intl, DST-aware): a test can
// drive any instant in any zone with no database.

import { notifyPersonalized } from '../push/notify.js';
import { safeTz } from '../gridiron/viewerTz.js';

export const MORNING_HOUR = 9;
export const MORNING_WINDOW_HOURS = 3;
export const FALLBACK_TZ = 'America/New_York';
export const MORNING_PREFIX = 'daily-morning';

export const morningEventId = (edition, tz) => `${MORNING_PREFIX}:${edition}:${tz}`;

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

/** The zone's wall clock at a UTC instant, as { y, m, d, h, mi, s }. */
function wall(ms, tz) {
  const p = Object.fromEntries(partsFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Minutes the zone is ahead of UTC at a UTC instant (New York in October: -240). */
export function zoneOffsetMinutes(ms, tz) {
  const w = wall(ms, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** 'YYYY-MM-DD' as the zone's calendar reads it at a UTC instant. */
export function localYmd(ms, tz) {
  const w = wall(ms, tz);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** The UTC instant of `hour`:00 local on `ymd` in `tz`. DST-correct either side of a change. */
export function localToUtc(ymd, hour, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const off1 = zoneOffsetMinutes(guess, tz);
  let t = guess - off1 * 60000;
  const off2 = zoneOffsetMinutes(t, tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}

const nextYmd = (ymd) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** The zone a run is pushed in: its own, when it is a real zone, else ET. */
export const zoneOf = (tz) => safeTz(tz) ?? FALLBACK_TZ;

/** The first MORNING_HOUR:00 in `tz` at or after the board's close. */
export function morningDueAt(closesAt, tz) {
  const zone = zoneOf(tz);
  const closeMs = new Date(closesAt).getTime();
  const sameDay = localToUtc(localYmd(closeMs, zone), MORNING_HOUR, zone);
  if (sameDay.getTime() >= closeMs) return sameDay;
  return localToUtc(nextYmd(localYmd(closeMs, zone)), MORNING_HOUR, zone);
}

/** Due from 9:00 local for MORNING_WINDOW_HOURS; before, not yet; after, missed. */
export function isMorningDue(now, closesAt, tz) {
  const t = new Date(now).getTime();
  const due = morningDueAt(closesAt, tz).getTime();
  return t >= due && t < due + MORNING_WINDOW_HOURS * 3600_000;
}

/**
 * PURE. Candidate rows -> the waves due at `now`.
 * @param rows [{ edition, closesAt, userId, tz }] - one per submitted run
 * @returns [{ eventId, edition, tz, dueAt, userIds }]
 */
export function planMorningWaves(rows, now) {
  const waves = new Map();
  for (const r of rows) {
    const tz = zoneOf(r.tz);
    if (!isMorningDue(now, r.closesAt, tz)) continue;
    const eventId = morningEventId(r.edition, tz);
    if (!waves.has(eventId)) {
      waves.set(eventId, { eventId, edition: r.edition, tz, dueAt: morningDueAt(r.closesAt, tz).toISOString(), userIds: [] });
    }
    const w = waves.get(eventId);
    if (!w.userIds.includes(Number(r.userId))) w.userIds.push(Number(r.userId));
  }
  return [...waves.values()];
}

/** Does daily_board_runs have migration 129's column yet? Before it, every run is ET. */
async function hasRunTz(sql) {
  const [r] = await sql`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'daily_board_runs' AND column_name = 'tz') AS has`;
  return r?.has === true;
}

/**
 * Every submitted run on a board that closed in the last two days, minus any
 * player who has switched every alert off (the v2 audience rule,
 * lib/push/notify.js liveDeviceTokens({ excludeMasterOff })).
 */
export async function morningCandidates(sql, now) {
  const tzCol = (await hasRunTz(sql)) ? sql`r.tz` : sql`NULL::text`;
  const rows = await sql`
    SELECT to_char(b.edition_date, 'YYYY-MM-DD') AS edition, b.closes_at, r.user_id, ${tzCol} AS tz
      FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
     WHERE r.picks IS NOT NULL AND NOT r.late_claim
       AND b.closes_at <= ${now}::timestamptz
       AND b.closes_at > ${now}::timestamptz - interval '2 days'
       AND (
         NOT EXISTS (SELECT 1 FROM alert_prefs ap WHERE ap.user_id = r.user_id)
         OR EXISTS (SELECT 1 FROM alert_prefs ap WHERE ap.user_id = r.user_id AND ap.master = true)
       )`;
  return rows.map((r) => ({ edition: r.edition, closesAt: r.closes_at, userId: r.user_id, tz: r.tz }));
}

/**
 * One tick's worth. A wave whose event id is already in the ledger is not
 * called again - notifyPersonalized's own claim would refuse it anyway, but
 * this keeps a sent wave from becoming a call at all (the tick's NOT EXISTS
 * discipline for daily-live/daily-revealed).
 *
 * @param notify injectable (default notifyPersonalized) so a test can spy.
 * @returns [{ eventId, recipients, result }]
 */
export async function morningPush(sql, nowUtc, { notify = notifyPersonalized } = {}) {
  const now = nowUtc instanceof Date ? nowUtc.toISOString() : nowUtc;
  const waves = planMorningWaves(await morningCandidates(sql, now), now);
  if (!waves.length) return [];
  const ids = waves.map((w) => w.eventId);
  const claimed = new Set((await sql`
    SELECT DISTINCT summary->>'eventId' AS id FROM sync_runs
     WHERE source = 'push' AND summary->>'eventId' = ANY(${ids})`).map((r) => r.id));
  const out = [];
  for (const w of waves) {
    if (claimed.has(w.eventId)) continue;
    const recipients = w.userIds.map((userId) => ({ userId, params: {} }));
    out.push({ eventId: w.eventId, recipients: recipients.length, result: await notify(w.eventId, recipients) });
  }
  return out;
}

/**
 * Stamp the reader's zone on their run, once (POST /api/daily/board/start).
 * BEST-EFFORT: before migration 129 the column is missing and this returns
 * false rather than failing a start.
 */
export async function stampRunTz(sql, { boardId, userId, tz }) {
  const zone = safeTz(tz);
  if (!zone) return false;
  try {
    const r = await sql`
      UPDATE daily_board_runs SET tz = ${zone}
       WHERE board_id = ${boardId} AND user_id = ${userId} AND tz IS NULL
      RETURNING id`;
    return r.length > 0;
  } catch {
    return false;
  }
}
