// lib/draft/view.js - what The Draft's surfaces render. PURE.
//
// THE WEEKLY'S STATE MACHINE WITH ONE STATE ADDED, per the scope law. The
// Weekly runs rules -> building -> locked -> settled; this runs
// rules -> drafting -> waiting -> locked -> settled.
//
// `drafting` IS THE ADDED STATE and the Weekly could not have had it: a weekly
// lineup is edited over days and every save is complete in itself, so there is
// no such thing as a half-finished session to return to. A draft room IS a
// session - eight rounds on a 30-second clock - and a player who reloads mid-
// draft must land back in the room, not on a rules page.
//
// `waiting` is the gap the Weekly calls `building` with six slots filled: the
// draft is done, the week has not locked, and there is nothing left to do.

import { tierFor } from '../daily/reveal.js';

/** @returns {'none'|'rules'|'drafting'|'waiting'|'locked'|'settled'} */
export function draftState({ contest = null, entry = null, draft = null, now = new Date() } = {}) {
  if (!contest) return 'none';
  if (contest.settled) return 'settled';
  const locked = new Date(contest.locks_at).getTime() <= now.getTime();
  if (locked) return 'locked';
  if (!entry) return 'rules';
  // An entry with no room behind it is an abandoned claim - the start was
  // consumed, so it cannot go back to `rules` and offer a second draft.
  if (draft?.status === 'in_progress') return 'drafting';
  return 'waiting';
}

/**
 * The seat-select front door.
 *
 * EVERY SEAT IS OFFERED, and the reason is that seat choice is the only
 * pre-draft decision a ranked player gets. The sim already lets you pick one;
 * hiding it here to "keep it simple" would remove the single lever that makes
 * two entries in the same week feel different.
 */
export function seatOptions(teamsCount) {
  const n = Number(teamsCount) || 0;
  return Array.from({ length: n }, (_, i) => ({
    seat: i + 1,
    label: `Pick ${i + 1}`,
    // Named because the shape of a snake draft is the whole trade, and a player
    // who has never drafted from the turn does not know it yet.
    note: i === 0 ? 'First overall, longest wait'
      : i === n - 1 ? 'Back-to-back at the turn'
        : null,
  }));
}

/**
 * The settled view: your best-ball six against the ceiling.
 *
 * THE CEILING IS A REAL ENTRY, NOT A DREAM TEAM (relay D1's ruling) - every
 * Draft entrant gets a DIFFERENT eight-player roster, so unlike the Weekly
 * there is no shared pool to build a theoretical best-lineup from. contest.
 * perfect is {score, entry_id, user_id, seat} of whoever's REAL roster scored
 * highest - no players list exists to show, so perfectPicks is always empty
 * here (the Weekly's own settledView still returns a real one). ceilingSeat
 * is exposed so the page can say something honest ("seat 4's roster") in
 * its place.
 */
export function draftSettledView({ contest, entry, board }) {
  const perfect = Number(contest?.perfect?.score ?? 0) || null;
  const ceilingSeat = contest?.perfect?.seat ?? null;
  const scored = board ?? contest?.board ?? [];
  const byId = new Map(scored.map((p) => [String(p.id), p]));
  const dnf = entry ? entry.meta?.dnf === true || entry.score == null : false;

  const roster = (entry?.meta?.roster ?? []).map((r) => {
    const p = byId.get(String(r.id));
    return { ...r, points: p ? Number(p.points) : null };
  });
  const started = new Set(Object.values(entry?.lineup ?? {}).map(String));

  return {
    season: contest?.season_year ?? null,
    week: contest?.week ?? null,
    perfect,
    ceilingSeat,
    perfectPicks: [],
    // The bench is shown because in best-ball it is the interesting part: the
    // points you left on it are the ones your draft did not need.
    roster: roster.map((r) => ({ ...r, started: started.has(String(r.id)) })),
    you: entry && !dnf
      ? {
        score: Number(entry.score),
        tier: tierFor(entry.score, perfect)?.label ?? null,
        pct: tierFor(entry.score, perfect)?.pct ?? null,
      }
      : null,
    dnf,
  };
}

/**
 * The homepage module's view.
 *
 * THE WEEKLY'S homeModule SHAPE, and it carries no score before settle for the
 * same reason: no score EXISTS before settle, so one here would be an invention
 * rather than a leak.
 */
export function draftHomeView({ contest = null, entry = null, draft = null, now = new Date() } = {}) {
  const state = draftState({ contest, entry, draft, now });
  if (state === 'none') return null;
  if (new Date(contest.opens_at ?? NaN).getTime() > now.getTime()) return null;

  const base = { season: contest.season_year ?? null, week: contest.week ?? null, href: '/draft' };
  const rounds = contest.meta?.config?.rosterSlots
    ? Object.values(contest.meta.config.rosterSlots).reduce((a, b) => a + b, 0)
    : null;

  if (state === 'settled') {
    // {score, entry_id, user_id, seat} - the ceiling's stored shape (relay D1).
    const perfect = Number(contest.perfect?.score ?? 0) || null;
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
  if (state === 'locked') {
    return { ...base, state: 'locked', entered: Boolean(entry?.meta?.roster?.length) };
  }
  // seat IS draft.pick_position - the games lobby's "Today's boards" row
  // (relay 2a item 4) names the seat directly rather than re-deriving it.
  if (state === 'drafting') return { ...base, state: 'drafting', rounds, locksAt: contest.locks_at, seat: draft?.pick_position ?? null };
  if (state === 'waiting') {
    return {
      ...base, state: 'waiting', picks: entry?.meta?.roster?.length ?? 0,
      locksAt: contest.locks_at, seat: draft?.pick_position ?? null,
    };
  }
  return { ...base, state: 'rules', rounds, locksAt: contest.locks_at };
}
