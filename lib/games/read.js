// lib/games/read.js - everything /games needs, in one place.
//
// THE STANDINGS LAW APPLIES TO EVERY NUMBER ON THIS PAGE, and this file is
// where that is enforced. /games aggregates four games at once, which makes it
// the likeliest place for an open-day result to leak. Every figure here comes
// from a REVEALED day or a SETTLED contest, with one exception: the viewer's
// own state in the game they are playing, which is theirs to know.
//
// CARD STATE IS DATA, NOT A DEPLOY. Pick'em is ghosted because no pickem
// contest exists, not because a date says so. When one is created the card
// goes live on the next request. That is what lets Aug 25 and Sep 8 happen
// without a release.

import { sql } from '../db.js';
import { getDailyHome, getYesterday, todayEntrantCount } from '../daily/entries.js';
import { overall } from '../daily/boards.js';
import { editionLabel, editionNo } from '../daily/homeModule.js';
import { displayName } from '../daily/handles.js';
import { cardState, seasonStrip, boardSection, GAME_ORDER, GAME_META, GAME_NAMES, HERO_TAGLINE, HERO_CTA, GAME_GLYPHS } from './lobby.js';
import { currentContest, getWeeklyHome, nextContest } from '../weekly/entries.js';
import { weeklyBoardTable } from '../weekly/live.js';
import { getDraftHome } from '../draft/entry.js';
import { DRAFT_CONFIG, DRAFT_ROUNDS, nextDraftContest } from '../draft/contest.js';
import { youCell, yourStats } from './personal.js';

// MINIMUM BOARDS TO RANK ON THE PICK'EM SEASON TABLE. A user with one lucky
// board and nobody else's sample size would sit at 100% forever - the same
// small-sample problem every "season leaderboard" has. Below this, a row
// still shows (so nobody vanishes for playing), just with a dash instead of
// a rank and a note naming how many boards stand between them and one.
export const PICKEM_TABLE_MIN_BOARDS = 3;

// MINIMUM WEEKS TO RANK ON THE WEEKLY/DRAFT SEASON TABLES (relay 2a item 5) -
// same small-sample reasoning, same number, as PICKEM_TABLE_MIN_BOARDS.
export const SEASON_TABLE_MIN_WEEKS = 3;
import { pickemCardData } from '../pickem/entry.js';
import { lockLabel } from '../pickem/read.js';
import { boardPlan } from '../pickem/create.js';

/** Does a game have a live contest right now? One query for all of them. */
async function liveContests({ now = new Date() } = {}) {
  // CAUGHT, and the failure direction is the point. A contest read that fails -
  // including before migration 067 has reached an environment - reads as "no
  // game is live", which ghosts the cards. That is the same safe direction the
  // header's membership read takes, and it happens to be exactly the correct
  // pre-launch rendering. It must never take the lobby down.
  const rows = await (async () => sql`
    SELECT game_type, id, season_year, week, opens_at, locks_at, settled
      FROM contests
     WHERE opens_at <= ${now.toISOString()} AND NOT settled
     ORDER BY opens_at DESC`)().catch(() => []);
  const by = new Map();
  for (const r of rows) if (!by.has(r.game_type)) by.set(r.game_type, r);
  return by;
}

/**
 * The Daily's streak: consecutive REVEALED days ending at the most recent one
 * in which the reader locked an entry. Revealed-only, so today can never
 * extend or break it on the page - it moves at midnight with everything else.
 */
async function dailyStreak(userId) {
  if (userId == null) return 0;
  const rows = await sql`
    SELECT to_char(d.puzzle_date, 'YYYY-MM-DD') AS d,
           (e.id IS NOT NULL AND e.locked_at IS NOT NULL) AS played
      FROM puzzle_days d
      LEFT JOIN puzzle_entries e ON e.puzzle_date = d.puzzle_date AND e.user_id = ${userId}
     WHERE d.revealed ORDER BY d.puzzle_date DESC`;
  let n = 0;
  for (const r of rows) { if (!r.played) break; n += 1; }
  return n;
}

/**
 * The Pick'em season table: correct picks and games played across every
 * SETTLED pickem contest, per user. Shape matches weeklyBoardTable's
 * ({top, self, through}) so BoardsPane renders it the same way.
 *
 * A GAME WITH NO RESULT (perfect.results[matchId] === null - a tie, "impossible
 * in CFB, defended anyway" per lib/pickem/settle.js, or a cancelled game a
 * human resolved by nulling its entry) counts toward NEITHER a user's correct
 * picks NOR their games played - it is off the board entirely for this table,
 * not a miss. Everyone else's pick on that same game is unaffected.
 *
 * MINIMUM PICKEM_TABLE_MIN_BOARDS DISTINCT SETTLED BOARDS TO RANK. A user
 * below it still gets a row (ordered the same way as everyone else, by
 * correct % desc then correct desc) - just a dash instead of a number and a
 * note naming how many boards stand between them and a rank, so a new player
 * is never simply erased from a table they are genuinely on.
 */
export async function pickemTable(uid = null, { limit = 10 } = {}) {
  const contests = await sql`
    SELECT id, perfect FROM contests WHERE game_type = 'pickem' AND settled`;
  if (!contests.length) return null;

  const contestIds = contests.map((c) => c.id);
  const entries = await sql`
    SELECT e.contest_id, e.user_id, e.lineup, u.handle
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ANY(${contestIds})`;

  const resultsByContest = new Map(contests.map((c) => [c.id, c.perfect?.results ?? {}]));
  const byUser = new Map(); // userId -> { handle, correct, played, boardsPlayed }
  for (const e of entries) {
    const results = resultsByContest.get(e.contest_id) ?? {};
    let correct = 0; let played = 0;
    for (const [matchId, side] of Object.entries(e.lineup ?? {})) {
      const result = results[matchId];
      if (result == null) continue; // push/cancelled - off the numerator AND denominator
      played += 1;
      if (side === result) correct += 1;
    }
    if (!played) continue; // an entry that touched no resolved game contributes nothing
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, { handle: e.handle, correct: 0, played: 0, boardsPlayed: 0 });
    const u = byUser.get(e.user_id);
    u.correct += correct; u.played += played; u.boardsPlayed += 1;
  }
  if (!byUser.size) return null;

  const rows = [...byUser.entries()]
    .map(([userId, u]) => ({
      userId, name: displayName({ id: userId, handle: u.handle }),
      correct: u.correct, played: u.played, boardsPlayed: u.boardsPlayed,
      pct: u.played ? Math.round((u.correct / u.played) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.pct - a.pct || b.correct - a.correct || a.userId - b.userId);

  let rank = 0;
  const ranked = rows.map((r) => {
    const eligible = r.boardsPlayed >= PICKEM_TABLE_MIN_BOARDS;
    if (eligible) rank += 1;
    return {
      ...r,
      rank: eligible ? rank : null,
      note: eligible ? null : `${r.boardsPlayed} of ${PICKEM_TABLE_MIN_BOARDS} boards`,
    };
  });

  const top = ranked.slice(0, limit);
  const mine = uid == null ? null : ranked.find((r) => r.userId === uid) ?? null;
  return {
    top,
    self: mine && !top.some((r) => r.userId === mine.userId) ? mine : null,
    through: `${contests.length} board${contests.length === 1 ? '' : 's'} settled`,
  };
}

/** The pickem table's populates label - computed from the minimum, never a
 * typed date. Used until enough boards exist for pickemTable() to return
 * rows at all. */
export function pickemTablePopulatesLabel() {
  return `Populates after ${PICKEM_TABLE_MIN_BOARDS} boards`;
}

/**
 * The Weekly/Draft season tables (relay 2a item 5) - avg of the STORED
 * meta.pct (frozen at settle) across every SETTLED entry this user has in
 * that game, minimum SEASON_TABLE_MIN_WEEKS weeks to rank. Same
 * dash-plus-note shape as pickemTable() below the floor - a new player is
 * never simply missing from a table they are genuinely on.
 */
async function gameSeasonTable(gameType, uid = null, { limit = 10 } = {}) {
  const entries = await sql`
    SELECT ce.user_id, ce.contest_id, u.handle, (ce.meta->>'pct')::numeric AS pct
      FROM contest_entries ce
      JOIN contests c ON c.id = ce.contest_id
      JOIN users u ON u.id = ce.user_id
     WHERE c.game_type = ${gameType} AND c.settled AND ce.meta ? 'pct'`;
  if (!entries.length) return null;

  const byUser = new Map(); // userId -> { handle, sum, weeksPlayed }
  for (const e of entries) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, { handle: e.handle, sum: 0, weeksPlayed: 0 });
    const u = byUser.get(e.user_id);
    u.sum += Number(e.pct); u.weeksPlayed += 1;
  }
  const rows = [...byUser.entries()]
    .map(([userId, u]) => ({
      userId, name: displayName({ id: userId, handle: u.handle }),
      avgPct: Math.round((u.sum / u.weeksPlayed) * 10) / 10, weeksPlayed: u.weeksPlayed,
    }))
    .sort((a, b) => b.avgPct - a.avgPct || a.userId - b.userId);

  let rank = 0;
  const ranked = rows.map((r) => {
    const eligible = r.weeksPlayed >= SEASON_TABLE_MIN_WEEKS;
    if (eligible) rank += 1;
    return {
      ...r,
      rank: eligible ? rank : null,
      note: eligible ? null : `${r.weeksPlayed} of ${SEASON_TABLE_MIN_WEEKS} weeks`,
    };
  });

  const top = ranked.slice(0, limit);
  const mine = uid == null ? null : ranked.find((r) => r.userId === uid) ?? null;
  return { top, self: mine && !top.some((r) => r.userId === mine.userId) ? mine : null };
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
// 'Tue Sep 8' - the pre-any-row Pick'em row (relay 2c item 6's own example),
// which names the day of week the mock's "Board 1 opens Tue Sep 8" line does.
const DOW_MONTH_DAY_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
// formatToParts, not .format() - the locale's default punctuates
// weekday+date as 'Tue, Sep 8' (a comma this house style never uses).
function dowMonthDay(d) {
  const p = Object.fromEntries(DOW_MONTH_DAY_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** The Draft season table's populates label - derived from the next/current
 * draft contest's own settles_at, never a typed date. Null contest -> a
 * label with no date rather than a guess. */
export async function draftTablePopulatesLabel() {
  const [c] = await sql`
    SELECT week, settles_at FROM contests WHERE game_type = 'draft'
     ORDER BY opens_at ASC LIMIT 1`;
  if (!c) return 'First settle after Week 1';
  return `First settle with Week ${c.week} · ${MONTH_DAY.format(new Date(c.settles_at))}`;
}

// ===========================================================================
// LOBBY HEADER AND STAT STRIP (relay 2a item 2)
// ===========================================================================

/**
 * The current NFL week - derived from the Weekly's own contest rows, never
 * typed. Weekly and Draft share opens_at/locks_at/week (relay D1's "both
 * rows or neither"), so Weekly alone is the canonical source. Picks the
 * LIVE week if one has opened; otherwise the NEXT one, so "Week 1" is
 * already true on the Friday before Sep 8 opens, not just from Sep 8 on.
 */
async function currentNflWeek({ now = new Date() } = {}) {
  const iso = now.toISOString();
  const [open] = await sql`
    SELECT week FROM contests WHERE game_type = 'weekly' AND sport = 'nfl'
      AND opens_at <= ${iso} ORDER BY opens_at DESC LIMIT 1`;
  if (open) return open.week;
  const [next] = await sql`
    SELECT week FROM contests WHERE game_type = 'weekly' AND sport = 'nfl'
      AND opens_at > ${iso} ORDER BY opens_at ASC LIMIT 1`;
  return next?.week ?? null;
}

const TODAY_ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric',
});

/** "Tuesday Sep 8" - today's calendar date, ET (the house's canonical clock
 * for a date with no single instant, same as todayEtHere() elsewhere).
 * formatToParts, not .format(): en-US inserts a comma after the weekday
 * that the mock's own header never carries. */
function todayHeaderLabel(now) {
  const p = TODAY_ET.formatToParts(now);
  const v = (t) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('weekday')} ${v('month')} ${v('day')}`;
}

/**
 * The Daily's LONGEST streak, not just the current one - same gaps-and-
 * islands idea as streakLeaderboard() (lib/daily/seasonBoardLeaderboards.js)
 * but walked in JS over the SAME rows dailyStreak() already reads, so the
 * two numbers can never disagree about what counts as "played". v1 tables
 * (puzzle_days/puzzle_entries) - the v2 board has its own streak leaderboard
 * and its own numbers, and this page has never read from it.
 */
async function dailyBestStreak(userId) {
  if (userId == null) return 0;
  const rows = await sql`
    SELECT (e.id IS NOT NULL AND e.locked_at IS NOT NULL) AS played
      FROM puzzle_days d
      LEFT JOIN puzzle_entries e ON e.puzzle_date = d.puzzle_date AND e.user_id = ${userId}
     WHERE d.revealed ORDER BY d.puzzle_date`;
  let best = 0; let run = 0;
  for (const r of rows) { if (r.played) { run += 1; best = Math.max(best, run); } else run = 0; }
  return best;
}

/**
 * 'boards' - ranked entries settled (Weekly/Draft/Pick'em) plus Daily days
 * played (the Daily has no per-contest "settle", it reveals once for
 * everyone at midnight - a locked entry on a revealed day is its completed
 * unit, same rows yourStats().played already counts).
 */
async function boardsPlayedCount(userId) {
  if (userId == null) return 0;
  const [{ n: dailyN }] = await sql`
    SELECT count(*)::int AS n FROM puzzle_entries e
      JOIN puzzle_days d ON d.puzzle_date = e.puzzle_date AND d.revealed
     WHERE e.user_id = ${userId} AND e.locked_at IS NOT NULL`;
  const [{ n: rankedN }] = await sql`
    SELECT count(*)::int AS n FROM contest_entries ce
      JOIN contests c ON c.id = ce.contest_id
     WHERE ce.user_id = ${userId} AND c.game_type IN ('weekly', 'draft', 'pickem') AND c.settled`;
  return dailyN + rankedN;
}

/**
 * 'of best' - average of the STORED meta.pct across the user's settled
 * Weekly/Draft entries where pct exists (frozen at settle, relay 1/D1 - see
 * lib/weekly/settle.js). Pick'em has no pct (it grades correct/played, not a
 * ceiling percentage), so it is not part of this average. Null with nobody
 * eligible yet, never a fabricated 0.
 */
async function avgOfBestPct(userId) {
  if (userId == null) return null;
  const [{ avg }] = await sql`
    SELECT avg((ce.meta->>'pct')::numeric) AS avg
      FROM contest_entries ce JOIN contests c ON c.id = ce.contest_id
     WHERE ce.user_id = ${userId} AND c.game_type IN ('weekly', 'draft') AND c.settled
       AND ce.meta ? 'pct'`;
  return avg == null ? null : Math.round(Number(avg) * 10) / 10;
}

/** The signed-OUT strip: the field's numbers, never the viewer's (there is
 * no viewer). Same four facts, aggregated across everybody. */
/**
 * Every user's CURRENT Daily streak (consecutive revealed days ending at
 * the most recent one, same definition as dailyStreak() above - just for
 * everybody at once), sorted longest-current first. One shared computation
 * for the field's own "top streak" (fieldStrip) and the leaderboards
 * module's Streak row (relay 2a item 5) - two readers, one number.
 */
async function dailyStreakRankings() {
  const days = await sql`SELECT puzzle_date FROM puzzle_days WHERE revealed ORDER BY puzzle_date DESC`;
  if (!days.length) return [];
  const entries = await sql`
    SELECT e.user_id, e.puzzle_date, u.handle FROM puzzle_entries e
      JOIN puzzle_days d ON d.puzzle_date = e.puzzle_date AND d.revealed
      JOIN users u ON u.id = e.user_id
     WHERE e.locked_at IS NOT NULL`;
  const byUser = new Map(); // userId -> { handle, playedDates: Set }
  for (const e of entries) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, { handle: e.handle, playedDates: new Set() });
    byUser.get(e.user_id).playedDates.add(String(e.puzzle_date));
  }
  const rows = [...byUser.entries()].map(([userId, u]) => {
    let current = 0;
    for (const d of days) { if (!u.playedDates.has(String(d.puzzle_date))) break; current += 1; }
    return { userId, name: displayName({ id: userId, handle: u.handle }), current };
  });
  return rows.sort((a, b) => b.current - a.current || a.userId - b.userId);
}

async function fieldStrip(playingToday) {
  const [[{ n: boardsSettled }], rankings, [{ m: topAvg }]] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM contest_entries ce JOIN contests c ON c.id = ce.contest_id
         WHERE c.game_type IN ('weekly', 'draft', 'pickem') AND c.settled`,
    dailyStreakRankings(),
    sql`SELECT max(u_avg) AS m FROM (
          SELECT ce.user_id, avg((ce.meta->>'pct')::numeric) AS u_avg
            FROM contest_entries ce JOIN contests c ON c.id = ce.contest_id
           WHERE c.game_type IN ('weekly', 'draft') AND c.settled AND ce.meta ? 'pct'
           GROUP BY ce.user_id) t`,
  ]);
  return {
    playersToday: playingToday ?? 0,
    boardsSettled,
    topStreak: rankings[0]?.current ?? 0,
    topAvg: topAvg == null ? null : Math.round(Number(topAvg) * 10) / 10,
  };
}

// ===========================================================================
// THE HERO (relay 2a item 3)
// ===========================================================================

/**
 * The hero belongs to whichever of the three APPOINTMENT games (Weekly,
 * Draft, Pick'em) is both LIVE and NOT YET entered by this viewer, with the
 * nearest lock. The Daily is deliberately not a candidate here - it resets
 * every night with no real deadline story, and its only hero role is the
 * "everything is done" fallback below.
 *
 * "Sep 8 morning that is The Weekly for everyone" (the relay's own worked
 * example) falls out of this rule without a special case: Weekly and Draft
 * open and lock at the identical instant (relay D1, "both rows or
 * neither"), so on the morning they open the two TIE on locks_at, and
 * GAME_ORDER (daily, pickem, weekly, draft) breaks the tie toward Weekly.
 * Pick'em's own next lock that same morning is Thursday - genuinely later.
 *
 * @returns {object|null} null when no appointment game is currently open -
 *   a state the mock never designed a hero for, so this stays honest about
 *   there being nothing to lead with rather than inventing one.
 */
function appointmentHero({ live, weeklyHome, draftHome, pickem, now }) {
  const candidates = [];

  const weeklyContest = live.get('weekly');
  if (weeklyContest) {
    const entered = weeklyHome != null && weeklyHome.state !== 'play';
    candidates.push({ key: 'weekly', entered, locksAt: weeklyContest.locks_at, opensAt: weeklyContest.opens_at });
  }
  const draftContest = live.get('draft');
  if (draftContest) {
    const entered = draftHome != null && draftHome.state !== 'rules';
    candidates.push({ key: 'draft', entered, locksAt: draftContest.locks_at, opensAt: draftContest.opens_at });
  }
  if (pickem) {
    candidates.push({
      key: 'pickem', entered: Boolean(pickem.entered),
      locksAt: pickem.nextKickoff ?? null, opensAt: pickem.opensAt ?? null,
    });
  }

  const unmet = candidates
    .filter((c) => !c.entered && c.locksAt != null)
    .sort((a, b) => {
      const d = new Date(a.locksAt).getTime() - new Date(b.locksAt).getTime();
      if (d !== 0) return d;
      return GAME_ORDER.indexOf(a.key) - GAME_ORDER.indexOf(b.key);
    });
  if (!unmet.length) return null;

  const c = unmet[0];
  const meta = GAME_META[c.key];
  const todayKey = TODAY_ET.formatToParts(now).find((p) => p.type === 'day')?.value
    + TODAY_ET.formatToParts(now).find((p) => p.type === 'month')?.value;
  const opensKey = c.opensAt && (
    TODAY_ET.formatToParts(new Date(c.opensAt)).find((p) => p.type === 'day')?.value
    + TODAY_ET.formatToParts(new Date(c.opensAt)).find((p) => p.type === 'month')?.value
  );
  return {
    key: c.key,
    name: meta.name,
    eyebrowLeft: opensKey && opensKey === todayKey ? `${meta.name} opened this morning` : `${meta.name} is open`,
    locksAt: c.locksAt,
    tagline: HERO_TAGLINE[c.key],
    cta: HERO_CTA[c.key],
    href: meta.href,
  };
}

// ===========================================================================
// TODAY'S BOARDS - four rows, fixed order (relay 2a item 4)
// ===========================================================================

/** The Weekly pool size ("six from {pool}") - one cheap count, never the
 * full board (which liveContests() and getWeeklyHome() both drop). */
async function weeklyPoolSize(contestId) {
  if (contestId == null) return null;
  const [row] = await sql`SELECT jsonb_array_length(board) AS n FROM contests WHERE id = ${contestId}`;
  return row?.n ?? null;
}

/**
 * The four "Today's boards" rows, in GAME_ORDER's fixed sequence, each
 * carrying DERIVED text pieces plus a raw {locksAt} ISO timestamp for the
 * page to render through StandaloneDate (ET before hydration, viewer zone
 * after - the {local} the relay names). Signed-out gets the same rows with
 * no viewer-scoped pill/line2 - the shared facts only.
 */
async function todaysBoardsRows({ uid, dailyHome, pickemNfl, pickemCfb, weeklyHome, draftHome, live, playingToday, now }) {
  const weeklyContest = live.get('weekly') ?? null;
  const draftContest = live.get('draft') ?? null;
  const poolSize = weeklyContest ? await weeklyPoolSize(weeklyContest.id).catch(() => null) : null;

  // ---- Daily ----------------------------------------------------------------
  const daily = (() => {
    const line1 = dailyHome?.edition ? `No. ${dailyHome.edition} · nine slots, twelve teams` : 'nine slots, twelve teams';
    if (dailyHome == null) return { line1, line2: 'not available today', pill: { label: 'Locked', tone: 'muted' }, tile: '' };
    if (uid == null) return { line1, line2: `${playingToday ?? 0} playing today`, pill: null, tile: '' };
    if (dailyHome.state === 'receipt') {
      const pct = Math.round((Number(dailyHome.score) / 9) * 100);
      return { line1, line2: `played · ${dailyHome.score} of 9 · ${pct}%`, pill: { label: 'Done', tone: 'jade' }, tile: 'done' };
    }
    return { line1, line2: 'not played · closes midnight PT', pill: { label: 'Play', tone: 'volt' }, tile: 'on' };
  })();

  // PRE-OPEN PILL (relay 2a-render item 1) - a contest with opens_at in the
  // future shows its own short local date, never 'Locked'. 'Locked' is
  // reserved for a contest that HAS opened and is now past locks_at with no
  // entry - a real state about a real deadline, not "nothing has happened
  // yet". Looked up only when there is no LIVE contest of that kind, so this
  // never costs a query on the common (open) path.
  const [nextWeekly, nextDraft] = await Promise.all([
    weeklyContest ? null : nextContest({ now }).catch(() => null),
    draftContest ? null : nextDraftContest({ now }).catch(() => null),
  ]);
  const preOpenPill = (opensAt) => (opensAt
    ? { label: MONTH_DAY.format(new Date(opensAt)), tone: 'muted' }
    : null); // truly nothing scheduled, not even a future date - no pill beats a false 'Locked'

  // ---- Pick'em, TWO ROWS (relay 2c item 6) - NFL above CFB, same tile -------
  //
  // NO ROW YET NAMES ITS OWN OPEN, NEVER JUST "no board yet" (item 6's own
  // example: "Board 1 opens Tue Sep 8"). Nothing is inserted until the open
  // gate passes (ensurePickemBoard's own "before-open" refusal), so there is
  // no future contest row a nextContest()-style lookup could find the way
  // Weekly/Draft's pre-seeded rows allow - boardPlan() is read-only and
  // derives the identical opens_at/board-number the real creation would
  // write, straight from the schedule, so the row can say the true date
  // before anything exists to query.
  async function pickemPreOpenLine(sport) {
    const { plan } = await boardPlan({ leagueSlug: sport, now }).catch(() => ({ plan: null }));
    if (!plan) return { line1: 'no board yet', line2: null, pill: null, tile: '' };
    const [{ n }] = await sql`
      SELECT count(*) AS n FROM contests
       WHERE game_type = 'pickem' AND sport = ${sport} AND opens_at < ${plan.opensAt.toISOString()}`;
    return {
      line1: `Board ${Number(n) + 1} opens ${dowMonthDay(plan.opensAt)}`,
      line2: null, pill: preOpenPill(plan.opensAt.toISOString()), tile: '',
    };
  }

  async function pickemRow(sport, pickem) {
    if (!pickem) return pickemPreOpenLine(sport);
    const SPORT = sport.toUpperCase();
    const line1 = pickem.displayWeek != null
      ? `Board ${pickem.boardNumber} · ${SPORT} Week ${pickem.displayWeek} · ${pickem.total} games`
      : `Board ${pickem.boardNumber} · ${SPORT} · ${pickem.total} games`;
    // PICK IS THE PILL WHETHER OR NOT A READER IS SIGNED IN - pickem locks per
    // game, never as a contest, so there is no global 'Locked' state for it to
    // reach here (a settled board already exited above the pill entirely, via
    // pickemCardData returning null).
    if (uid == null) return { line1, line2: `${pickem.total} games`, locksAt: pickem.firstKickoff, locksPre: 'first lock ', pill: { label: 'Pick', tone: 'volt' }, tile: '' };
    return {
      line1, locksAt: pickem.firstKickoff, locksPre: `${pickem.picked} of ${pickem.total} picked · first lock `,
      pill: { label: 'Pick', tone: 'volt' }, tile: pickem.picked === 0 ? 'on' : '',
    };
  }
  const [pkNfl, pkCfb] = await Promise.all([pickemRow('nfl', pickemNfl), pickemRow('cfb', pickemCfb)]);

  // ---- The Weekly ----------------------------------------------------------------
  const wk = (() => {
    if (!weeklyContest) return { line1: 'opens with NFL Week 1', line2: null, pill: preOpenPill(nextWeekly?.opens_at), tile: '' };
    const week = weeklyContest.week;
    const line1 = `Week ${week} · six from ${poolSize != null ? poolSize.toLocaleString('en-US') : '-'} · PPR`;
    // SIGNED OUT SEES THE CONTEST'S OWN CLOCK, NOT A PERSONAL STATE - 'Done'
    // only exists for a reader with a settled entry, which a signed-out
    // reader by definition has none of.
    if (uid == null) {
      const locked = now >= new Date(weeklyContest.locks_at);
      return {
        line1, locksAt: weeklyContest.locks_at, locksPre: locked ? 'locked · ' : 'locks ',
        pill: locked ? { label: 'Locked', tone: 'muted' } : { label: 'Open', tone: 'volt' }, tile: '',
      };
    }
    if (weeklyHome?.state === 'settled') return { line1, line2: 'graded', pill: { label: 'Done', tone: 'jade' }, tile: 'done' };
    if (weeklyHome?.state === 'locked') return { line1, locksAt: weeklyContest.locks_at, locksPre: 'locked · ', pill: { label: 'Locked', tone: 'muted' }, tile: '' };
    const set = weeklyHome?.filled ?? 0;
    return {
      line1, locksAt: weeklyContest.locks_at, locksPre: `${set} of 6 set · locks `,
      pill: { label: 'Open', tone: 'volt' }, tile: set === 0 ? 'on' : '',
    };
  })();

  // ---- The Draft ----------------------------------------------------------------
  const dr = (() => {
    const { teamsCount, clockSeconds } = DRAFT_CONFIG;
    if (!draftContest) return { line1: 'opens with NFL Week 1', line2: null, pill: preOpenPill(nextDraft?.opens_at), tile: '' };
    const week = draftContest.week;
    const line1 = `Week ${week} · ${teamsCount} seats · ${DRAFT_ROUNDS} rounds · ${clockSeconds}s`;
    if (uid == null) {
      const locked = now >= new Date(draftContest.locks_at);
      return {
        line1, locksAt: draftContest.locks_at, locksPre: locked ? 'locked · ' : 'rooms lock ',
        pill: locked ? { label: 'Locked', tone: 'muted' } : { label: 'Open', tone: 'volt' }, tile: '',
      };
    }
    if (draftHome?.state === 'settled') return { line1, line2: 'graded', pill: { label: 'Done', tone: 'jade' }, tile: 'done' };
    if (draftHome?.state === 'locked') return { line1, locksAt: draftContest.locks_at, locksPre: 'locked · ', pill: { label: 'Locked', tone: 'muted' }, tile: '' };
    const seatText = draftHome?.state === 'rules' || draftHome == null
      ? 'no seat yet'
      : `seat ${draftHome.seat ?? '-'} · ${draftHome.picks ?? 0} of ${DRAFT_ROUNDS}`;
    return {
      line1, locksAt: draftContest.locks_at, locksPre: `${seatText} · rooms lock `,
      pill: { label: 'Open', tone: 'volt' }, tile: (draftHome == null || draftHome.state === 'rules') ? 'on' : '',
    };
  })();

  return [
    { key: 'daily', glyph: GAME_GLYPHS.daily, name: GAME_META.daily.name, href: GAME_META.daily.href, ...daily },
    // TWO ROWS, SAME TILE, NFL ABOVE CFB (relay 2c item 6) - each links
    // straight to its own sport's board rather than through the bare
    // /pickem redirect, since the reader is already choosing which one here.
    { key: 'pickem-nfl', glyph: GAME_GLYPHS.pickem, name: `${GAME_NAMES.pickem} · NFL`, href: '/pickem/nfl', ...pkNfl },
    { key: 'pickem-cfb', glyph: GAME_GLYPHS.pickem, name: `${GAME_NAMES.pickem} · CFB`, href: '/pickem/cfb', ...pkCfb },
    { key: 'weekly', glyph: GAME_GLYPHS.weekly, name: GAME_META.weekly.name, href: GAME_META.weekly.href, ...wk },
    { key: 'draft', glyph: GAME_GLYPHS.draft, name: GAME_META.draft.name, href: GAME_META.draft.href, ...dr },
  ];
}

export async function gamesLobby(userId = null, { now = new Date() } = {}) {
  const uid = userId == null ? null : Number(userId);
  const [live, dailyHome, yesterday, table, streak, me, pickemNfl, pickemCfb, playingToday, bestStreak, boardsPlayed, ofBest, nflWeek, weeklyHome, draftHome] = await Promise.all([
    liveContests({ now }),
    getDailyHome(uid).catch(() => null),
    getYesterday(uid).catch(() => null),
    overall(uid, 10).catch(() => null),
    dailyStreak(uid).catch(() => 0),
    uid == null ? null
      : sql`SELECT handle FROM users WHERE id = ${uid}`.then((r) => r[0] ?? null).catch(() => null),
    // TWO SPORTS (relay 2c item 6), each caught to null like every lobby
    // read: no board for that sport (or a failed read) ghosts its own row,
    // the safe direction - independently of the other sport's state.
    pickemCardData(uid, { sport: 'nfl', now }).catch(() => null),
    pickemCardData(uid, { sport: 'cfb', now }).catch(() => null),
    todayEntrantCount().catch(() => 0),
    dailyBestStreak(uid).catch(() => 0),
    boardsPlayedCount(uid).catch(() => 0),
    avgOfBestPct(uid).catch(() => null),
    currentNflWeek({ now }).catch(() => null),
    uid == null ? null : getWeeklyHome(uid).catch(() => null),
    uid == null ? null : getDraftHome(uid, { now }).catch(() => null),
  ]);
  const field = uid == null ? await fieldStrip(playingToday).catch(() => null) : null;
  // THE STAT STRIP (relay 2a item 2). Signed in: the viewer's own four
  // numbers. Signed out: the field's, because there is no viewer's to show -
  // never the same shape wearing zeros.
  //
  // LABELED 'Daily streak', NOT 'streak' (relay 2a item 0c ruling): the
  // mock's own header says bare 'streak', but only a Daily streak exists
  // anywhere in this codebase today - dailyStreak() here and yourStats()'s
  // own streak (lib/games/personal.js) are both the same v1 Daily fact,
  // computed twice. A bare 'streak' label would claim a cross-game number
  // that does not exist; this stays true until one does.
  // FOUR CELLS, LEFT TO RIGHT - signed in and signed out show DIFFERENT
  // facts in these same four slots, not the same slot relabeled: a viewer's
  // own streak/best/boards/of-best has no meaning for a stranger, so the
  // signed-out strip is the field's own four numbers in the order the relay
  // specifies (players today, boards settled, top streak, top avg), not a
  // reshuffle of the signed-in cells.
  const strip = uid == null
    ? (field && [
      { value: field.playersToday, label: 'players today' },
      { value: field.boardsSettled, label: 'boards settled' },
      { value: field.topStreak, label: 'top streak' },
      { value: field.topAvg == null ? null : `${field.topAvg}%`, label: 'top avg' },
    ])
    : [
      { value: streak, label: 'Daily streak', volt: true },
      { value: bestStreak, label: 'best' },
      { value: boardsPlayed, label: 'boards' },
      { value: ofBest == null ? null : `${ofBest}%`, label: 'of best' },
    ];
  const header = {
    title: 'Games',
    today: todayHeaderLabel(now),
    week: nflWeek,
    sub: uid == null ? 'sign in to see yours' : 'same boards for everyone',
  };

  // THE HERO (relay 2a item 3, signed-out parity in 2a-polish item 4) - an
  // open appointment game's hero is a SHARED fact (which game, which lock),
  // not a personal one, so a stranger sees the identical hero a signed-in
  // reader with no entries yet would. appointmentHero() already takes
  // "entered" from weeklyHome/draftHome/pickem, which are null/unentered for
  // uid == null by construction, so it needs no branch of its own here.
  // Only the ALL-FOUR-ENTERED daily-receipt hero is inherently personal -
  // there is no version of "you finished everything" for a reader who was
  // never signed in to finish anything.
  // PICK'EM'S HERO CANDIDACY NOW SPANS TWO SPORTS (relay 2c item 6).
  // "Entered" is true only once every sport that CURRENTLY HAS an open
  // board is entered - a sport with no board yet (its season has not
  // started) is vacuously satisfied, the same neutral treatment the
  // single-sport check always gave "no board at all". The hero candidate
  // is whichever open, unentered sport's own next kickoff is sooner; its
  // href stays the bare '/pickem', which redirects to whichever sport is
  // actually current (item 6's own redirect rule), so appointmentHero()
  // needs no change to how it uses a pickem candidate, only to what gets
  // handed to it.
  const pickemSports = [pickemNfl, pickemCfb].filter(Boolean);
  const pickemEntered = pickemSports.every((p) => p.entered);
  const pickemCandidate = pickemSports
    .filter((p) => !p.entered)
    .sort((a, b) => new Date(a.nextKickoff ?? 8640000000000000) - new Date(b.nextKickoff ?? 8640000000000000))[0]
    ?? null;

  let hero = null;
  if (uid != null) {
    const dailyEntered = dailyHome != null && dailyHome.state === 'receipt';
    const weeklyEntered = weeklyHome != null && weeklyHome.state !== 'play';
    const draftEntered = draftHome != null && draftHome.state !== 'rules';
    const allFourEntered = dailyHome != null && weeklyHome != null && draftHome != null && pickemSports.length > 0
      && dailyEntered && weeklyEntered && draftEntered && pickemEntered;
    if (allFourEntered) {
      // ALL FOUR ENTERED -> the Daily's own RECEIPT (score + band), the same
      // fact its home module already shows (lib/daily/homeModule.js's
      // 'receipt' state) - the only "grade" that exists before midnight's
      // reveal. Never the historical percentile; that does not exist yet.
      hero = {
        key: 'daily', allDone: true, name: GAME_META.daily.name, href: '/daily',
        score: dailyHome.score, band: dailyHome.band ?? null,
      };
    }
  }
  if (!hero) hero = appointmentHero({ live, weeklyHome, draftHome, pickem: pickemCandidate, now });

  // TODAY'S BOARDS - five rows now (relay 2c item 6 split Pick'em in two).
  const boardRows = await todaysBoardsRows({
    uid, dailyHome, pickemNfl, pickemCfb, weeklyHome, draftHome, live, playingToday, now,
  }).catch(() => []);

  // ---- the 2x2 grid -------------------------------------------------------
  const cards = GAME_ORDER.map((key) => {
    if (key === 'daily') {
      return cardState({
        key,
        contest: dailyHome ? { closesLabel: 'closes midnight ET' } : null,
        // NO PER-USER BLOCK FOR A STRANGER. A signed-out reader was getting a
        // `you` object full of nulls - not a leak, but it is a per-user shape
        // on a payload that has no user, and the leak test is right to refuse
        // it rather than learn to tolerate one.
        mine: (uid != null && dailyHome)
          ? { entered: dailyHome.state === 'receipt', score: dailyHome.score ?? null, streak }
          : null,
        opensLabel: 'Opens at midnight ET',
        // THE NUMBER IS THE STATE. How many people have played today - a fact
        // about the edition, true for everybody, so it rides for signed-out
        // readers too.
        count: dailyHome
          ? { value: String(playingToday ?? 0), unit: 'played today' }
          : null,
      });
    }
    if (key === 'pickem') {
      // CFB ONLY, UNCHANGED (relay 2c item 6 scoped its two-sport split to
      // the /games "Today's boards" module by name - this card feeds
      // components/gridiron/TodayPage.js's own lobby band, a different
      // surface the relay did not ask to extend, so it keeps showing
      // exactly the sport it always has rather than an arbitrary pick
      // between two now-live sports).
      const pickem = pickemCfb;
      // Live once board 1 exists: entered / picked count / next kickoff -
      // the viewer's own state only, per the card law.
      return cardState({
        key,
        contest: pickem ? {
          closesLabel: pickem.nextKickoff
            ? `locks per game · next ${lockLabel(pickem.nextKickoff)}`
            : 'all games kicked · grading in',
        } : null,
        mine: (uid != null && pickem) ? { entered: pickem.entered } : null,
        // MY picks over the board's size. Viewer-scoped, so a stranger gets the
        // board size alone rather than somebody else's progress.
        count: pickem
          ? (uid != null
            ? { value: `${pickem.picked}/${pickem.total}`, unit: 'picked' }
            : { value: String(pickem.total), unit: 'games' })
          : null,
        // Honest, and it is the ONLY hardcoded date on the page: a label,
        // not a gate. The card flips on the contest existing, never on the
        // clock.
        opensLabel: 'Opens Aug 25',
      });
    }
    const c = live.get(key) ?? null;
    return cardState({
      key,
      // The lock label derives from the contest's snapshotted locks_at, the
      // Pick'em card's grammar - never hardcoded (rehearsal F5: the live
      // Weekly card said nothing about when the board locks).
      contest: c ? {
        closesLabel: new Date(c.locks_at) > now
          ? `locks ${lockLabel(c.locks_at)}`
          : 'locked · live',
      } : null,
      mine: null,
      opensLabel: 'Opens Sep 8',
      // THE WEEKLY AND THE DRAFT. The Weekly's lineup is six slots; the Draft's
      // number is the room. Both come from the contest row this card was built
      // from, so a ghosted game - no contest - carries no number, which is the
      // honest reading of "nothing has opened yet".
      count: c
        ? (key === 'weekly'
          ? { value: '6', unit: 'slots' }
          : { value: 'Room open', unit: null })
        : null,
    });
  });
  // Pick'em's CTA copy, from data - n/8 once the viewer holds picks.
  // CFB ONLY, same scoping note as the card build above.
  const pickemCard = cards[1];
  if (pickemCfb && pickemCard.state !== 'ghost') {
    pickemCard.cta = (uid != null && pickemCfb.picked > 0)
      ? `${pickemCfb.picked}/${pickemCfb.total} PICKED`
      : 'MAKE YOUR PICKS';
  }

  // PULSE DATA - live numbers through the readers above, never page SQL.
  // The page owns the sentence; this owns the facts.
  cards[0].pulse = { playing: playingToday, perfect: yesterday?.perfect ?? null };
  pickemCard.pulse = (pickemCfb && pickemCard.state !== 'ghost')
    ? { games: pickemCfb.total, next: pickemCfb.nextKickoff ? lockLabel(pickemCfb.nextKickoff) : null, boardNumber: pickemCfb.boardNumber }
    : null;

  // The Daily's own edition and CTA copy, from data.
  const dailyCard = cards[0];
  if (dailyHome) {
    dailyCard.cta = dailyHome.state === 'receipt' ? 'YOUR ENTRY' : `PLAY ED. ${dailyHome.edition}`;
    dailyCard.foot = streak > 0
      ? `streak ${streak} · closes midnight ET`
      : 'closes midnight ET';
  }

  // ---- leaderboards -------------------------------------------------------
  // The Weekly's table exists from LOCK onward (live totals, then the settle's
  // final) - pre-lock it stays null and the section keeps its populates label,
  // because a pre-lock board is just the entry list wearing zeros. Caught to
  // null like every lobby read: a contest table must never cost the lobby.
  const [weeklyTable, pickemSeasonTable, draftPopulatesLabel, weeklySeason, draftSeason, streakRankings] = await Promise.all([
    currentContest().then((c) => weeklyBoardTable(c, uid, { now })).catch(() => null),
    pickemTable(uid).catch(() => null),
    draftTablePopulatesLabel().catch(() => 'First settle with Week 1'),
    gameSeasonTable('weekly', uid).catch(() => null),
    gameSeasonTable('draft', uid).catch(() => null),
    dailyStreakRankings().catch(() => []),
  ]);
  const boards = [
    boardSection({ key: 'overall', name: 'Overall', table, populatesLabel: 'Populates at the first close' }),
    boardSection({ key: 'pickem', name: `${GAME_NAMES.pickem} — season`, table: pickemSeasonTable, populatesLabel: pickemTablePopulatesLabel() }),
    boardSection({ key: 'weekly', name: 'The Weekly — season', table: weeklyTable, populatesLabel: 'Opens with NFL Week 1 · Sep 15' }),
    boardSection({ key: 'draft', name: 'The Draft — season', populatesLabel: draftPopulatesLabel }),
  ];

  // ---- history: every REVEALED edition, newest first, plus sealed days ----
  const days = await sql`
    SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS d, season_year, week, revealed,
           perfect->>'total' AS perfect
      FROM puzzle_days ORDER BY puzzle_date DESC`;
  const tops = await sql`
    SELECT to_char(e.puzzle_date, 'YYYY-MM-DD') AS d, e.score, u.handle, u.id
      FROM puzzle_entries e
      JOIN puzzle_days pd ON pd.puzzle_date = e.puzzle_date AND pd.revealed
      JOIN users u ON u.id = e.user_id
     WHERE e.locked_at IS NOT NULL AND e.score IS NOT NULL
     ORDER BY e.puzzle_date DESC, e.score DESC`;
  const topBy = new Map();
  for (const t of tops) if (!topBy.has(t.d)) topBy.set(t.d, t);

  // THE READER'S OWN ENTRIES, AND THE `pd.revealed` JOIN IS THE WHOLE POINT.
  // Without it this picks up today's locked entry, and the reader's own open
  // day would then reach the YOU column, the average, the best score and the
  // streak - four numbers that would disagree with the leaderboard one pane
  // over. See lib/games/personal.js.
  const mineRows = uid == null ? [] : await sql`
    SELECT to_char(e.puzzle_date, 'YYYY-MM-DD') AS d,
           e.score, e.locked_at, e.guess_season, e.guess_week, e.bonus_pct
      FROM puzzle_entries e
      JOIN puzzle_days pd ON pd.puzzle_date = e.puzzle_date AND pd.revealed
     WHERE e.user_id = ${uid}`;
  const mineBy = new Map(mineRows.map((r) => [r.d, r]));

  const history = days.map((r) => {
    // A day older than the edition epoch has no edition number, and printing
    // "No. null" is worse than printing the date. DEV carries such a day - the
    // 15 Aug playtest board - so this is not hypothetical.
    const edition = editionLabel(editionNo(r.d));
    if (!r.revealed) {
      // A sealed row says a day EXISTS and is not readable yet. It carries no
      // season, no week and no score - the whole point.
      return { date: r.d, edition, label: edition ? `Ed. ${edition}` : r.d, sealed: true };
    }
    const t = topBy.get(r.d);
    const perfect = r.perfect ? Number(r.perfect) : null;
    // `you` is UNDEFINED for a signed-out reader, so it is absent from the
    // serialized payload and the column cannot render at all.
    const you = youCell({ signedIn: uid != null, entry: mineBy.get(r.d) ?? null, perfect });
    return {
      date: r.d, edition, label: edition ? `Ed. ${edition}` : r.d, sealed: false,
      season: r.season_year, week: r.week,
      perfect,
      href: `/daily/${r.d}`,
      top: t ? { name: displayName({ id: t.id, handle: t.handle }), score: Number(t.score) } : null,
      ...(you === undefined ? {} : { you }),
    };
  });

  // The stats module reads the SAME revealed days and the SAME entry map the
  // history rows do - one read, so the module and the rows above it can never
  // disagree about what the reader did.
  const stats = yourStats({
    signedIn: uid != null,
    days: days.filter((r) => r.revealed).map((r) => ({
      date: r.d, season_year: r.season_year, week: r.week,
      perfect: r.perfect ? Number(r.perfect) : null,
      entry: mineBy.get(r.d) ?? null,
    })),
  });

  const mine = table?.self ?? table?.top?.find((x) => x.userId === uid) ?? null;

  // THE LEADERBOARDS MODULE (relay 2a item 5) - five compact rows on the
  // lobby itself, distinct from the full ?pane=leaderboards tables above
  // (same underlying tables, condensed to one line each). Signed-out gets
  // none - every row is "the viewer's own line", and there is no viewer.
  let leaderboardRows = null;
  if (uid != null) {
    const rowFor = (seasonTable, { label, zeroLine, unit }) => {
      const mineRow = seasonTable?.top?.find((r) => r.userId === uid) ?? seasonTable?.self ?? null;
      if (!mineRow) return { label, middle: zeroLine, rank: null };
      if (mineRow.rank == null) return { label, middle: `${mineRow.avgPct}% · ${mineRow.weeksPlayed} of ${SEASON_TABLE_MIN_WEEKS} needed`, rank: null };
      return { label, middle: `${mineRow.avgPct}% avg ${unit}`, rank: mineRow.rank };
    };
    const pkMine = pickemSeasonTable?.top?.find((r) => r.userId === uid) ?? pickemSeasonTable?.self ?? null;
    const pkRow = !pkMine
      ? { label: GAME_NAMES.pickem, middle: `needs ${PICKEM_TABLE_MIN_BOARDS} boards · correct % across every board`, rank: null }
      : pkMine.rank == null
        ? { label: GAME_NAMES.pickem, middle: `${pkMine.pct}% · ${pkMine.boardsPlayed} of ${PICKEM_TABLE_MIN_BOARDS} needed`, rank: null }
        : { label: GAME_NAMES.pickem, middle: `${pkMine.pct}% · ${pkMine.correct} of ${pkMine.played} correct`, rank: pkMine.rank };

    const dailyRow = !stats
      ? { label: 'Daily', middle: 'not played yet', rank: null }
      : { label: 'Daily', middle: `${stats.avgPct ?? 0}% · ${stats.played} of ${stats.playable} played`, rank: mine?.rank ?? null };

    const myStreakIdx = streakRankings.findIndex((r) => r.userId === uid);
    const myStreak = myStreakIdx === -1 ? null : streakRankings[myStreakIdx];
    // 'Daily board', not the mock's 'any ranked board' (item 0c ruling, same
    // as the strip's label) - only a Daily streak exists.
    const streakRow = {
      label: 'Streak',
      middle: `${myStreak?.current ?? streak} current · ${bestStreak} longest · Daily board`,
      rank: myStreak && myStreak.current > 0 ? myStreakIdx + 1 : null,
    };

    leaderboardRows = [
      rowFor(weeklySeason, { label: 'Weekly', zeroLine: `needs ${SEASON_TABLE_MIN_WEEKS} weeks · avg % of ceiling`, unit: 'of ceiling' }),
      // Draft's OWN label, per item 5's explicit ruling - it is not "of
      // ceiling" (the Weekly's shared-pool theoretical best six), it is the
      // best REAL draft in that week's field (lib/draft/settle.js's ceiling
      // shape is {score, entry_id, user_id, seat} - a real entrant, not a
      // solver).
      rowFor(draftSeason, { label: 'Draft', zeroLine: `needs ${SEASON_TABLE_MIN_WEEKS} weeks · avg % of the week's best draft`, unit: "of the week's best draft" }),
      pkRow,
      dailyRow,
      streakRow,
    ];
  }

  return {
    signedIn: uid != null,
    header,
    strip,
    hero,
    boardRows,
    leaderboardRows,
    // PRACTICE (relay 2a item 5) - real chips only. The mock also shows
    // 'Daily practice · 2010s · 12 teams' chips; no such configurable
    // practice mode exists anywhere in this codebase (no era or team-count
    // option on /sim, no dedicated daily-practice route), so they are
    // omitted rather than faked. Only 'Mock draft' -> /sim is real.
    practice: { chips: [{ label: 'Mock draft', on: true }], href: '/sim', cta: 'Set up a board' },
    cards,
    boards,
    yesterday,
    history,
    season: uid == null ? null : seasonStrip({
      handle: me?.handle ? `@${me.handle}` : (uid ? displayName({ id: uid, handle: null }) : null),
      standing: mine ? { ...mine, streak } : null,
      pickem: null,
    }),
    streak,
    stats,
    seasonKey: table?.seasonKey ?? null,
  };
}
