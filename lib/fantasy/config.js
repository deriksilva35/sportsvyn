// lib/fantasy/config.js — pure draft-config validation, rounds derivation, and
// ADP-pool mapping. NO DB, NO React (same testability contract as roster.js /
// engine.js). The setup screen produces a config object; the server validates it
// HERE before persisting a draft_configs row, and maps it to the nearest snapshot
// pool. Everything a client sends is untrusted — bounds + enums are enforced here,
// never in the browser.

import { STARTER_ORDER, BENCH } from './roster.js';

// The four scoring tokens the DB CHECK constraint accepts (migration 046). 2QB is
// a roster axis scored as PPR (see scoring.js), not a distinct point system.
export const SCORING_FORMATS = ['ppr', 'half-ppr', 'standard', '2qb'];
export const SCORING_LABEL = { ppr: 'PPR', 'half-ppr': 'HALF', standard: 'STD', '2qb': '2QB' };

// null clock = no timer. 30/60/90 are the offered pick clocks.
export const CLOCK_OPTIONS = [30, 60, 90, null];

export const TEAMS_MIN = 8;
export const TEAMS_MAX = 16;
// Free (preset) drafts top out at 12 teams; 14/16 is a member unlock.
export const FREE_TEAMS_MAX = 12;

// Slot keys the console can set, and their per-slot count bounds. SUPERFLEX is a
// member unlock; it renders through roster.js's arbitrary-key path already.
export const SLOT_KEYS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'DST', 'K', BENCH];
export const SLOT_BOUNDS = {
  QB: [0, 4], RB: [0, 8], WR: [0, 8], TE: [0, 4], FLEX: [0, 4],
  SUPERFLEX: [0, 2], DST: [0, 3], K: [0, 3], [BENCH]: [0, 14],
};

// A drafted roster must have at least one starter and a sane total length so
// teams*rounds stays inside a real ADP pool.
export const ROUNDS_MIN = 1;
export const ROUNDS_MAX = 30;

const isInt = (n) => Number.isInteger(n);

// Total picks per team = every slot count summed (starters + bench). Rounds is
// NEVER stored — it is always this derivation (matches engine.js / drafts.js).
export function deriveRounds(rosterSlots) {
  return Object.values(rosterSlots ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

// Starters = every non-bench slot. Used for the "at least one starter" floor.
export function starterCount(rosterSlots) {
  return Object.entries(rosterSlots ?? {})
    .filter(([k]) => k !== BENCH)
    .reduce((a, [, v]) => a + (Number(v) || 0), 0);
}

/**
 * Validate a client-supplied config. Returns { ok: true, config } with a
 * normalized config (only known slot keys, ints), or { ok: false, reason, detail }.
 * reason is always 'invalid_config'; detail names the offending field.
 */
export function validateConfig(input) {
  const bad = (detail) => ({ ok: false, reason: 'invalid_config', detail });
  if (!input || typeof input !== 'object') return bad('config');

  const teamsCount = Number(input.teamsCount);
  if (!isInt(teamsCount) || teamsCount < TEAMS_MIN || teamsCount > TEAMS_MAX) return bad('teamsCount');

  const scoringFormat = input.scoringFormat;
  if (!SCORING_FORMATS.includes(scoringFormat)) return bad('scoringFormat');

  const clockSeconds = input.clockSeconds == null ? null : Number(input.clockSeconds);
  if (!CLOCK_OPTIONS.includes(clockSeconds)) return bad('clockSeconds');

  // Board: only market ADP is live. Sportsvyn board ships with the August
  // rankings — reject it rather than silently persisting an unbuildable mode.
  if (input.board != null && input.board !== 'market_adp') return bad('board');

  const slotsIn = input.rosterSlots;
  if (!slotsIn || typeof slotsIn !== 'object') return bad('rosterSlots');
  const rosterSlots = {};
  for (const [k, v] of Object.entries(slotsIn)) {
    if (!SLOT_KEYS.includes(k)) return bad(`slot:${k}`);
    const n = Number(v);
    const [lo, hi] = SLOT_BOUNDS[k];
    if (!isInt(n) || n < lo || n > hi) return bad(`slot:${k}`);
    if (n > 0) rosterSlots[k] = n; // drop zero slots so rounds/labels stay clean
  }

  if (starterCount(rosterSlots) < 1) return bad('starters');
  const rounds = deriveRounds(rosterSlots);
  if (rounds < ROUNDS_MIN || rounds > ROUNDS_MAX) return bad('rounds');

  return { ok: true, config: { teamsCount, scoringFormat, clockSeconds, rosterSlots } };
}

/**
 * Which member gates a config trips (for UI messaging). The SERVER rule is
 * simpler — any custom (non-preset) config requires membership — but the UI uses
 * this to explain WHICH knob is locked.
 */
export function configLocks(config) {
  const slots = config?.rosterSlots ?? {};
  return {
    oversize: Number(config?.teamsCount) > FREE_TEAMS_MAX,
    superflex: (Number(slots.SUPERFLEX) || 0) > 0,
  };
}

// Roster tokens for the live ticker: e.g. ['QB','RB2','WR2','TE','FLEX','DST','K','BN6'].
// Numbered only where count > 1 (a lone TE stays 'TE'); bench always shows its count.
export function rosterTokens(rosterSlots) {
  const tokens = [];
  const push = (key) => {
    const n = Number(rosterSlots?.[key]) || 0;
    if (n <= 0) return;
    if (key === BENCH) tokens.push(`BN${n}`);
    else tokens.push(n > 1 ? `${key}${n}` : key);
  };
  for (const key of STARTER_ORDER) push(key);
  for (const key of Object.keys(rosterSlots ?? {})) {
    if (!STARTER_ORDER.includes(key) && key !== BENCH) push(key);
  }
  push(BENCH);
  return tokens;
}

/**
 * Pick the ADP pool snapshot nearest to a desired (scoringFormat, teamsCount).
 * Scoring is matched FIRST (an exact scoring format is more important than team
 * count for ADP shape); among same-scoring pools the closest team size wins, ties
 * to the LARGER size. Falls back across scorings only if the desired scoring has
 * no pool at all.
 *
 * @param {{scoringFormat:string, teamsCount:number}} desired
 * @param {Array<{scoringFormat:string, teamsCount:number}>} pairs  available snapshot pairs
 * @returns {{pair, exact, scoringExact}|null} null when no pools exist at all
 */
export function nearestPoolPair(desired, pairs) {
  if (!pairs?.length) return null;
  const byCloseness = (list) =>
    [...list].sort((a, b) => {
      const da = Math.abs(a.teamsCount - desired.teamsCount);
      const db = Math.abs(b.teamsCount - desired.teamsCount);
      if (da !== db) return da - db;
      return b.teamsCount - a.teamsCount; // tie -> larger pool
    })[0];

  const sameScoring = pairs.filter((p) => p.scoringFormat === desired.scoringFormat);
  if (sameScoring.length) {
    const pair = byCloseness(sameScoring);
    return {
      pair,
      scoringExact: true,
      exact: pair.teamsCount === desired.teamsCount,
    };
  }
  const pair = byCloseness(pairs);
  return { pair, scoringExact: false, exact: false };
}
