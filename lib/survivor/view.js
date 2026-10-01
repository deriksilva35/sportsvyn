// lib/survivor/view.js - what the room shows, as pure data. PURE, client-safe.
//
// The room renders what this returns and decides nothing: which team is yours,
// which are used (and in which week), which have kicked, what the path strip
// says, what the lock bar says. Every rule it leans on is lib/survivor/rules.js.

import { gameOpen, isPlaceholderKickoff } from './rules.js';

export const SURVIVOR_SEEN_COOKIE = 'sv_surv_seen';

/** "-7", "+3.5", "PK", or null with no line. */
export function spreadLabel(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Number(v);
  if (n === 0) return 'PK';
  return n > 0 ? `+${n}` : `${n}`;
}

/** The result mark on a path cell. */
export const RESULT_MARK = Object.freeze({ win: '✓', loss: '✗', survive: '–', missed: '✗', pending: '' });

/**
 * THE ROOM'S MODEL.
 *
 * @param rows    weekBoard().rows - favorites first
 * @param picks   entryWithPicks().picks - every week of this entry
 * @param entry   the entry, or null (not in yet)
 * @param week    the open week
 * @param entriesOpen  may a reader with no entry still join?
 */
export function roomModel({ rows = [], picks = [], entry = null, week = null, entriesOpen = true, now = new Date(), startWeek = null } = {}) {
  const current = picks.find((p) => p.week === week) ?? null;
  const usedIn = new Map();
  for (const p of picks) if (p.team_id != null && p.week !== week) usedIn.set(Number(p.team_id), p.week);
  const out = entry != null && (entry.eliminated_week != null || Number(entry.lives_left) <= 0);
  const pickLocked = current != null && (current.result !== 'pending'
    || !gameOpen({ status: current.status, kickoff_at: current.kickoff_at }, now));
  const closed = entry == null && !entriesOpen;

  const list = rows.map((r) => {
    const mine = current != null && Number(current.team_id) === Number(r.team_id);
    const tbd = isPlaceholderKickoff(r.kickoff_at);
    const kicked = !tbd && !gameOpen({ status: r.status, kickoff_at: r.kickoff_at }, now);
    const usedWeek = usedIn.get(Number(r.team_id)) ?? null;
    const state = mine ? 'mine' : usedWeek != null ? 'used' : tbd ? 'tbd' : kicked ? 'locked' : 'open';
    return {
      ...r, state, usedWeek, spreadLabel: spreadLabel(r.spread),
      disabled: state !== 'open' || out || pickLocked || closed,
    };
  });

  // THE PATH: every week from the start to the open one, oldest first.
  const path = [];
  if (week != null && startWeek != null) {
    for (let w = startWeek; w <= week; w += 1) {
      const p = picks.find((x) => x.week === w) ?? null;
      path.push({
        week: w, abbr: p?.abbr ?? (p?.result === 'missed' ? 'MISS' : null),
        result: p?.result ?? null, mark: p ? RESULT_MARK[p.result] ?? '' : '', auto: p?.auto === true,
        current: w === week,
      });
    }
  }

  // THE LOCK BAR'S ONE SENTENCE.
  let bar;
  if (out) bar = { kind: 'out', week: entry.eliminated_week };
  else if (closed) bar = { kind: 'closed' };
  else if (current && current.team_id == null) bar = { kind: 'missed' };
  else if (current && pickLocked) bar = { kind: 'locked', abbr: current.abbr };
  else if (current) bar = { kind: 'picked', abbr: current.abbr, kickoff_at: current.kickoff_at, auto: current.auto === true };
  else bar = { kind: 'none' };

  return { list, path, bar, out, pickLocked, closed, current };
}
