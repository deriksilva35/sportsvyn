// lib/games/playRegistry.js - THE ONE REGISTRY of games the Play tab draws
// (thu-38 + fri-1).
//
// ADDING A GAME IS ONE ENTRY HERE, NOT A LOBBY EDIT. Every entry carries its
// sport, its game key, its name and letter, its room's href and its CTA copy,
// plus two functions:
//
//   read(ctx)              the entry's STATE - from the reader that game
//                          already has (lobbyV2's weekly/pickem/draft/daily,
//                          currentOctoberDay, currentRunRound + nextRunLock,
//                          currentSeriesBoard, the NBA day board, Tonight's
//                          Six night). Nothing here re-derives a lock or a
//                          count a game's own reader already decides.
//   item(entry, state, o)  PURE. The state as zero or more ITEMS in the one
//                          shape lib/games/playLobby.js orders, filters and
//                          collapses (that file's header lists the fields).
//
// TIMES ARE INSTANTS, NEVER WORDS. The rows these readers used to feed
// (lib/games/lobbyV3.js) baked "5:00 PM PT" into their lines; an item carries
// the ISO and the page renders it in the page's zone (StandaloneTime), so the
// header's zone label and every time on the screen agree.
//
// EVERY READ IS CAUGHT. A failed read is no item for that game, never a broken
// page - the rule every lobby reader before this one kept.
//
// EPL WEEKLY 5 (game_type 'epl_weekly_5') landed on main with its own group in
// the retired WeekPane; here it is one entry, read through lib/eplWeekly5/
// lobbyRow.js's state (the row's own reads).

import { sql } from '../db.js';
import { isVoidAll, VOID_ALL_LABEL } from '../settle/voidRule.js';
import { DAILY_V2_PATH } from '../daily/boardShape.js';
import { gameweekLabel } from '../soccer/roundLabel.js';
import { survivorOn } from '../survivor/flag.js';
import { boardsEnabled as draftGameOn } from '../draftGame/create.js';
import { survivorRowFor } from '../survivor/lobbyRow.js';

const iso = (d) => (d == null ? null : new Date(d).toISOString());
const ms = (d) => (d == null ? null : new Date(d).getTime());
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ===========================================================================
// THE READS - each game's own reader, called once per request
// ===========================================================================

/** NFL Weekly: lobbyV2's getWeeklyHome() view, and the next week's door. */
async function weeklyState(ctx) {
  return { home: ctx.v2?.weeklyHome ?? null, next: ctx.v2?.draftNext ?? null };
}

/** NFL / CFB Pick'em: lobbyV2's pickemCardData(), else the next board's planned door. */
function pickemStateFor(sport) {
  return async (ctx) => {
    const card = ctx.v2?.pickem?.sports?.[sport] ?? null;
    // A SETTLED BOARD STILL HAS A NEXT DOOR (sun-16 A). Reading the plan only
    // when there was no card left a settled CFB board with no door at all, and
    // the lobby collapsed CFB to "nothing open this week" on the Sunday before
    // board 7 opened on Tuesday. boardPlan refuses a board already filed, so
    // this can never advertise one a reader could already play.
    if (card && !card.settled) return { card, plan: null };
    const { boardPlan } = await import('../pickem/create.js');
    const { plan } = await boardPlan({ leagueSlug: sport, now: ctx.now }).catch(() => ({ plan: null }));
    return { card, plan };
  };
}

/**
 * The Draft (ranked): lobbyV2's getDraftHome() view. ON THE CLOCK the row
 * names the round, which is COUNTED - one past the picks already made, in
 * the room's own teamsCount (the rule lib/games/lobbyV3.js's draftRow kept).
 */
async function draftStateRead(ctx) {
  const home = ctx.v2?.draftHome ?? null;
  const next = ctx.v2?.draftNext ?? null;
  if (home?.state !== 'drafting' || ctx.uid == null) return { home, next, round: null };
  const { draftState } = await import('../draft/entry.js');
  const { DRAFT_CONFIG } = await import('../draft/contest.js');
  const st = await draftState(ctx.uid, { now: ctx.now });
  if (!st?.draft?.id) return { home, next, round: null };
  const teams = st.contest?.meta?.config?.teamsCount ?? DRAFT_CONFIG.teamsCount;
  const [c] = await sql`SELECT count(*)::int AS n FROM draft_picks WHERE draft_id = ${st.draft.id}`;
  return { home, next, round: Math.floor((c?.n ?? 0) / teams) + 1 };
}

/** The reader's lineup on one contest, or {}. */
async function lineupOf(ctx, contestId) {
  if (ctx.uid == null || contestId == null) return { lineup: {}, entered: false };
  const [e] = await sql`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contestId} AND user_id = ${Number(ctx.uid)}`;
  return { lineup: e?.lineup ?? {}, entered: Boolean(e) };
}

/** MLB October: today's card (currentOctoberDay) and the reader's five. */
async function octoberState(ctx) {
  const { currentOctoberDay } = await import('../october/create.js');
  const { SLOTS } = await import('../october/rules.js');
  const c = await currentOctoberDay({ now: ctx.now });
  if (!c) return null;
  const { lineup } = await lineupOf(ctx, c.id);
  return { contest: c, filled: SLOTS.filter((s) => lineup?.[s]?.playerId != null).length, size: SLOTS.length };
}

/** MLB The Run: the round (currentRunRound), its next CLUB lock, the reader's nine. */
async function runState(ctx) {
  const { currentRunRound } = await import('../run/create.js');
  const { nextRunLock } = await import('../run/entry.js');
  const { SLOTS } = await import('../run/rules.js');
  const c = await currentRunRound({ now: ctx.now });
  if (!c) return null;
  const [next, { lineup }] = await Promise.all([
    nextRunLock(c, { now: ctx.now }).catch(() => null),
    lineupOf(ctx, c.id),
  ]);
  return { contest: c, next, filled: SLOTS.filter((s) => lineup?.[s]?.playerId != null).length, size: SLOTS.length };
}

/** MLB series Pick'em: the round's board (currentSeriesBoard), only while unsettled. */
async function seriesState(ctx) {
  const { currentSeriesBoard, stageForWeek } = await import('../mlb/seriesPickem.js');
  const { STAGE_LABEL } = await import('../mlb/postseason.js');
  const c = await currentSeriesBoard({ now: ctx.now });
  if (!c || c.settled) return null;
  const { lineup } = await lineupOf(ctx, c.id);
  const board = c.board ?? [];
  const stage = c.meta?.stage ?? stageForWeek(c.week);
  const { roundLockFor } = await import('../mlb/seriesPickem.js');
  const lock = await roundLockFor(c, { now: ctx.now });
  return {
    lock,
    contest: c, label: STAGE_LABEL[stage] ?? 'Series',
    total: board.length, picked: board.filter((b) => lineup?.[b.series_key] != null).length,
  };
}

/**
 * The NBA's next slate, read-only (nbaDayBoardPlan) - the door both NBA games
 * open on before their board exists. Shared through ctx so the two entries
 * read it once. Both open at 6 AM ET on a game day (lib/nba/dayPickem.js
 * OPEN_ET, lib/six/night.js OPEN_ET), capped at the first tip.
 */
function nbaPlan(ctx) {
  ctx.memo.nbaPlan ??= (async () => {
    const { nbaDayBoardPlan } = await import('../nba/dayPickem.js');
    const { plan } = await nbaDayBoardPlan({ now: ctx.now });
    return plan ?? null;
  })().catch(() => null);
  return ctx.memo.nbaPlan;
}

/**
 * NBA daily Pick'em. The board for today's ET day; before 6 AM ET that is
 * still LAST night's while it is unsettled (a west-coast game is in the
 * fourth quarter at 1 AM ET). THE COUNTS USE THE CURRENT TIP AND STATUS
 * (lib/nba/dayPickem.js), the lock the save applies, so the item can never
 * call a game open that the board would refuse.
 */
export async function nbaPickemStateFor(uid, now) {
  const { dayBoardFor, etDay, previousDay, currentGames, withCurrentTips, dayGameLocked, isVoidStatus } = await import('../nba/dayPickem.js');
  const today = etDay(now);
  let c = await dayBoardFor({ dayEt: today });
  if (!c) {
    const y = await dayBoardFor({ dayEt: previousDay(today) });
    if (y && !y.settled) c = y;
  }
  if (!c || new Date(c.opens_at).getTime() > new Date(now).getTime()) return null;
  const byId = await currentGames(c.board);
  const board = withCurrentTips(c.board, byId);
  const [e] = uid == null ? [] : await sql`
    SELECT lineup, score, max_score FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${Number(uid)}`;
  const picks = e?.lineup ?? {};
  const live = board.filter((g) => !isVoidStatus(byId.get(Number(g.match_id))?.status));
  const open = live.filter((g) => !dayGameLocked({ ...byId.get(Number(g.match_id)), kickoff_at: g.kickoff_at }, now));
  return {
    settled: c.settled === true,
    games: live.length,
    pickable: open.length,
    pickedOpen: open.filter((g) => picks[g.match_id] != null || picks[String(g.match_id)] != null).length,
    picked: Object.keys(picks).length,
    score: e?.score == null ? null : Number(e.score),
    max: c.perfect?.max ?? null,
    maxPoints: e?.max_score == null ? null : Number(e.max_score),
    nextTip: open[0]?.kickoff_at ?? null,
  };
}

async function nbaPickemState(ctx) {
  const st = await nbaPickemStateFor(ctx.uid, ctx.now);
  return st ? { st, plan: null } : { st: null, plan: await nbaPlan(ctx) };
}

/**
 * TONIGHT'S SIX: tonight's card once it has opened, or last night's while it
 * is still being played (currentSixNight with settled nights left out). The
 * counts read the CURRENT tips (lib/six/rules.js), the lock the save applies.
 */
export async function sixStateFor(uid, now) {
  const { currentSixNight, liveRows, lockMaps } = await import('../six/night.js');
  const { cardProgress, nextLock, CARD_SIZE } = await import('../six/rules.js');
  const c = await currentSixNight({ now, includeSettled: false });
  if (!c) return null;
  const byId = await liveRows(c.board);
  const opts = lockMaps(byId);
  const [e] = uid == null ? [] : await sql`
    SELECT lineup, score FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${Number(uid)}`;
  const lineup = e?.lineup ?? {};
  const prog = cardProgress(lineup, c.board, now, opts);
  const next = nextLock(c.board, now, opts);
  return {
    games: (c.board ?? []).length,
    filled: prog.filled,
    locked: prog.locked,
    size: CARD_SIZE,
    nextTip: next ? new Date(next.ms).toISOString() : null,
  };
}

async function sixState(ctx) {
  const st = await sixStateFor(ctx.uid, ctx.now);
  return st ? { st, plan: null } : { st: null, plan: await nbaPlan(ctx) };
}

/** Game Drafts (per-game Draft): open NFL boards and how many this reader has drafted. */
async function draftGameState(ctx) {
  // readPlayItems does not filter on `flag`; like Survivor's read, this one asks itself.
  if (!draftGameOn()) return null;
  const { lobbyStateFor } = await import('../draftGame/room.js');
  return lobbyStateFor(ctx.uid, { now: ctx.now });
}

/** EPL Weekly 5: the current gameweek, the reader's five, the next kickoff. */
async function eplWeekly5State(ctx) {
  const { eplWeekly5StateFor } = await import('../eplWeekly5/lobbyRow.js');
  return eplWeekly5StateFor(ctx.uid, ctx.now);
}

/** The Daily: lobbyV2's dailyCard() view. */
async function dailyState(ctx) {
  return ctx.v2?.daily ?? null;
}

/** Survivor - PULLED (thu-27): no row while lib/survivor/flag.js says off. */
async function survivorState(ctx) {
  const survivor = survivorOn() ? await survivorRowFor(ctx.uid, ctx.now).catch(() => null) : null;
  return survivor;
}

// ===========================================================================
// THE ITEMS - PURE, one function per game
// ===========================================================================

const common = (e) => ({
  key: e.key, sport: e.sport, game: e.game, name: e.name, mark: e.mark,
  href: e.href, cta: e.cta, kicker: e.kicker,
});

/** The next kickoff on a frozen board still ahead of `now`, or null. */
function nextBoardKick(board = [], now) {
  const t = new Date(now).getTime();
  const ahead = (board ?? []).map((g) => ms(g.kickoff_at)).filter((x) => x != null && x > t).sort((a, b) => a - b);
  return ahead.length ? iso(ahead[0]) : null;
}

export function weeklyItem(e, { home = null, next = null } = {}, { signedIn = false } = {}) {
  const base = { ...common(e), groupNote: null };
  if (!home) {
    if (!next?.opensAt) return null;
    return { ...base, title: `Week ${next.week}`, status: 'Set six players · PPR', opensAt: iso(next.opensAt),
      locksAt: null, groupNote: `Week ${next.week}` };
  }
  const wk = `Week ${home.week}`;
  const b = { ...base, title: wk, groupNote: wk };
  if (home.state === 'settled') {
    // AN ALL-VOID CLOSE (ruling sun-11 item 1): never "no lineup" - nobody played.
    if (home.voidAll) return { ...b, settled: true, voidAll: true, status: VOID_ALL_LABEL, right: '—' };
    return { ...b, settled: true, status: home.played ? 'Final' : 'Final · no lineup',
      right: home.played && home.score != null ? Number(home.score).toFixed(1) : '—' };
  }
  if (home.state === 'locked') {
    return { ...b, status: home.entered ? `Locked · ${home.filled} of 6 in play` : 'Locked · no lineup',
      locksAt: null, progress: signedIn ? { done: home.filled ?? 0, total: 6 } : null };
  }
  const filled = home.state === 'building' ? Number(home.filled ?? 0) : 0;
  return {
    ...b,
    status: signedIn ? `${filled} of 6` : 'Set six players · PPR',
    at: { iso: iso(home.locksAt), words: 'locks' },
    locksAt: iso(home.locksAt),
    complete: signedIn && filled >= 6,
    progress: signedIn ? { done: filled, total: 6 } : null,
  };
}

export function pickemItem(e, { card = null, plan = null } = {}, { signedIn = false, now = new Date() } = {}) {
  const base = common(e);
  // A PLAN WHOSE DOOR HAS PASSED is a board the cron has not filed yet, not
  // a door: no item rather than an "opens" date in the past.
  const door = !plan?.opensAt || ms(plan.opensAt) <= new Date(now).getTime() ? null
    : { ...base, title: "Pick'em", status: e.blurb, opensAt: iso(plan.opensAt), locksAt: null };
  if (!card) return door;
  const title = card.displayWeek != null ? `Week ${card.displayWeek}` : `Board ${card.boardNumber ?? ''}`.trim();
  const b = { ...base, title, groupNote: card.displayWeek != null ? `Week ${card.displayWeek}` : null };
  if (card.settled) {
    if (card.voidAll) return { ...b, settled: true, voidAll: true, status: VOID_ALL_LABEL, right: '—' };
    const done = { ...b, settled: true, status: card.record ? `Settled · ${card.record.correct} of ${card.record.played}` : 'Settled',
      right: card.record ? `${card.record.correct}/${card.record.played}` : '—' };
    // The settled board AND the next door, so the sport's group reads
    // "opens Tue" rather than "nothing open this week" (sun-16 A). The door
    // gets its own key - two rows of one entry share a list.
    return door ? [done, { ...door, key: `${e.key}:next` }] : done;
  }
  const total = Number(card.total ?? 0);
  const pickable = Number(card.pickable ?? 0);
  const picked = Number(card.picked ?? 0);
  const pickedOpen = Number(card.pickedOpen ?? 0);
  if (pickable === 0) {
    return { ...b, status: 'All games kicked · grading', locksAt: null,
      progress: signedIn ? { done: picked, total } : null };
  }
  return {
    ...b,
    status: signedIn ? `${picked} of ${total} picked` : `${plural(total, 'game')} · ${e.blurb}`,
    at: card.nextKickoff ? { iso: iso(card.nextKickoff), words: total - pickable > 0 ? 'next lock' : 'first lock' } : null,
    locksAt: iso(card.nextKickoff),
    // Every open game is TBD: pickable, no clock (playLobby phaseOf).
    lockTbd: card.nextKickoff == null,
    complete: signedIn && pickedOpen >= pickable,
    progress: signedIn ? { done: picked, total } : null,
  };
}

export function draftItem(e, { home = null, next = null, round = null } = {}, { signedIn = true } = {}) {
  const base = common(e);
  // SIGNED OUT THE ROW STILL SHOWS (fri-2): no reader is needed to say what
  // the room asks first. The component sends its href through sign-in, then
  // on to /draft.
  if (!signedIn) return { ...base, title: 'The Draft', status: 'Sign in to draft', locksAt: null };
  if (!home) {
    if (!next?.opensAt) return null;
    return { ...base, title: `Week ${next.week} room`, status: 'Ranked room · 12 seats', opensAt: iso(next.opensAt), locksAt: null };
  }
  const b = { ...base, title: `Week ${home.week} room` };
  switch (home.state) {
    case 'settled':
      if (home.voidAll) return { ...b, settled: true, voidAll: true, status: VOID_ALL_LABEL, right: '—' };
      return { ...b, settled: true, status: home.played ? 'Final' : 'Final · no room', right: home.played && home.score != null ? Number(home.score).toFixed(1) : '—' };
    case 'locked':
      return { ...b, status: home.entered ? 'Roster in · scoring' : 'Locked', locksAt: null };
    case 'drafting':
      return { ...b, status: round != null ? `Round ${round} · your pick` : 'Drafting · your seat', cta: 'BACK TO ROOM',
        at: { iso: iso(home.locksAt), words: 'locks' }, locksAt: iso(home.locksAt), right: round != null ? `R${round}` : 'LIVE' };
    case 'waiting':
      return { ...b, status: 'Roster in · waiting for lock', at: { iso: iso(home.locksAt), words: 'locks' },
        locksAt: iso(home.locksAt), complete: true, right: '✓' };
    default:
      return { ...b, status: 'Ranked room · 12 seats', at: { iso: iso(home.locksAt), words: 'locks' },
        locksAt: iso(home.locksAt), complete: false };
  }
}

export function octoberItem(e, s, { signedIn = false, now } = {}) {
  if (!s?.contest) return null;
  const c = s.contest;
  const preview = c.meta?.preview === true;
  const base = { ...common(e), title: 'Five a day', groupNote: preview ? 'Preview' : 'Postseason' };
  if (c.settled && isVoidAll(c)) return { ...base, settled: true, voidAll: true, status: VOID_ALL_LABEL, right: '—' };
  if (c.settled) return { ...base, settled: true, status: 'Final', right: s.filled ? `${s.filled} / ${s.size}` : '—' };
  const next = nextBoardKick(c.board, now);
  const games = c.meta?.games ?? (c.board ?? []).length;
  if (!next) {
    return { ...base, status: `${plural(games, 'game')} · today's card is locked`, locksAt: null,
      progress: signedIn ? { done: s.filled, total: s.size } : null };
  }
  return {
    ...base,
    status: signedIn ? `${s.filled} of ${s.size} picked` : `${plural(games, 'game')} today`,
    at: { iso: next, words: 'next lock' },
    locksAt: next,
    complete: signedIn && s.filled >= s.size,
    progress: signedIn ? { done: s.filled, total: s.size } : null,
    cta: signedIn && s.filled > 0 ? 'FINISH CARD' : e.cta,
  };
}

export function runItem(e, s, { signedIn = false } = {}) {
  if (!s?.contest) return null;
  const c = s.contest;
  const label = c.meta?.label ?? 'Round';
  const base = { ...common(e), title: label, groupNote: c.meta?.preview === true ? 'Preview' : 'Postseason' };
  if (c.settled && isVoidAll(c)) return { ...base, settled: true, voidAll: true, status: VOID_ALL_LABEL, right: '—' };
  if (c.settled) return { ...base, settled: true, status: `${label} · final`, right: '—' };
  const next = s.next?.kickoffAt ? iso(s.next.kickoffAt) : null;
  if (!next) {
    return { ...base, status: `${label} · locked`, locksAt: null, progress: signedIn ? { done: s.filled, total: s.size } : null };
  }
  return {
    ...base,
    status: signedIn ? `${s.filled} of ${s.size} set` : `${label} · nine a round`,
    at: { iso: next, words: 'next lock' },
    locksAt: next,
    complete: signedIn && s.filled >= s.size,
    progress: signedIn ? { done: s.filled, total: s.size } : null,
  };
}

export function seriesItem(e, s, { signedIn = false, now } = {}) {
  if (!s?.contest) return null;
  // TBD-AWARE: s.lock (roundLockFor) says whether the round is locked and what
  // a countdown may aim at (null while the first pitch is TBD - open, no clock).
  const lock = s.lock ? s.lock.locksAt : s.contest.locks_at;
  const open = s.lock ? !s.lock.locked : ms(lock) > new Date(now).getTime();
  const base = { ...common(e), title: s.label };
  if (!open) {
    return { ...base, status: `${s.label} · picks locked`, locksAt: null, progress: signedIn ? { done: s.picked, total: s.total } : null };
  }
  return {
    ...base,
    status: signedIn ? `${s.picked} of ${s.total} series picked` : `${s.total} series to call`,
    at: lock ? { iso: iso(lock), words: 'locks' } : null,
    locksAt: lock ? iso(lock) : null,
    lockTbd: !lock,
    complete: signedIn && s.picked >= s.total,
    progress: signedIn ? { done: s.picked, total: s.total } : null,
  };
}

export function nbaPickemItem(e, { st = null, plan = null } = {}, { signedIn = false } = {}) {
  const base = common(e);
  if (!st) {
    if (!plan?.opensAt) return null;
    const n = (plan.board ?? []).length;
    return { ...base, title: 'Next slate', status: `Daily · ${plural(n, 'game')}`, opensAt: iso(plan.opensAt), locksAt: null };
  }
  const b = { ...base, title: 'Tonight', groupNote: `Tonight · ${plural(st.games, 'game')}` };
  if (st.settled) {
    return { ...b, settled: true, status: st.score != null
        ? (st.maxPoints != null ? `Settled · ${st.score} of ${st.maxPoints}` : `Settled · ${st.score} of ${st.max ?? st.games} right`)
        : `${plural(st.games, 'game')} · settled`,
      right: st.score != null ? `${st.score}/${st.maxPoints ?? st.max ?? st.games}` : '—' };
  }
  if (st.pickable > 0) {
    return {
      ...b,
      status: signedIn ? `${st.pickedOpen} of ${st.pickable} picked` : `Daily · ${plural(st.games, 'game')}`,
      at: { iso: iso(st.nextTip), words: 'next lock' },
      locksAt: iso(st.nextTip),
      complete: signedIn && st.pickedOpen >= st.pickable,
      progress: signedIn ? { done: st.pickedOpen, total: st.pickable } : null,
    };
  }
  return { ...b, status: `${plural(st.games, 'game')} · all tipped${signedIn && st.picked ? ` · ${st.picked} picked` : ''}`, locksAt: null };
}

export function sixItem(e, { st = null, plan = null } = {}, { signedIn = false } = {}) {
  const base = common(e);
  if (!st) {
    if (!plan?.opensAt) return null;
    return { ...base, title: 'Next slate', status: 'Nightly lineup · G G F F C UTIL', opensAt: iso(plan.opensAt), locksAt: null };
  }
  const b = { ...base, title: 'Tonight', groupNote: `Tonight · ${plural(st.games, 'game')}` };
  if (st.nextTip) {
    return {
      ...b,
      status: signedIn ? `${st.filled} of ${st.size}` : 'G G F F C UTIL · locks at each tip',
      at: { iso: st.nextTip, words: 'next tip' },
      locksAt: st.nextTip,
      complete: signedIn && st.filled >= st.size,
      progress: signedIn ? { done: st.filled, total: st.size } : null,
    };
  }
  return { ...b, status: `${plural(st.games, 'game')} · all tipped${st.filled ? ` · ${st.filled} of ${st.size} in play` : ''}`,
    locksAt: null, progress: signedIn ? { done: st.filled, total: st.size } : null };
}

/**
 * GAME DRAFTS: one row for every open per-game board of the sport -
 * "Game Drafts · N of M" (fri-1 mock), never a row per game. Hidden while
 * DRAFT_GAME_BOARDS is off (the registry flag).
 */
export function draftGameItem(e, st, { signedIn = false } = {}) {
  if (!st) return null;
  return {
    ...common(e),
    title: 'Game Drafts',
    status: signedIn ? `Game Drafts · ${st.drafted} of ${st.open}` : `Game Drafts · ${plural(st.open, 'game')}`,
    at: st.nextLock ? { iso: iso(st.nextLock), words: 'next lock' } : null,
    locksAt: st.nextLock ? iso(st.nextLock) : null,
    complete: signedIn && st.drafted >= st.open,
    progress: signedIn ? { done: st.drafted, total: st.open } : null,
  };
}

/**
 * EPL Weekly 5: each slot locks at its player's kickoff, so the NEXT kickoff
 * still ahead is the next lock (lib/eplWeekly5/rules.js lockedSlots).
 */
export function eplWeekly5Item(e, s, { signedIn = false } = {}) {
  if (!s?.contest) return null;
  const c = s.contest;
  const gw = gameweekLabel(c.week) ?? 'This gameweek';
  const base = { ...common(e), title: gw, groupNote: gw };
  if (c.settled) {
    return { ...base, settled: true, status: s.filled ? 'Final' : 'Final · no card', right: s.score != null ? `${s.score} pts` : '—' };
  }
  if (!s.nextKickoff) {
    return { ...base, status: `${gw} · in play`, locksAt: null, progress: signedIn ? { done: s.filled, total: s.size } : null };
  }
  return {
    ...base,
    status: signedIn ? `${s.filled} of ${s.size} picked` : 'Five players · one gameweek',
    at: { iso: s.nextKickoff, words: s.kicked ? 'next lock' : 'first lock' },
    locksAt: s.nextKickoff,
    complete: signedIn && s.filled >= s.size,
    progress: signedIn ? { done: s.filled, total: s.size } : null,
  };
}

export function dailyItem(e, d, { signedIn = false } = {}) {
  if (!d) return null;
  const base = { ...common(e), title: "Today's board" };
  if (d.state === 'none') return { ...base, status: 'No board today', locksAt: null };
  const at = d.closesAt ? { iso: iso(d.closesAt), words: 'closes' } : null;
  if (d.state === 'done') return { ...base, status: 'Played · see your grade', at, locksAt: iso(d.closesAt), complete: true, right: 'Done', cta: 'SEE GRADE' };
  if (d.state === 'in-progress') return { ...base, status: 'In progress', at, locksAt: iso(d.closesAt), right: 'Resume', cta: 'FINISH BOARD' };
  // 'play', and signed out 'signed-out': the board is open and unplayed.
  return { ...base, status: "Today's puzzle · 8 slots", at, locksAt: iso(d.closesAt), complete: false,
    right: signedIn ? 'Play' : null };
}

export function survivorItem(e, row) {
  if (!row) return null;
  // PULLED: only ever drawn with SURVIVOR=on. Its row's line is the old
  // grammar; it never counts as a move until it carries its own lock instant.
  return { ...common(e), title: 'Survivor', status: row.line ?? '', at: row.at ?? null, locksAt: null, right: row.right ?? null };
}

// ===========================================================================
// THE REGISTRY
// ===========================================================================
//
// Order inside a sport is the order here. The sport's place on the screen is
// decided by lib/games/playLobby.js (soonest open lock), never by this list.

// THE LETTER MARKS ARE UNIQUE PER GAME (sun-16 D). One mark names one game
// and one game wears one mark: Pick'em is P in all three of its sports, but no
// two DIFFERENT games share a letter. They did - D was both The Draft and The
// Daily, S both Series Pick'em and Survivor - which on a lobby that orders by
// lock, not by sport, put two different games behind the same letter a row
// apart. The Draft is 12 (its twelve seats; the You tab's season row already
// drew it so), Survivor is X (lose and you are out). playRegistry.test.mjs
// asserts the pairing both ways.
//
// `about` IS THE GAME'S ONE LINE, and /games/how-it-works prints it - the list
// on that page is generated from this array, so a game added here is a game
// the explainer names. `season` is the stretch of the year the game runs
// ('MM-DD' to 'MM-DD', wrapping the new year; null is every day): outside it
// the explainer marks the game SEASONAL. It is a calendar, NOT a board read -
// the explainer reads no database, by design (see its header). `flag` is the
// switch a pulled game hides behind: no flag is always listed.

const NFL_SEASON = Object.freeze({ from: '09-01', to: '02-15', words: 'September to February' });
const CFB_SEASON = Object.freeze({ from: '08-20', to: '01-25', words: 'August to January' });
const MLB_OCTOBER = Object.freeze({ from: '09-29', to: '11-05', words: 'the MLB postseason' });
const NBA_SEASON = Object.freeze({ from: '10-20', to: '06-25', words: 'October to June' });
const EPL_SEASON = Object.freeze({ from: '08-10', to: '05-31', words: 'August to May' });

export const PLAY_REGISTRY = Object.freeze([
  { key: 'nfl-weekly', sport: 'nfl', game: 'weekly', name: 'The Weekly', mark: 'W', href: '/weekly',
    cta: 'SET YOUR SIX', kicker: 'NFL · THE WEEKLY', read: weeklyState, item: weeklyItem,
    about: 'Six NFL players - QB, RB, WR, TE and two flex - one lineup a week. Open until the first kickoff.', season: NFL_SEASON },
  { key: 'nfl-pickem', sport: 'nfl', game: 'pickem', name: "Pick'em", mark: 'P', href: '/pickem/nfl',
    cta: 'PICK GAMES', kicker: "NFL · PICK'EM", blurb: 'pick every game', read: pickemStateFor('nfl'), item: pickemItem,
    about: 'Call every NFL game on the board, straight up. The line is shown, never required.', season: NFL_SEASON },
  { key: 'nfl-draft', sport: 'nfl', game: 'draft', name: 'The Draft', mark: '12', href: '/draft',
    cta: 'TAKE A SEAT', kicker: 'NFL · THE DRAFT', read: draftStateRead, item: draftItem,
    about: 'Eight rounds against the room. Best ball, one week.', season: NFL_SEASON },
  { key: 'nfl-draft-game', sport: 'nfl', game: 'draft_game', name: 'Game Drafts', mark: '1G', href: '/draft/game',
    cta: 'DRAFT A GAME', kicker: 'NFL · GAME DRAFTS', read: draftGameState, item: draftGameItem,
    about: 'Draft one game. Four drafters, four picks each. Your best three score. Over when the game ends.', season: NFL_SEASON, flag: draftGameOn },
  { key: 'nfl-survivor', sport: 'nfl', game: 'survivor', name: 'Survivor', mark: 'X', href: '/survivor',
    cta: 'PICK A TEAM', kicker: 'NFL · SURVIVOR', read: survivorState, item: survivorItem,
    about: 'One NFL team a week. Never the same one twice. Lose and you are out.', season: NFL_SEASON, flag: survivorOn },
  { key: 'cfb-pickem', sport: 'cfb', game: 'pickem', name: "Pick'em", mark: 'P', href: '/pickem/cfb',
    cta: 'PICK GAMES', kicker: "CFB · PICK'EM", blurb: 'Top 25 Saturday', read: pickemStateFor('cfb'), item: pickemItem,
    about: "Call the Top 25's Saturday games, straight up.", season: CFB_SEASON },
  { key: 'mlb-october', sport: 'mlb', game: 'october', name: 'October', mark: 'O', href: '/october',
    cta: 'PICK FIVE', kicker: 'MLB · OCTOBER', read: octoberState, item: octoberItem,
    about: "Five players a day from that day's postseason games. Use one and he is gone for October.", season: MLB_OCTOBER },
  { key: 'mlb-run', sport: 'mlb', game: 'run', name: 'The Run', mark: 'R', href: '/run',
    cta: 'SET YOUR NINE', kicker: 'MLB · THE RUN', read: runState, item: runItem,
    about: 'Two arms and seven bats from the clubs still alive, a round at a time. Anyone you use is gone.', season: MLB_OCTOBER },
  { key: 'mlb-series', sport: 'mlb', game: 'pickem', name: "Series Pick'em", mark: 'S', href: '/pickem/mlb',
    cta: 'PICK SERIES', kicker: "MLB · SERIES PICK'EM", read: seriesState, item: seriesItem,
    about: 'Call the winner of every series in the round. Picks lock when the round starts.', season: MLB_OCTOBER },
  { key: 'nba-pickem', sport: 'nba', game: 'pickem', name: "Pick'em", mark: 'P', href: '/pickem/nba',
    cta: 'PICK GAMES', kicker: "NBA · PICK'EM", read: nbaPickemState, item: nbaPickemItem,
    about: "Call every game on the night's NBA slate, straight up. Each locks at its tip.", season: NBA_SEASON },
  { key: 'nba-six', sport: 'nba', game: 'six', name: "Tonight's Six", mark: '6', href: '/six',
    cta: 'SET YOUR SIX', kicker: "NBA · TONIGHT'S SIX", read: sixState, item: sixItem,
    about: 'Six NBA players for one night - two guards, two forwards, a center and a utility. Each locks at its tip.', season: NBA_SEASON },
  { key: 'epl-weekly-5', sport: 'epl', game: 'epl_weekly_5', name: 'EPL Weekly 5', mark: '5', href: '/epl-weekly-5',
    cta: 'PICK FIVE', kicker: 'EPL · WEEKLY 5', read: eplWeekly5State, item: eplWeekly5Item,
    about: 'Five Premier League players a gameweek. Each pick locks at its kickoff.', season: EPL_SEASON },
  { key: 'daily', sport: 'all', game: 'daily', name: 'The Daily', mark: 'D', href: DAILY_V2_PATH,
    cta: 'PLAY TODAY', kicker: 'ALL SPORTS · THE DAILY', read: dailyState, item: dailyItem,
    about: 'Twelve teams from one past NFL season. Fill eight slots in three minutes.', season: null },
]);

/**
 * THE GAMES A READER CAN BE TOLD ABOUT: every entry whose flag (if it has one)
 * is on. Survivor is the only flagged entry; with SURVIVOR off it is not
 * listed anywhere, the explainer included. PURE given `env`.
 */
export function listedGames(registry = PLAY_REGISTRY, env = process.env) {
  return registry.filter((e) => typeof e.flag !== 'function' || e.flag(env));
}


/**
 * EVERY ITEM, for one reader. Each entry's read runs once, in parallel, and is
 * caught to no item - a failed read ghosts its own game, never the page.
 *
 * @param ctx { uid, now, v2 } - v2 is lobbyV2()'s view, read once by the caller
 */
export async function readPlayItems({ uid = null, now = new Date(), v2 = null } = {}, registry = PLAY_REGISTRY) {
  const ctx = { uid: uid == null ? null : Number(uid), now: new Date(now), v2, memo: {} };
  const signedIn = ctx.uid != null;
  const per = await Promise.all(registry.map(async (e) => {
    try {
      const state = await e.read(ctx);
      const out = e.item(e, state, { signedIn, now: ctx.now });
      return (Array.isArray(out) ? out : [out]).filter(Boolean);
    } catch {
      return [];
    }
  }));
  return per.flat();
}

/**
 * The next real fixture per sport, for the chip rule: the earliest kickoff in
 * [now, now + 14 days], or a game live now. One query over matches.
 * @returns {Promise<Record<string, string>>} sport -> ISO
 */
export async function nextGameBySport({ now = new Date() } = {}) {
  const from = new Date(now).toISOString();
  const to = new Date(new Date(now).getTime() + 14 * 24 * 3_600_000).toISOString();
  const rows = await sql`
    SELECT l.slug, min(m.kickoff_at) AS at
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug IN ('nfl', 'cfb', 'mlb', 'nba', 'epl')
       -- LIVE ONLY IF IT STARTED TODAY: a row stuck at 'live' from March is a
       -- feed fault, not a game in the next fourteen days (DEV has four).
       AND ((m.kickoff_at >= ${from}::timestamptz AND m.kickoff_at <= ${to}::timestamptz)
         OR (m.status = 'live' AND m.kickoff_at > ${from}::timestamptz - interval '12 hours'))
     GROUP BY l.slug`;
  return Object.fromEntries(rows.map((r) => [r.slug, iso(r.at)]));
}
