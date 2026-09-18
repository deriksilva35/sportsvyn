// lib/games/nowCard.js - THE ONE THING TO DO NOW. PURE.
//
// ============================================================================
// WHY A SCREEN THAT LISTS FOUR GAMES STILL NEEDS THIS
// ============================================================================
// The lobby answers "what is there" well and "what should I do" not at all: a
// reader arriving at 9am has a graded Daily, an unplayed board, a room on the
// clock and a live lineup, all equally loud. The v3 mock leads with ONE card
// because on any given morning there is one answer, and the rest can wait one
// scroll.
//
// THE PRECEDENCE IS RULED, NOT INFERRED:
//
//   graded Daily overnight > an open Daily not yet played > on the clock in a
//   room > a live game of yours > graded week > nothing
//
// It reads as "what is finished and new", then "what is open and quick", then
// "what expires if you ignore it", then "what is happening", then "what
// happened". The one that expires sits third rather than first because a
// three-minute board is the cheaper thing to clear, and the room's own clock
// is already a deadline the room itself defends (turn_deadline_at, 105).
//
// PURE, OVER THE VIEW lobbyV2() ALREADY BUILDS. It reads nothing. That is what
// makes it impossible for the card to claim a state the rows underneath it do
// not have - R1's rule, enforced by construction rather than by review.
//
// FRESHNESS BREAKS TIES BETWEEN GRADED THINGS. Two results on one morning are
// ordered by their own timestamps, so "graded overnight" means overnight; a
// Daily graded four days ago is not the one thing to do now, and the card
// falls through to whatever is actually live.

/** The six, in precedence order. Exported so a test can assert the contract. */
export const NOW_KINDS = ['daily-graded', 'daily-open', 'draft-clock', 'live', 'week-graded', 'nothing'];

/** How recent a graded result has to be to still be "the thing to do now". */
export const FRESH_HOURS = 36;

const ms = (t) => {
  if (t == null) return null;
  const v = t instanceof Date ? t.getTime() : new Date(t).getTime();
  return Number.isFinite(v) ? v : null;
};
const hoursSince = (t, now) => {
  const a = ms(t); const b = ms(now);
  return a == null || b == null ? Infinity : (b - a) / 3_600_000;
};
const n1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);

/** Join the parts that exist. A missing number drops its clause, never prints 0. */
const line = (...parts) => parts.filter((p) => p != null && p !== '').join(' · ') || null;

/**
 * @param {object} v the lobby view: { daily, weekly, pickem, draft }
 * @param {{now?: string|Date}} opts
 * @returns {{kind, label, title, line, cta, href, done, at}}
 */
export function nowCard(v = {}, { now = new Date() } = {}) {
  const { daily = null, weekly = null, draft = null } = v ?? {};

  // ---- the two graded candidates, with their own timestamps ---------------
  // A RUN THAT IS DONE IS NOT A RESULT THAT IS IN. The board closes at
  // midnight ET and the grade is published then; a reader who finished this
  // morning is "done, waiting", which must not be announced as "graded
  // overnight". So the branch needs the close to be in the PAST - and that is
  // also what keeps a board closing tonight from reading as last night's.
  const dailyGradedAt = daily?.state === 'done' ? (daily.closesAt ?? null) : null;
  const dailyAge = hoursSince(dailyGradedAt, now);
  const dailyFresh = dailyGradedAt != null && dailyAge >= 0 && dailyAge <= FRESH_HOURS;
  const weekGradedAt = weekly?.state === 'settled' ? (weekly.settledAt ?? null) : null;
  const weekAge = hoursSince(weekGradedAt, now);
  const weekFresh = weekGradedAt != null && weekAge >= 0 && weekAge <= FRESH_HOURS * 4;

  // A GRADED DAILY LEADS ONLY IF IT IS THE FRESHEST GRADED THING. Otherwise
  // the week's result is, and it is ranked below the live states on purpose -
  // a result can wait, a clock cannot.
  const dailyLeadsGraded = dailyFresh
    && (!weekFresh || dailyAge <= hoursSince(weekGradedAt, now));

  if (dailyLeadsGraded) {
    const y = daily.stats?.find?.((s) => s.label === 'Yesterday')?.value ?? null;
    return {
      kind: 'daily-graded', label: 'Graded overnight',
      title: y != null ? `Your Daily · ${y}` : 'Your Daily is graded',
      line: line(daily.edition ?? null, daily.gradedLine ?? null),
      cta: 'See results', href: '/daily/board', done: true, at: dailyGradedAt,
    };
  }

  // ---- an open board: the cheapest thing on the screen to clear ----------
  if (daily && (daily.state === 'play' || daily.state === 'in-progress')) {
    return {
      kind: 'daily-open', label: 'Tonight',
      title: 'The Daily',
      // THE PRE-PLAY LINE NAMES NO SEASON (addendum 7 / the mock's own copy):
      // the season is the thing you are guessing at.
      line: line(daily.shape ?? null, daily.streakLine ?? null, 'season revealed when you start'),
      cta: daily.state === 'in-progress' ? 'Resume' : 'Play',
      href: '/daily/board', done: false, at: daily.closesAt ?? null,
    };
  }

  // ---- a turn that expires ------------------------------------------------
  if (draft?.onTheClock) {
    return {
      kind: 'draft-clock', label: 'On the clock',
      title: draft.pick ? `Your pick · ${draft.pick}` : 'Your pick',
      line: line(draft.roundsToGo != null ? `${draft.roundsToGo} round${draft.roundsToGo === 1 ? '' : 's'} to go` : null),
      cta: 'Draft', href: '/draft', done: false, at: draft.deadlineAt ?? null,
    };
  }

  // ---- something of yours is being played now -----------------------------
  if (weekly?.live) {
    const rank = weekly.rank != null && weekly.of != null ? `${weekly.rank}${ord(weekly.rank)} of ${weekly.of}` : null;
    return {
      kind: 'live', label: 'Live now',
      title: weekly.scored != null ? `Your Weekly · ${n1(weekly.scored)}` : 'Your Weekly',
      line: line(weekly.toPlay != null ? `${weekly.toPlay} to play` : null, rank),
      cta: 'Watch', href: '/weekly', done: false, at: null,
    };
  }

  // ---- what happened ------------------------------------------------------
  if (weekFresh) {
    const rank = weekly.rank != null && weekly.of != null ? `${weekly.rank}${ord(weekly.rank)} of ${weekly.of}` : null;
    return {
      kind: 'week-graded', label: 'Graded',
      title: weekly.week != null ? `Week ${weekly.week} is in` : 'Your week is in',
      line: line(rank, weekly.score != null ? String(n1(weekly.score)) : null),
      cta: 'See results', href: '/weekly', done: true, at: weekGradedAt,
    };
  }

  return {
    kind: 'nothing', label: 'All clear',
    title: 'Nothing open',
    line: 'Next board opens on its own schedule',
    cta: 'See the games', href: '/games', done: true, at: null,
  };
}

/** 1st / 2nd / 3rd / 4th - the suffix only, so a caller can build its own string. */
function ord(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v) % 100;
  if (a >= 11 && a <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][Math.min(Math.abs(v) % 10, 4)] ?? 'th';
}
