// lib/weekly/view.js - what the Weekly's surfaces render. PURE.
//
// THE STATE MACHINE IS THE DAILY'S, with the middles swapped. The Daily runs
// rules -> playing -> entered -> revealed on a three-minute clock; the Weekly
// runs rules -> building -> locked -> settled on a five-day one. Same shape,
// same names where they mean the same thing, so the two surfaces cannot drift
// into different vocabularies for the same idea.

import { tierFor } from '../daily/reveal.js';
import { SLOTS, slotAccepts } from './rules.js';

/**
 * @returns {'none'|'rules'|'building'|'locked'|'settled'}
 * `none` means there is no board at all - render nothing rather than an empty
 * frame, exactly as the Daily does before a day opens.
 */
export function weeklyState({ contest = null, entry = null, now = new Date() } = {}) {
  if (!contest) return 'none';
  if (contest.settled) return 'settled';
  if (new Date(contest.locks_at).getTime() <= now.getTime()) return 'locked';
  return entry ? 'building' : 'rules';
}

/** How long until the deadline, in the pieces a countdown needs. */
export function timeToLock(locksAt, now = new Date()) {
  const t = new Date(locksAt ?? NaN).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = t - now.getTime();
  if (ms <= 0) return { locked: true, ms: 0, days: 0, hours: 0, mins: 0, secs: 0 };
  const secs = Math.floor(ms / 1000);
  return {
    locked: false, ms,
    days: Math.floor(secs / 86400),
    hours: Math.floor((secs % 86400) / 3600),
    mins: Math.floor((secs % 3600) / 60),
    secs: secs % 60,
  };
}

/** The builder's own view of a lineup: one row per slot, filled or not. */
export function lineupRows(lineup, board) {
  const byId = new Map((board ?? []).map((p) => [p.id, p]));
  return SLOTS.map((slot) => {
    const p = byId.get(lineup?.[slot]);
    return { slot, id: p?.id ?? null, name: p?.name ?? null, pos: p?.pos ?? null, team: p?.team ?? null };
  });
}

/**
 * The settled view: your six against the perfect six.
 *
 * SAME TIERS, SAME PCT-OF-PERFECT as the Daily, from the same tierFor. That is
 * not laziness - it is what makes a Weekly PRO BOWLER worth the same three
 * season points as a Daily one, which the standings spine depends on.
 */
export function settledView({ contest, entry, board }) {
  const perfect = Number(contest?.perfect?.total ?? 0) || null;
  const scored = board ?? contest?.board ?? [];
  const byId = new Map(scored.map((p) => [p.id, p]));

  const dnf = entry ? entry.meta?.dnf === true || entry.score == null : false;
  const picks = entry
    ? SLOTS.map((slot) => {
      const p = byId.get(entry.lineup?.[slot]);
      return {
        slot, name: p?.name ?? null, pos: p?.pos ?? null, team: p?.team ?? null,
        points: p ? Number(p.points) : null,
        dropped: entry.meta?.droppedSlot === slot,
      };
    })
    : [];

  return {
    season: contest?.season_year ?? null,
    week: contest?.week ?? null,
    perfect,
    perfectPicks: contest?.perfect?.picks ?? [],
    you: entry && !dnf
      ? {
        score: Number(entry.score),
        tier: tierFor(entry.score, perfect)?.label ?? null,
        pct: tierFor(entry.score, perfect)?.pct ?? null,
        picks,
      }
      : null,
    dnf,
  };
}

/**
 * The pool rows for one slot tab, in the order they should be read.
 *
 * THIS IS THE ONE PLACE THE DAILY'S POOL UI COULD NOT BE ADOPTED UNCHANGED.
 * The Daily's board is 64 players - about a dozen per position tab - so the
 * order they arrive in does not matter, because you can see the whole tab at
 * once. The Weekly's board is every rostered skill player, measured at 1,269,
 * and activePool emits them ORDER BY np.id. That put 153 quarterbacks on the QB
 * tab in database-insertion order: Dak Prescott first, Patrick Mahomes third,
 * for no reason any player could infer. At 64 an arbitrary order is invisible;
 * at 1,269 it is the difference between a list and a haystack.
 *
 * Sorting by the column already on screen is the smallest fix that makes the
 * tab scannable, and it is PRESENTATION ONLY - no field was added to the board
 * and the frozen pool snapshot is untouched.
 *
 * A BLANK PPG SORTS LAST, NOT FIRST. A rookie with no career games has no
 * figure, and Number.parseFloat('') is NaN; left alone, NaN comparisons return
 * false and the sort would strand those rows wherever they happened to be. A
 * blank is not a zero, and it is certainly not a lead.
 */
export function poolRows(board, slot) {
  return (board ?? [])
    .filter((p) => slotAccepts(slot, p.pos))
    .sort((a, b) => ppgOf(b.resume) - ppgOf(a.resume));
}

/** The leading PPG figure of a resume line as a number; -1 when there is none. */
function ppgOf(resume) {
  if (!resume) return -1;
  const n = Number.parseFloat(String(resume).split(' \u00b7 ')[0]);
  return Number.isFinite(n) ? n : -1;
}
