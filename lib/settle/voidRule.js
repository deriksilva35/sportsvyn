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
//   - a board on which EVERY game is void is not a round: it is CLOSED as
//     void (closeVoidAll below, ruling sun-10 item 4) - settled, no scores.
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
    // CLOSED AS VOID by the caller (closeVoidAll, ruling sun-10 item 4), never
    // settled as a round: `void` carries every id for the close to store.
    return { ready: false, reason: 'every game void', remaining: 0, waitingOn: [], void: voided };
  }
  return { ready: true, remaining: 0, waitingOn: [], void: voided };
}

// ============================================================================
// THE ALL-VOID CLOSE (ruling sun-10 item 4)
// ============================================================================
// "ALL-VOID boards (October day, Run preview, football boards via
// voidRule.js): close as VOID - status settled, meta.void_all = true, no
// scores, no ranks, streaks/DNF untouched, no settle push. Never 'refuse
// forever'."
//
// A board whose every game is void is not a round anybody played. It is
// CLOSED - settled, so no cron asks about it again - and marked
// meta.void_all = true with meta.void naming every game. Its entries are left
// exactly as they were: no score, no rank, no DNF. Every reader that turns a
// settled contest into a 0, a DNF, a streak day or a rank skips it
// (isVoidAll), and no settle push is sent for it.

/** Is this contest an all-void close? Reads the row's meta. */
export function isVoidAll(contest) {
  return contest?.meta?.void_all === true;
}

/**
 * THE LABEL EVERY SETTLED VIEW OF AN ALL-VOID BOARD SHOWS (ruling sun-11
 * item 1), in place of a score, a rank, a tier or a DNF: nobody played it.
 * One string, so the eight views that print it cannot drift apart.
 */
export const VOID_ALL_LABEL = 'Void - no games were played';

/**
 * The SQL predicate a reader adds to skip all-void closes, as text for the
 * readers that compose their own WHERE. Alias-qualified: pass the contests
 * alias the query uses. Tagged-template callers write the same predicate
 * inline - `NOT COALESCE((c.meta->>'void_all')::boolean, false)` - which is
 * the form lib/leagues/results.js and lib/settle/regrade.js already use.
 */
export function notVoidAllSql(alias = 'c') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`bad alias ${alias}`);
  return `NOT COALESCE((${alias}.meta->>'void_all')::boolean, false)`;
}

/**
 * The all-void close as a pure decision: given a refusal from a readiness
 * check, may the board close as VOID? Only past the cutoff (or when every
 * game is already void by its own ruling) and only for 'every game void'.
 */
export function closesVoidAll(readiness) {
  return readiness?.ready === false && readiness?.reason === 'every game void';
}

/**
 * Close one contest as VOID. `sql` is the caller's driver (lib/db.js).
 * Idempotent and guarded by NOT settled; meta is merged at its top-level keys
 * only, and only onto an object (never `||` onto an array). Entries are not
 * touched. Returns whether this call closed it.
 */
export async function closeVoidAll(sql, contestId, voidIds = []) {
  const ids = [...new Set(numbersOf(voidIds))].sort((a, b) => a - b);
  const rows = await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           meta = CASE WHEN jsonb_typeof(COALESCE(meta, '{}'::jsonb)) = 'object'
                       THEN COALESCE(meta, '{}'::jsonb)
                            || jsonb_build_object('void_all', true, 'void', ${JSON.stringify(ids)}::jsonb)
                       ELSE meta END
     WHERE id = ${contestId} AND NOT settled
     RETURNING id`;
  return { closed: rows.length > 0, void: ids };
}
