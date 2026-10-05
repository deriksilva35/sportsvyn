// lib/games/dailyBanner.js - THE DAILY BANNER on the Play lobby (mon-2), PURE.
//
// The Daily left YOUR MOVE and the ALL SPORTS card (lib/games/playLobby.js
// isBannerItem) for a banner of its own, right under PLAY and the date. This
// file decides what the banner says from facts the lobby already read
// (lib/games/lobbyV2.js: dailyV2Home and the streak; lib/games/lobbyV3.js adds
// today's finished field once the reader has finished). No read, no clock of
// its own: `now` is passed.
//
// TWO STATES.
//   before  not played (signed out, unplayed, or started and not finished):
//           the pitch, the streak, PLAY - and "N played today" once N >= 25
//   after   the reader's run is finished: the score, BEAT N%, #rank of N,
//           SHARE + SEE BOARD, the streak, the countdown to the next board
//
// WHAT THE AFTER STATE MAY SAY WHILE THE DAY IS OPEN is lib/daily/openReveal.js's
// rule (ruling 27 Sep, 1b): score, rank among finished runs, "you beat X%",
// the streak - and NOT pct, which is the score over the hidden ceiling and so
// gives the answer away. "% of perfect" is therefore drawn only for a board
// that has CLOSED (now >= closesAt); on today's open board it is left out.
//
// "BEAT N%" IS openReveal's beatPct, the same number the board page prints:
// the share of the OTHER finished runs today with a strictly lower score,
// rounded down, so a tie is never counted as a win. Null when nobody else has
// finished - the banner then says FIRST TO FINISH.

import { beatPct } from '../daily/openReveal.js';
import { pctOfCeiling } from '../daily/format.js';
import { DAILY_V2_PATH } from '../daily/boardShape.js';

/** "N played today" is drawn only from this many finishers up. */
export const PLAYED_FLOOR = 25;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const r1 = (n) => Math.round(Number(n) * 10) / 10;

/** 'YYYY-MM-DD' -> 'OCT 4'. The edition's own date (ET), not an instant. */
export function editionLabel(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/**
 * @param {object} p
 *   home      dailyV2Home(): { editionDate, board: {id, closesAt}|null, run, playingToday }
 *   live      the edition is live (isEditionLive) - a live edition with no row yet
 *             still gets its banner: the row is made on first read of /daily/board
 *   field     todayLeaderboard(board.id) rows, or null when not read
 *   streak    the reader's current streak (lobbyV2's), 0 when none
 *   userId    the reader, or null signed out
 *   now       the instant
 * @returns the banner view, or null when there is no edition to show
 */
export function dailyBanner({ home = null, live = false, field = null, streak = 0, userId = null, now = new Date() } = {}) {
  if (!home || (!home.board && !live)) return null;
  const signedIn = userId != null;
  const played = Number(home.playingToday) || 0;
  const base = {
    editionDate: home.editionDate ?? null,
    date: editionLabel(home.editionDate),
    href: DAILY_V2_PATH,
    streak: signedIn && Number(streak) > 0 ? Number(streak) : null,
  };
  const run = signedIn ? home.run : null;
  if (!run?.completedAt || run.score == null) {
    return {
      ...base,
      state: 'before',
      resume: Boolean(run?.startedAt),
      playedToday: played >= PLAYED_FLOOR ? played : null,
    };
  }
  const rows = Array.isArray(field) ? field : [];
  const score = r1(run.score);
  const mine = rows.find((r) => Number(r.userId) === Number(userId)) ?? null;
  const closesAt = home.board?.closesAt ? new Date(home.board.closesAt).toISOString() : null;
  const closed = closesAt != null && new Date(now).getTime() >= new Date(closesAt).getTime();
  const of = rows.length || played;
  return {
    ...base,
    state: 'after',
    score,
    beatPct: rows.length ? beatPct(rows.map((r) => r1(r.primary)), score) : null,
    rank: mine?.rank ?? null,
    of,
    // ONLY AFTER CLOSE (see the header): pct is the answer, before midnight.
    pctOfPerfect: closed ? pctOfCeiling(run.pct, 1) : null,
    // THE NEXT EDITION OPENS AS THIS ONE CLOSES: both are the same ET
    // midnight, computed once by ensureBoardForDate (opens_at of tomorrow =
    // closes_at of today), so the countdown reads today's row.
    nextAt: closed ? null : closesAt,
  };
}

/** The share text's caption: score, beat, rank, streak - never pct before close. */
export function bannerShareCaption(b) {
  if (!b || b.state !== 'after') return null;
  const bits = [`${b.score.toFixed(1)} pts`];
  if (b.pctOfPerfect) bits.push(`${b.pctOfPerfect} of perfect`);
  if (b.beatPct != null) bits.push(`beat ${b.beatPct}%`);
  if (b.rank != null) bits.push(`#${b.rank} of ${b.of}`);
  if (b.streak != null) bits.push(`streak ${b.streak}`);
  return [`The Daily · ${b.date ?? ''}`.trim(), bits.join(' · ')].join('\n');
}
