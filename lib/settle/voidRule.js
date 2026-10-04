// lib/settle/voidRule.js - THE VOID RULE for the MLB postseason games, PURE.
//
// Ruled sun-8 item 1: "THE RUN + OCTOBER void rule (same as rules-settle): a
// cancelled/postponed game not final at settles_at + 48h is void (scores 0,
// doesn't block)."
//
// SAME SEMANTICS AS lib/settle/footballRules.js on rules-settle (sat-5):
//   - BEFORE settles_at + 48h a game that is not final still blocks the
//     settle - a game that is merely late will be final by the next firing
//     and must count;
//   - AT OR AFTER that cutoff every game still not final is VOID: its players
//     score 0 and the settle proceeds on the rest;
//   - the void list is stored with the contest (contests.meta.void, match
//     ids) and never un-voided;
//   - a board on which EVERY game is void still refuses - that is an outage,
//     not a round.
//
// WHY A SEPARATE FILE. rules-settle is not merged; this branch builds on main
// and must not collide with footballRules.js. When both are in, footballRules
// should import VOID_GRACE_MS / voidCutoff / pastVoidCutoff / storedVoid from
// here (or the other way round) so the clock arithmetic lives once.

import { numbersOf } from '../util/scoresOf.js';

export const VOID_GRACE_MS = 48 * 3_600_000;

/** settles_at + 48h, or null when the contest carries no settles_at. */
export function voidCutoff(contest) {
  const t = contest?.settles_at == null ? NaN : new Date(contest.settles_at).getTime();
  return Number.isFinite(t) ? new Date(t + VOID_GRACE_MS) : null;
}

/** Has the void cutoff passed? `>=` at the boundary. No settles_at, no void. */
export function pastVoidCutoff(contest, now = new Date()) {
  const cut = voidCutoff(contest);
  return cut != null && new Date(now).getTime() >= cut.getTime();
}

/** The contest's stored void list (match ids), as numbers. */
export function storedVoid(contest) {
  const v = contest?.meta?.void;
  return Array.isArray(v) ? numbersOf(v) : [];
}

/**
 * May a board of games settle? PURE.
 *
 * @param games        [{ id, status, slug? }]
 * @param voidAllowed  pastVoidCutoff(contest, now)
 * @param voidNow      optional (game) => bool: a game whose own ruling
 *                     already voids before the cutoff (October's thu-26
 *                     not-played and 27 Sep postponed-72h rules). Such a game
 *                     never blocks and is in the void list.
 * @param stored       ids already voided (contests.meta.void) - kept void
 *                     even if the game has since gone final.
 * @returns {{ ready, reason?, remaining, waitingOn, void: number[] }}
 */
export function voidReadiness(games, { voidAllowed = false, voidNow = null, stored = [] } = {}) {
  const list = games ?? [];
  if (!list.length) return { ready: false, reason: 'no games', remaining: 0, waitingOn: [], void: [] };
  const already = new Set(numbersOf(stored));
  const voided = [];
  const blocking = [];
  for (const g of list) {
    const id = Number(g.id);
    if (already.has(id)) { voided.push(id); continue; }
    if (g.status === 'final') continue;
    if ((voidNow && voidNow(g)) || voidAllowed) { voided.push(id); continue; }
    blocking.push(g);
  }
  if (blocking.length) {
    return {
      ready: false, reason: 'games not final', remaining: blocking.length,
      waitingOn: blocking.map((g) => ({ id: g.id, slug: g.slug ?? null, status: g.status ?? 'scheduled' })),
      void: [],
    };
  }
  if (voided.length === list.length) {
    return { ready: false, reason: 'every game void', remaining: 0, waitingOn: [], void: [] };
  }
  return { ready: true, remaining: 0, waitingOn: [], void: voided };
}
