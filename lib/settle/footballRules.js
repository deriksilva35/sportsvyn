// lib/settle/footballRules.js - the football settle's three rulings, PURE.
//
// One home for the clock arithmetic the Weekly, The Draft and the football
// Pick'em boards share (sat-5, area A). Nothing here reads the database; the
// settles pass in the contest row and the game rows they already hold.
//
// ============================================================================
// THE VOID RULE (ruling 2)
// ============================================================================
// A game that is postponed, cancelled - or simply still not final - by the
// contest's settles_at + 48h is VOID. Its players score 0 (Weekly, Draft); its
// Pick'em pick counts for nobody and leaves perfect.max. Then the settle
// proceeds. BEFORE that cutoff nothing changes: the gate still refuses on a
// game that is not final, because a game that is merely late will be final by
// the next firing and must count.
//
// A void is decided ONCE, at settle, and stored with the contest. A
// re-grade never un-voids a game: a postponed game played a week later is a
// different week's football, and the board that voided it has already been
// read.
//
// ============================================================================
// THE RE-GRADE WINDOW (ruling 3)
// ============================================================================
// A stat or score correction that lands within 7 days of a game's kickoff
// re-grades the settled contests holding it. After that the game is FROZEN at
// what the contest stored - a correction to a game eight days old moves
// nothing, even if another game on the same board is still in its window.
//
// ============================================================================
// THE DRAFT COUNTS SIX (ruling D2)
// ============================================================================
// From NFL 2026 week 5 The Draft scores the best six of eight with NO extra
// drop-worst. Weeks before that settled under best-five and stand as settled.
// The Weekly keeps drop-worst.

import { numbersOf } from '../util/scoresOf.js';

export const VOID_GRACE_MS = 48 * 3_600_000;

/**
 * ALREADY-SETTLED CONTESTS STAND. The re-grade applies only to a contest
 * first settled on or after this instant - NFL 2026 week 5's Tuesday settle
 * week and every CFB board after it. Everything settled before it settled
 * under "settled is final" (17 Aug) and is never reopened.
 */
export const REGRADE_SETTLED_FROM = '2026-10-06T00:00:00Z';

/** May this settled contest be re-graded at all? */
export function regradeEligible(contest) {
  const t = contest?.settled_at == null ? NaN : new Date(contest.settled_at).getTime();
  return Number.isFinite(t) && t >= Date.parse(REGRADE_SETTLED_FROM);
}
export const REGRADE_WINDOW_MS = 7 * 24 * 3_600_000;

/** The first Draft week scored as six-of-eight. */
export const DRAFT_SIX_FROM = Object.freeze({ season: 2026, week: 5 });

/**
 * The instant after which an unfinished game is void, or null when the
 * contest carries no settles_at (no cutoff can be derived; the gate keeps
 * refusing and the stale alarm keeps paging).
 */
export function voidCutoff(contest) {
  const t = contest?.settles_at == null ? NaN : new Date(contest.settles_at).getTime();
  return Number.isFinite(t) ? new Date(t + VOID_GRACE_MS) : null;
}

/** Has the void cutoff passed? `>=` at the boundary. */
export function pastVoidCutoff(contest, now = new Date()) {
  const cut = voidCutoff(contest);
  return cut != null && new Date(now).getTime() >= cut.getTime();
}

/**
 * Is this game still inside its re-grade window? A game with no usable
 * kickoff is treated as frozen - a correction we cannot place in time is not
 * one we may apply.
 */
export function inRegradeWindow(kickoffAt, now = new Date()) {
  const t = kickoffAt == null ? NaN : new Date(kickoffAt).getTime();
  return Number.isFinite(t) && new Date(now).getTime() <= t + REGRADE_WINDOW_MS;
}

/** Does this Draft contest count six (no drop-worst)? Keyed on season/week. */
export function draftCountsSix(contest) {
  if (contest?.game_type !== 'draft') return false;
  const season = Number(contest.season_year);
  const week = Number(contest.week);
  if (!Number.isFinite(season) || !Number.isFinite(week)) return false;
  return season > DRAFT_SIX_FROM.season
    || (season === DRAFT_SIX_FROM.season && week >= DRAFT_SIX_FROM.week);
}

/** The contest's stored void list (match ids), as numbers. */
export function storedVoid(contest) {
  const v = contest?.meta?.void;
  return Array.isArray(v) ? numbersOf(v) : [];
}
