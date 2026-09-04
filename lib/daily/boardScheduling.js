// lib/daily/boardScheduling.js — how many DAYS the corpus can sustain, under
// the rules actually ruled on: teams may repeat across boards (the no-reuse
// law is within one board's own 12 slots, never across boards); what must
// stay unique is the BOARD AS A WHOLE; and a SEASON may not repeat within a
// 30-day window. PURE - no clock, the caller supplies "today" and history.

import { drawTeams } from './boardGenerator.js';

export const RECENCY_WINDOW_DAYS = 30;

/**
 * A board's identity for dedup purposes: the SET of drawn team keys, order-
 * independent (the shuffle that picked them is not part of what makes two
 * boards "the same"). Two boards with the same 12 teams in a different
 * shuffle order are still the same board.
 */
export function boardIdentity(teams) {
  return teams.map((t) => t.key).slice().sort().join('|');
}

/**
 * Draw up to `count` DISTINCT boards from one season (teams may repeat
 * ACROSS the returned boards - only an exact repeat of a whole 12-team set
 * is refused). PURE.
 *
 * Stops early, returning fewer than `count`, when either the season itself
 * cannot field a board at all (drawTeams refuses) or `attempts` tries run
 * out without finding a new distinct combination - the second case is the
 * evidence for "the combinatorial space is effectively unbounded": with a
 * healthy team count, collisions inside any realistic attempt budget should
 * be rare to nonexistent, and a caller sizing `attempts` generously and
 * still getting a collision-limited result has learned something real about
 * how small this particular season's pool actually is.
 */
export function drawDistinctBoards(teamCards, rng, { count, attempts = count * 50, teamCount } = {}) {
  const seen = new Set();
  const boards = [];
  let tries = 0;
  let seasonExhausted = false;
  while (boards.length < count && tries < attempts) {
    tries += 1;
    const draw = drawTeams(teamCards, rng, teamCount ? { teamCount } : undefined);
    if (!draw.ok) { seasonExhausted = true; break; }
    const id = boardIdentity(draw.teams);
    if (seen.has(id)) continue;
    seen.add(id);
    boards.push(draw);
  }
  return { boards, attempts: tries, seasonExhausted };
}

/**
 * Is `season` allowed on a day where the RECENT history (seasons used on the
 * immediately preceding days, oldest first or any order - only membership
 * within the trailing window matters) is `recentSeasons`? PURE.
 *
 * `recentSeasons` is expected to already be trimmed to the trailing
 * `windowDays` by the caller (see simulateSeasonSchedule) - this function
 * only checks membership, it does not know what "recent" means in terms of
 * real dates.
 */
export function seasonEligibleOn(season, recentSeasons, windowDays = RECENCY_WINDOW_DAYS) {
  void windowDays; // documents the contract; trimming is the caller's job
  return !recentSeasons.includes(season);
}

/**
 * Simulate a ONE-BOARD-PER-DAY schedule choosing a season each day from
 * `seasons`, never repeating a season within `windowDays` of its last use.
 * PURE - deterministic given `rng`, no wall clock anywhere.
 *
 * THE POINT OF THIS FUNCTION: with too few seasons for the recency window,
 * a daily schedule provably cannot run forever - this proves it by running
 * it, rather than asserting the arithmetic. Returns `sustainedDays` = how
 * many days were scheduled before every remaining season was still in its
 * cooldown on some day (stuck), or `days` itself if it never got stuck.
 */
export function simulateSeasonSchedule(seasons, { days = 365, windowDays = RECENCY_WINDOW_DAYS, rng } = {}) {
  const lastUsedDay = new Map();
  const order = [];
  for (let day = 0; day < days; day++) {
    const eligible = seasons.filter((s) => {
      const last = lastUsedDay.get(s);
      return last == null || (day - last) >= windowDays;
    });
    if (!eligible.length) return { sustainedDays: day, stuck: true, order };
    const pick = eligible[Math.floor(rng() * eligible.length)];
    lastUsedDay.set(pick, day);
    order.push(pick);
  }
  return { sustainedDays: days, stuck: false, order };
}
