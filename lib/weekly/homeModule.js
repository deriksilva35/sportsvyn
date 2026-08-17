// lib/weekly/homeModule.js - the Weekly's module on the homepage.
//
// THE DAILY'S MODULE STATE MACHINE WITH ONE STATE ADDED, per the scope law.
// lib/daily/homeModule.js runs play -> receipt and returns null otherwise; this
// runs play -> building -> locked -> settled. The added state is `locked`, and
// the Daily could not have had it: the Daily's round opens and closes inside one
// day, so there is no interval where an entry is committed and unscoreable. The
// Weekly spends FOUR DAYS there - Thursday kickoff to Tuesday settle - and it is
// the state a returning reader is most likely to arrive in.
//
// THE VIEW IS BUILT HERE AND THE COMPONENT ONLY PRINTS IT, same reason as the
// Daily's: the homepage renders for signed-out strangers, so what is absent
// matters more than what is present, and absence is testable in a pure function
// and invisible inside JSX.
//
// WHAT THIS MODULE MAY CARRY THAT THE DAILY'S MAY NOT: the season and the week.
// The Daily hides them because they ARE the answer - a board with Peyton Manning
// on it is 2015 to anyone who looks. The Weekly's week is announced in advance;
// hiding "Week 1" would be hiding the headline, not the answer.
//
// WHAT IT MUST NEVER CARRY: anybody else's lineup, anybody else's score, or a
// score of any kind before the contest is settled. No score EXISTS before
// settle - contest_entries.score is null until then - so a pre-settle score on
// this surface would be an invention, not a leak. Both are refused below.

import { tierFor } from '../daily/reveal.js';
import { SLOTS } from './rules.js';

/**
 * Build the homepage view.
 *
 * @param {object} a
 * @param {object} a.contest the contests row (may be null)
 * @param {object} a.entry   this viewer's contest_entries row, or null
 * @param {Date}   a.now
 * @returns {object|null} null when the module must not render at all
 */
export function weeklyHomeView({ contest = null, entry = null, now = new Date() } = {}) {
  // NO BOARD, NO MODULE. An empty frame on the homepage is worse than no
  // module - the same ruling as the Daily's missing/pending days. This is also
  // what PROD renders until the first board is created.
  if (!contest) return null;
  if (new Date(contest.opens_at ?? NaN).getTime() > now.getTime()) return null;

  const base = {
    season: contest.season_year ?? null,
    week: contest.week ?? null,
    href: '/weekly',
  };

  const filled = SLOTS.filter((s) => entry?.lineup?.[s] != null).length;
  const locked = new Date(contest.locks_at ?? NaN).getTime() <= now.getTime();

  // ---- SETTLED -------------------------------------------------------------
  if (contest.settled) {
    const perfect = Number(contest.perfect?.total ?? 0) || null;
    // A DNF has no result to report, and a zero would be a lie - the same
    // ruling as yesterdayView(). It gets the perfect score as the yardstick.
    if (entry?.score == null) return { ...base, state: 'settled', played: false, perfect };
    const score = Number(entry.score);
    return {
      ...base,
      state: 'settled',
      played: true,
      score,
      perfect,
      tier: tierFor(score, perfect)?.label ?? null,
      pct: perfect ? Math.round((score / perfect) * 100) : null,
    };
  }

  // ---- LOCKED: committed, in flight, unscoreable ---------------------------
  // NO SCORE FIELD AT ALL, not a null one. Nothing has been scored yet, so
  // there is nothing for a component to print by accident.
  if (locked) return { ...base, state: 'locked', filled, entered: filled > 0 };

  // ---- BUILDING: an entry exists and the deadline has not passed -----------
  // The Daily's `receipt` reports a finished result. Its Weekly counterpart
  // reports UNFINISHED WORK, which is a different job: the number that matters
  // is how many slots are still empty, not a score that does not exist.
  if (entry && filled > 0) {
    return { ...base, state: 'building', filled, remaining: SLOTS.length - filled, locksAt: contest.locks_at };
  }

  // ---- PLAY: no entry, or an entry with nothing in it ----------------------
  return { ...base, state: 'play', locksAt: contest.locks_at };
}
