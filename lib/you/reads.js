// lib/you/reads.js - everything the You tab reads.
//
// YOU IS THE RECORD, TODAY IS THE DAY (R1). Nothing here reads a live game
// state; a rank is the only thing on this tab that moves during a slate, and
// it moves because a board settled, not because a ball was snapped.
//
// WHAT THE RECON FOUND, AND WHAT THE RULINGS DID WITH IT:
//   There is NO timezone column on users. The zone is the sv_tz cookie, per
//   device, which is why the tab says "from this device" (R6).
//   There is NO board-reminder preference anywhere - not a column, not an
//   alert_prefs scope, and the scope CHECK allows only 'team' and 'match'.
//   The row is CUT rather than shipped saying "not set up yet" (Q2).
//   There is no price anywhere in the app, so membership shows the
//   entitlement and the renewal date and no number (Q4).
//   The season readers fill `self` only when the caller is OFF the visible
//   top. That is a leaderboard rule, not a profile rule, so this module
//   fills the row from `top` when they are in it (R7).

import { sql } from '../db.js';
import { getFollowedTeams, FOLLOW_CAP_PER_LEAGUE } from '../follows.js';
import { streakLeaderboard } from '../daily/seasonBoardLeaderboards.js';
import { youCellV2 } from '../daily/seasonBoardResults.js';
import { pickemTable, gameSeasonTable, PICKEM_TABLE_MIN_BOARDS, SEASON_TABLE_MIN_WEEKS } from '../games/read.js';
import { getMembership } from '../membership.js';
import { isMember } from '../fantasy/drafts.js';

const empty = (v) => (p) => Promise.resolve(p).catch(() => v);

/** Today in ET - the day the dots are counted back from. */
export function etToday(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}`;
}
export function shiftDay(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return t.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ identity

/**
 * WHO YOU ARE. handle, created_at and handle_changed_at are real columns;
 * the ZONE IS NOT - it comes from the sv_tz cookie the caller passes in,
 * which is per device and is labelled as such.
 */
export async function identity(userId, { tz = null } = {}) {
  if (userId == null) return null;
  const [u] = await sql`
    SELECT id, handle, email, created_at, handle_changed_at
      FROM users WHERE id = ${Number(userId)} LIMIT 1`;
  if (!u) return null;
  // MEMBER SINCE IS OFTEN UNKNOWN, and the tab says nothing rather than
  // guessing. users.created_at arrived in migration 058 with DEFAULT now()
  // and the rows that predate it were never backfilled - 14 accounts on PROD
  // carry null, user 1 among them. A "Member since" line invented from a
  // first sign-in or a first entry would be a date the reader could disprove.
  const since = u.created_at
    ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(u.created_at))
    : null;
  return {
    handle: u.handle ?? null,
    display: u.handle ? `@${u.handle}` : (u.email ?? '').split('@')[0] || 'You',
    initial: (u.handle ?? u.email ?? '?').trim().charAt(0).toUpperCase(),
    since,
    // A zone the reader can recognise: "Pacific", not "America/Los_Angeles".
    zone: tz ? zoneLabel(tz) : null,
    handleChanged: Boolean(u.handle_changed_at),
    // MASKED, ALWAYS. The email belongs on this page as a fact the reader
    // can check, not as a string to be copied off a shoulder.
    emailMasked: maskEmail(u.email),
  };
}

export function maskEmail(e) {
  const s = String(e ?? '');
  const at = s.indexOf('@');
  if (at < 1) return null;
  return `${s[0]}***${s.slice(at)}`;
}
export function zoneLabel(tz) {
  try {
    const n = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? tz;
    return n.replace(/ (Standard|Daylight) Time$/, '');
  } catch { return tz; }
}

// -------------------------------------------------------------- daily record

/**
 * THE STREAK STRIP AND THE DOTS, from ONE read.
 *
 * The recon found three leaderboards - streak, best, played - each of which
 * you would have to SCAN for your own row to fill one box. Three scans of
 * three whole tables to print three numbers is the wrong shape; this is one
 * per-user aggregate over the caller's own runs.
 *
 * THE THREE DOT STATES ARE IN THE DATA, and `picks` is the discriminator -
 * not completed_at. Migration 097 says so outright: "picks IS THE
 * SUBMITTED-OR-NOT DISCRIMINATOR. After this migration 'started' is picks IS
 * NULL and 'submitted' is picks IS NOT NULL." The two happen to agree on
 * every row on PROD today, which is exactly why the wrong one would have sat
 * there unnoticed.
 *   played   a run with picks set          (youCellV2 -> played: true)
 *   dnf      a run with picks null         (youCellV2 -> dnf: true)
 *   unplayed no run for that edition date  (youCellV2 -> played: false)
 * Keyed on daily_boards.edition_date, which is the ET calendar day - NOT the
 * run's timestamp, which is whenever the reader happened to sit down.
 */
export async function dailyRecord(userId, { now = new Date(), days = 14 } = {}) {
  if (userId == null) return null;
  const today = etToday(now);
  const from = shiftDay(today, -(days - 1));
  const [runs, agg] = await Promise.all([
    sql`SELECT to_char(b.edition_date, 'YYYY-MM-DD') AS day,
               r.picks, r.started_at, r.completed_at, r.score
          FROM daily_board_runs r
          JOIN daily_boards b ON b.id = r.board_id
         WHERE r.user_id = ${Number(userId)}
           AND b.edition_date >= ${from}::date AND b.edition_date <= ${today}::date
         ORDER BY b.edition_date ASC`.catch(() => []),
    sql`SELECT count(*) FILTER (WHERE r.picks IS NOT NULL)::int AS played,
               max(r.score)::numeric AS best
          FROM daily_board_runs r WHERE r.user_id = ${Number(userId)}`.catch(() => [{}]),
  ]);
  const byDay = new Map(runs.map((r) => [r.day, r]));
  const dots = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = shiftDay(today, -i);
    const r = byDay.get(day) ?? null;
    dots.push({
      day,
      letter: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'narrow' }).format(new Date(`${day}T12:00:00Z`)),
      // youCellV2 is the pure classifier this shares with History; the dot
      // asks it rather than re-deciding what a DNF is.
      state: r == null ? 'unplayed' : (youCellV2(r, null).played ? 'played' : 'dnf'),
    });
  }
  return {
    dots,
    days,
    dnf: dots.filter((d) => d.state === 'dnf').length,
    playedInWindow: dots.filter((d) => d.state === 'played').length,
    boards: agg[0]?.played ?? 0,
    best: agg[0]?.best == null ? null : Number(agg[0].best),
    ...(await streaks(userId, today)),
  };
}

/**
 * CURRENT AND BEST STREAK, counted over COMPLETED runs by edition date.
 *
 * A DNF BREAKS A STREAK. Starting a board and walking away is not playing it,
 * and a streak that survived that would be a number the reader knows is a
 * lie. Today not yet played does NOT break it - the day is not over.
 */
async function streaks(userId, today) {
  const rows = await sql`
    SELECT to_char(b.edition_date, 'YYYY-MM-DD') AS day
      FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
     WHERE r.user_id = ${Number(userId)} AND r.picks IS NOT NULL
     ORDER BY b.edition_date ASC`.catch(() => []);
  const played = new Set(rows.map((r) => r.day));
  let best = 0; let run = 0; let prev = null;
  for (const r of rows) {
    run = prev && r.day === shiftDay(prev, 1) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = r.day;
  }
  // The current streak walks back from today, or from yesterday when today
  // has not been played yet.
  let cur = 0;
  let cursor = played.has(today) ? today : shiftDay(today, -1);
  while (played.has(cursor)) { cur += 1; cursor = shiftDay(cursor, -1); }
  return { streak: cur, bestStreak: best };
}

// -------------------------------------------------------------- your season

const rowFor = (table, uid) => {
  if (!table) return null;
  // R7: the reader fills `self` only when the caller is OFF the visible top.
  // That is a leaderboard rule; a profile shows your row either way.
  return table.self ?? (table.top ?? []).find((r) => r.userId === uid) ?? null;
};

export async function yourSeason(userId, { now = new Date() } = {}) {
  if (userId == null) return [];
  const [daily, pickem, weekly, draft] = await Promise.all([
    empty([])(streakLeaderboard(sql, etToday(now))),
    empty(null)(pickemTable(userId, { limit: 10 })),
    empty(null)(gameSeasonTable('weekly', userId, { limit: 10 })),
    empty(null)(gameSeasonTable('draft', userId, { limit: 10 })),
  ]);
  const out = [];

  // streakLeaderboard ends WHERE current > 0, so a reader whose streak just
  // broke has NO row and ranks null here. That is the leaderboard's rule and
  // the row below states the absence rather than inventing a rank.
  const mineDaily = (daily ?? []).find((r) => Number(r.userId) === Number(userId)) ?? null;
  out.push({
    key: 'daily', glyph: 'D', title: 'The Daily',
    sub: mineDaily ? `streak ${mineDaily.primary}` : 'no ranked play yet',
    rank: mineDaily ? Number(mineDaily.rank) : null,
    of: (daily ?? []).length || null,
    note: mineDaily ? null : 'play a board to rank',
    href: '/rankings?view=people&game=daily',
  });

  const p = rowFor(pickem, userId);
  out.push({
    key: 'pickem', glyph: 'P', title: "Pick'em",
    sub: p ? `${p.correct}-${p.played - p.correct} · ${p.boardsPlayed} board${p.boardsPlayed === 1 ? '' : 's'}` : 'no settled board yet',
    rank: p?.rank ?? null,
    of: p?.rank != null ? (pickem?.top ?? []).filter((r) => r.rank != null).length || null : null,
    value: p ? `${p.pct}%` : null,
    // The reader already writes the distance as `note` ("1 of 3 boards").
    note: p?.rank == null ? (p?.note ?? `ranks after ${PICKEM_TABLE_MIN_BOARDS}`) : null,
    href: '/rankings?view=people&game=pickem',
  });

  for (const [key, glyph, title, table] of [
    ['weekly', 'W', 'The Weekly', weekly],
    ['draft', '12', 'The Draft', draft],
  ]) {
    const r = rowFor(table, userId);
    out.push({
      key, glyph, title,
      sub: r ? `${r.weeksPlayed ?? r.played ?? 0} week${(r.weeksPlayed ?? r.played ?? 0) === 1 ? '' : 's'} played` : 'nothing settled yet',
      rank: r?.rank ?? null,
      of: r?.rank != null ? (table?.top ?? []).filter((x) => x.rank != null).length || null : null,
      note: r?.rank == null ? (r?.note ?? `ranks after ${SEASON_TABLE_MIN_WEEKS}`) : null,
      href: `/rankings?view=people&game=${key}`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ follows

/** The list, plus the per-league counts the add control names (R4). */
// The reader's own words for a league, so a cap line reads "World Cup" and
// not "FIFA-WC-2026".
const LEAGUE_WORD = Object.freeze({
  nfl: 'NFL', cfb: 'CFB', epl: 'Premier League', 'fifa-wc-2026': 'World Cup',
});
export const leagueWord = (slug, fallback = null) => LEAGUE_WORD[slug] ?? fallback ?? String(slug ?? '').toUpperCase();

export async function follows(userId) {
  const teams = userId == null ? [] : await empty([])(getFollowedTeams(userId));
  const by = new Map();
  for (const t of teams) {
    const k = t.leagueSlug ?? 'other';
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return {
    teams,
    cap: FOLLOW_CAP_PER_LEAGUE,
    counts: [...by.entries()].map(([league, n]) => ({ league, label: leagueWord(league), n })),
    // "2 of 5 NFL, 1 of 5 CFB" - stated on the control so a sixth follow is
    // never a surprise refusal.
    capLine: [...by.entries()]
      .map(([league, n]) => `${n} of ${FOLLOW_CAP_PER_LEAGUE} ${leagueWord(league)}`)
      .join(', ') || null,
  };
}

// ------------------------------------------------------------------- alerts

const TRIGGERS = [['kickoff', 'kickoff'], ['score', 'score'], ['quarter', 'quarter'], ['close', 'close game'], ['final_only', 'final']];

/**
 * READ AND LINK ONLY (R3). Nothing here writes; each row states what is true
 * and points at the surface that changes it.
 *
 * THE BOARD-REMINDER ROW IS NOT HERE. No column, no scope, nothing to read -
 * and a row that says "not set up yet" is a promise in the UI with nothing
 * behind it (Q2).
 */
export async function alerts(userId) {
  if (userId == null) return null;
  const [[u], devices, prefs] = await Promise.all([
    sql`SELECT push_choice, email_opted_out_at FROM users WHERE id = ${Number(userId)}`.catch(() => [{}]),
    sql`SELECT platform, permission FROM device_tokens
         WHERE user_id = ${Number(userId)} AND revoked_at IS NULL`.catch(() => []),
    sql`SELECT master, kickoff, score, quarter, close, final_only
          FROM alert_prefs WHERE user_id = ${Number(userId)} AND scope = 'match'`.catch(() => []),
  ]);
  const on = prefs.filter((p) => p.master);
  // What they send, said once across every subscription rather than per game.
  const sends = TRIGGERS.filter(([k]) => on.some((p) => p[k])).map(([, label]) => label);
  return {
    push: {
      choice: u?.push_choice ?? null,
      on: u?.push_choice === 'enabled' && devices.length > 0,
      devices: devices.length,
      // "this iPhone" when there is one, a count when there are several.
      where: devices.length === 1 ? (devices[0].platform ?? 'this device') : `${devices.length} devices`,
    },
    games: { count: on.length, sends, sendLine: sends.length ? sends.join(', ') : null },
    email: { optedOut: Boolean(u?.email_opted_out_at) },
  };
}

// --------------------------------------------------------------- membership

/**
 * Entitlement and the date it runs to. No price (Q4).
 *
 * A PASS DOES NOT RENEW, AND THE WORD MATTERS. memberships.kind is
 * 'subscription' or 'pass'; a subscription's date is current_period_end and
 * it RENEWS, a pass's is expires_at and it RUNS THROUGH. User 1 holds a pass
 * with a null current_period_end, so reading only that column would have
 * printed a member with no date at all.
 */
export async function membership(userId) {
  if (userId == null) return null;
  const [member, m] = await Promise.all([
    empty(false)(isMember(userId)), empty(null)(getMembership(userId)),
  ]);
  const isPass = m?.kind === 'pass';
  const raw = isPass ? m?.expires_at : m?.current_period_end;
  const end = raw ? new Date(raw) : null;
  const ok = end && !Number.isNaN(end.getTime());
  return {
    member: Boolean(member),
    kind: m?.kind ?? null,
    verb: isPass ? 'Through' : 'Renews',
    date: ok ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(end) : null,
  };
}

// --------------------------------------------------------------------------

export async function youView({ userId = null, tz = null, now = new Date() } = {}) {
  if (userId == null) return { signedIn: false };
  const [me, daily, season, fol, al, mem] = await Promise.all([
    empty(null)(identity(userId, { tz })),
    empty(null)(dailyRecord(userId, { now })),
    empty([])(yourSeason(userId, { now })),
    empty({ teams: [], counts: [], capLine: null, cap: FOLLOW_CAP_PER_LEAGUE })(follows(userId)),
    empty(null)(alerts(userId)),
    empty(null)(membership(userId)),
  ]);
  return { signedIn: true, me, daily, season, follows: fol, alerts: al, membership: mem };
}
