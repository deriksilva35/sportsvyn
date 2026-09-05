// lib/weekly/view.js - what the Weekly's surfaces render. PURE.
//
// THE STATE MACHINE IS THE DAILY'S, with the middles swapped. The Daily runs
// rules -> playing -> entered -> revealed on a three-minute clock; the Weekly
// runs rules -> building -> locked -> settled on a multi-day one. Same shape,
// same names where they mean the same thing, so the two surfaces cannot drift
// into different vocabularies for the same idea.

import { tierFor } from '../daily/reveal.js';
import { SLOTS, slotAccepts } from './rules.js';

export const SLOT_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', FLEX2: 'FLEX' };

// THE SIX-PIP ROW'S EMOJI (relay 2a item 6, mock's .prog .pip .em). The
// relay names these as "the Daily's EM map" - no such map exists anywhere
// in this codebase (components/daily/DailyRoom.js uses text SLOT_LABEL
// tags, never emoji). Flagged rather than invented from nothing: these are
// the mock's own literal glyphs, given a home here since the pip row and
// the .pr rows below both need the same one.
export const SLOT_EMOJI = { QB: '🎯', RB: '🏃', WR: '🤲', TE: '🦾', FLEX: '🔄', FLEX2: '🔄' };

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
  // {score, players} - the ceiling's stored shape as of relay D1's "weekly
  // ceiling at settle" ruling (lib/weekly/settle.js). Renamed from the raw
  // perfectLineup() return ({total, picks}) at the point of storage, so this
  // reader follows the stored name, not the computing function's own.
  const perfect = Number(contest?.perfect?.score ?? 0) || null;
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
    perfectPicks: contest?.perfect?.players ?? [],
    you: entry && !dnf
      ? {
        score: Number(entry.score),
        tier: tierFor(entry.score, perfect)?.label ?? null,
        // FROZEN AT SETTLE, NOT RECOMPUTED: entry.meta.pct is the exact
        // number lib/weekly/settle.js wrote against the ceiling it stored in
        // the same run. Falls back to the live tierFor() computation only
        // for an entry settled before this field existed.
        pct: entry.meta?.pct ?? tierFor(entry.score, perfect)?.pct ?? null,
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
export function poolRows(board, slot, query = '') {
  const q = normalizeQuery(query);
  return (board ?? [])
    .filter((p) => slotAccepts(slot, p.pos))
    .filter((p) => matchesQuery(p, q))
    .sort((a, b) => ppgOf(b.resume) - ppgOf(a.resume));
}

/**
 * THE FILTER IS SCOPED TO THE ACTIVE TAB, and that ordering is the ruling.
 * Searching "Allen" on the RB tab returns running backs named Allen and not
 * Josh Allen - the tab is the question and the query narrows it, rather than
 * the query throwing the reader into a mixed list where a pick would be illegal
 * for the slot they are filling. Filtering after slotAccepts is what enforces
 * it, so the order of those two calls is load-bearing.
 *
 * NAME ONLY. The resume line carries a college and a draft slot, and matching
 * them would mean typing "LSU" returns a list nobody asked for while typing a
 * player's name silently competes with every Clemson product. The reader is
 * looking for a person.
 */
function matchesQuery(p, q) {
  if (!q) return true;
  return normalizeQuery(p.name).includes(q);
}

/**
 * Lowercased, punctuation-stripped, whitespace-collapsed.
 *
 * DIACRITICS ARE FOLDED, because a reader on a phone keyboard types "Aiyuk" not
 * "Aiyuk" with the right accent, and an NFL roster is full of names they cannot
 * easily produce. NFD + combining-mark strip is the whole trick.
 *
 * PUNCTUATION GOES TOO: "Smith-Schuster" must be reachable by "smith schuster"
 * and "St. Brown" by "st brown", which is what anyone actually types.
 */
function normalizeQuery(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The leading PPG figure of a resume line as a number; -1 when there is none. */
function ppgOf(resume) {
  if (!resume) return -1;
  const n = Number.parseFloat(String(resume).split(' \u00b7 ')[0]);
  return Number.isFinite(n) ? n : -1;
}
