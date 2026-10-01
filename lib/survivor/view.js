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

/** The NFL regular season's weeks - the path strip always draws all of them. */
export const NFL_REG_WEEKS = 18;

/** The cell state a pick's result maps to. */
const CELL_OF = Object.freeze({ win: 'won', loss: 'lost', missed: 'missed', survive: 'survive', pending: 'pending' });

/**
 * One past week's game, in one line: "WK 4 · NYG 24 - 17 DAL · W" - the PICKED
 * team first. A miss, a game not played and a game still to be graded each say
 * so in the same slot.
 */
export function weekDetail(p) {
  if (!p) return null;
  const head = `WK ${p.week}`;
  if (p.result === 'missed' || p.team_id == null) return `${head} · no pick · MISSED`;
  const mineHome = Number(p.team_id) === Number(p.home_team_id);
  const opp = mineHome ? p.away_abbr : p.home_abbr;
  if (p.result === 'survive') return `${head} · ${p.abbr} ${mineHome ? 'vs' : 'at'} ${opp ?? '?'} · not played · survived`;
  if (p.home_score == null || p.away_score == null || p.result === 'pending') {
    return `${head} · ${p.abbr} ${mineHome ? 'vs' : 'at'} ${opp ?? '?'}${p.result === 'pending' ? ' · not graded yet' : ''}`;
  }
  const mine = mineHome ? p.home_score : p.away_score;
  const theirs = mineHome ? p.away_score : p.home_score;
  const letter = p.result === 'win' ? 'W' : Number(mine) === Number(theirs) ? 'T' : 'L';
  return `${head} · ${p.abbr} ${mine} - ${theirs} ${opp ?? '?'} · ${letter}`;
}

/**
 * THE STRIP: weeks 1-18, each cell one of
 *   before   - before the reader's first week (or the pool's start): dimmed "—"
 *   won / lost / missed / survive / pending - a past week, from its pick
 *   current  - the open week: your pick's abbr, or "pick"
 *   future   - blank
 *   out      - a week after the reader was eliminated: dimmed "—"
 * A past week with a pick carries `detail` (weekDetail) for the tap.
 */
export function pathCells({ picks = [], week, firstWeek, entry = null, weeks = NFL_REG_WEEKS } = {}) {
  const first = firstWeek ?? week;
  const elim = entry?.eliminated_week ?? null;
  const cells = [];
  for (let w = 1; w <= weeks; w += 1) {
    const p = picks.find((x) => x.week === w) ?? null;
    let state; let label = null; let mark = '';
    if (w === week) {
      state = 'current';
      label = p?.team_id != null ? p.abbr : p?.result === 'missed' ? 'MISSED' : 'pick';
    } else if (w < first) {
      state = 'before'; label = '—';
    } else if (elim != null && w > elim) {
      state = 'out'; label = '—';
    } else if (w > week) {
      state = 'future';
    } else if (p) {
      state = CELL_OF[p.result] ?? 'pending';
      label = p.team_id != null ? p.abbr : 'MISSED';
      mark = RESULT_MARK[p.result] ?? '';
    } else {
      state = 'before'; label = '—';
    }
    cells.push({ week: w, state, label, mark, current: w === week, detail: p && w !== week ? weekDetail(p) : null });
  }
  return cells;
}

/**
 * Where the strip scrolls so the current cell sits in its middle - clamped to
 * the strip's own range, so the first and last weeks never over-scroll.
 */
export function centerScrollLeft({ cellLeft, cellWidth, stripWidth, scrollWidth }) {
  const want = cellLeft - (stripWidth - cellWidth) / 2;
  return Math.max(0, Math.min(Math.round(want), Math.max(0, scrollWidth - stripWidth)));
}

/**
 * THE ROOM'S MODEL.
 *
 * @param rows    weekBoard().rows - favorites first
 * @param picks   entryWithPicks().picks - every week of this entry
 * @param entry   the entry, or null (not in yet)
 * @param week    the open week
 * @param entriesOpen  may a reader with no entry still join?
 * @param startWeek    where the path starts: the entry's first_week (a late
 *                     entrant's path begins where they joined)
 * @param cutoffWeek   the pool's entry_until_week, named in the closed state
 */
export function roomModel({ rows = [], picks = [], entry = null, week = null, entriesOpen = true, now = new Date(), startWeek = null, cutoffWeek = null } = {}) {
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

  // THE PATH: all eighteen weeks (pathCells, above).
  const path = week != null ? pathCells({ picks, week, firstWeek: startWeek, entry }) : [];

  // THE LOCK BAR'S ONE SENTENCE.
  let bar;
  if (out) bar = { kind: 'out', week: entry.eliminated_week };
  else if (closed) bar = { kind: 'closed', week: cutoffWeek };
  else if (current && current.team_id == null) bar = { kind: 'missed' };
  else if (current && pickLocked) bar = { kind: 'locked', abbr: current.abbr };
  else if (current) bar = { kind: 'picked', abbr: current.abbr, kickoff_at: current.kickoff_at, auto: current.auto === true };
  else bar = { kind: 'none' };

  return { list, path, bar, out, pickLocked, closed, current };
}
