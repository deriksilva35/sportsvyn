// lib/weekly/rules.js - the Weekly's laws. PURE.
//
// ============================================================================
// THE LOCK LAW
// ============================================================================
// A lineup is editable from board-open until the week's FIRST kickoff, and
// then it is not. One lock moment, all six slots. A player who starts a
// Thursday-night player is carrying that risk knowingly - it is stated in the
// rules, and it is the same trade every real league makes.
//
// LOCKS_AT IS SNAPSHOTTED AT BOARD CREATION AND DOES NOT CHASE. If the
// Thursday game moves after the board opens, the deadline does not move with
// it. The deadline players planned around IS the deadline; a lock that slides
// forward silently steals time from anyone who set an alarm for it, and one
// that slides back locks people out early. Either direction breaks a promise
// we already made, so the promise wins over the schedule.
//
// THE SERVER ENFORCES IT, and the client is a courtesy. Same posture as the
// Daily's clock: a save is checked against locks_at read from the contest row,
// not against anything the browser sends.

import { SLOTS, slotAccepts } from '../daily/play.js';

export { SLOTS, slotAccepts };

/**
 * Is this save in time?
 *
 * NO GRACE PERIOD, and that is a real difference from the Daily. The Daily's
 * ten seconds cover a lock request travelling on a bad connection at the end
 * of a three-minute sprint. A weekly deadline has been visible since Tuesday;
 * somebody saving at the millisecond is not being failed by their network,
 * they are cutting it fine, and a grace window on a deadline days old is just
 * a later deadline nobody was told about.
 */
export function saveVerdict(locksAt, now = new Date()) {
  const t = new Date(locksAt ?? NaN).getTime();
  if (!Number.isFinite(t)) return { ok: false, reason: 'no lock time' };
  if (now.getTime() >= t) return { ok: false, reason: 'locked' };
  return { ok: true, msLeft: t - now.getTime() };
}

export const isLocked = (locksAt, now = new Date()) => !saveVerdict(locksAt, now).ok;

/**
 * Validate a lineup against the pool snapshot.
 *
 * PARTIAL LINEUPS ARE LEGAL BEFORE LOCK. This is a draft you come back to, so
 * saving four of six slots must work; only the shape of what IS filled is
 * checked. Completeness is a question asked at settle, not at save.
 */
export function validateLineup(lineup, pool, { requireComplete = false } = {}) {
  const errors = [];
  const byId = new Map((pool ?? []).map((p) => [p.id, p]));
  const seen = new Set();

  for (const slot of SLOTS) {
    const id = lineup?.[slot];
    if (id == null) {
      if (requireComplete) errors.push(`${slot}: empty`);
      continue;
    }
    const p = byId.get(id);
    if (!p) { errors.push(`${slot}: not in this week's pool`); continue; }
    if (!slotAccepts(slot, p.pos)) { errors.push(`${slot}: a ${p.pos} cannot fill ${slot}`); continue; }
    if (seen.has(id)) { errors.push(`${slot}: ${p.name} is already in the lineup`); continue; }
    seen.add(id);
  }
  const extra = Object.keys(lineup ?? {}).filter((k) => !SLOTS.includes(k));
  if (extra.length) errors.push(`unknown slot: ${extra.join(', ')}`);

  return { ok: errors.length === 0, errors, filled: seen.size };
}

/** Strip anything that is not a known slot pointing at a pool id. */
export function normalizeLineup(lineup, pool) {
  const byId = new Set((pool ?? []).map((p) => p.id));
  const out = {};
  const seen = new Set();
  for (const slot of SLOTS) {
    const id = lineup?.[slot];
    if (id == null || !byId.has(id) || seen.has(id)) continue;
    out[slot] = id;
    seen.add(id);
  }
  return out;
}

// ============================================================================
// THE SETTLE GATE
// ============================================================================
/**
 * Is this week complete enough to settle?
 *
 * REFUSE RATHER THAN SETTLE WRONG. A week settled while one game's stat lines
 * are missing produces a perfect lineup that is not perfect and scores that
 * are quietly low for anyone who started a player from that game. It is
 * unnoticeable and permanent - nobody re-reads a leaderboard from Tuesday - so
 * the job's default has to be to do nothing and say why.
 *
 * TWO CONDITIONS, BOTH REQUIRED:
 *   every game in the week is final, AND
 *   every final game has at least one stat line
 * The second is the one that matters: BDL has never delivered an NFL stat line
 * in season - the entire 2015-2025 corpus was backfilled in one pass on
 * 2026-07-20 - so the first real evidence of its in-season behaviour arrives
 * the Tuesday after Week 1. Until then "the games are final" tells us nothing
 * about whether the numbers landed.
 *
 * @param {Array} games [{ id, label, status, statLines }]
 */
export function settleReadiness(games) {
  const list = games ?? [];
  if (!list.length) return { ready: false, reason: 'no games', missing: [] };

  const notFinal = list.filter((g) => g.status !== 'final');
  const noStats = list.filter((g) => g.status === 'final' && !(Number(g.statLines) > 0));

  if (notFinal.length || noStats.length) {
    return {
      ready: false,
      reason: notFinal.length ? 'games not final' : 'stat lines missing',
      // NAMED, not counted. "3 games incomplete" sends somebody to a query;
      // the labels send them to the game.
      missing: [
        ...notFinal.map((g) => ({ id: g.id, label: g.label, why: `status=${g.status}` })),
        ...noStats.map((g) => ({ id: g.id, label: g.label, why: 'final, no stat lines' })),
      ],
    };
  }
  return { ready: true, games: list.length, missing: [] };
}
