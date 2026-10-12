// lib/draft/roomLook.js - the weekly Draft room in THE DRAFT LOOK (sun-3), PURE.
//
// The words and shapes components/draft/RankedRoom.js renders, here so they can
// be tested without a browser: the header's eyebrow and title, the 12-seat strip
// (each seat's last pick), a pool row's sub-line, the Players filter, and the My
// team view (8 slots, the missing positions, your next pick).

import { buildRoster, BENCH } from '../fantasy/roster.js';
import { nextUserOverall } from '../fantasy/tracker.js';
import { surname } from '../fantasy/board.js';
import { matchupFor, oppLabel } from './matchup.js';

export const POSITION_CHIPS = Object.freeze(['ALL', 'QB', 'RB', 'WR', 'TE']);
const DEDICATED = Object.freeze(['QB', 'RB', 'WR', 'TE']);

/** "THE DRAFT · NFL WEEK 6 · BEST 6 OF 8 COUNT" */
export function rankedEyebrow(week, { rounds = 8, counting = 6 } = {}) {
  const w = week == null ? '' : ` · NFL WEEK ${week}`;
  return `THE DRAFT${w} · BEST ${counting} OF ${rounds} COUNT`;
}

/** "Round 2 of 8 · your pick" / "Round 2 of 8 · on deck" / "Draft complete". */
export function rankedTitle({ currentOverall, teams, rounds, yourTurn, complete = false }) {
  if (complete || currentOverall == null) return 'Draft complete';
  const round = Math.ceil(currentOverall / teams);
  return `Round ${round} of ${rounds} · ${yourTurn ? 'your pick' : 'on deck'}`;
}

/**
 * The 12 tiles: You (lime) and every other seat with its LAST pick's surname.
 * [{ key, label, sub, you, onClock }]
 */
export function seatStripSeats({ teams, order, picks, userTeamIndex, currentOverall, labels = null }) {
  const last = new Map();
  for (const p of [...(picks ?? [])].sort((a, b) => a.overallPick - b.overallPick)) {
    last.set(order[p.overallPick - 1], p);
  }
  const onClock = currentOverall == null ? null : order[currentOverall - 1];
  return Array.from({ length: teams }, (_, i) => {
    const p = last.get(i);
    const you = i === userTeamIndex;
    return {
      key: i + 1,
      label: you ? 'You' : (labels?.[i] || `Seat ${i + 1}`),
      sub: p ? `${p.slotPos ?? p.position} ${surname(p.playerName ?? '')}` : '-',
      you,
      onClock: i === onClock,
    };
  });
}

/** "KC vs BUF · ADP 3 · proj 21.4" - the parts that exist, in that order. */
export function poolSub(p, matchups = null) {
  const opp = oppLabel(matchupFor(matchups, p.team));
  const head = [p.team, opp].filter(Boolean).join(' ');
  const adp = Number.isFinite(Number(p.adp)) && p.adp != null ? `ADP ${Math.round(Number(p.adp))}` : null;
  const proj = p.ppg != null && Number.isFinite(Number(p.ppg)) ? `proj ${Number(p.ppg).toFixed(1)}` : null;
  return [head || null, adp, proj].filter(Boolean).join(' · ');
}

/** The Players tab: position chip + search (name or team, case-free), ADP order kept. */
export function filterPool(available, { pos = 'ALL', q = '' } = {}) {
  const needle = String(q ?? '').trim().toLowerCase();
  return (available ?? []).filter((p) => (pos === 'ALL' || p.position === pos)
    && (!needle || String(p.name ?? '').toLowerCase().includes(needle) || String(p.team ?? '').toLowerCase() === needle));
}

/**
 * The My team tab. `projOf(pick)` returns a pick's projection (or null).
 * { count, of, projTotal, slots: [{ key, label, pick, emptyRound }], missing: [pos], nextPick }
 * An empty slot names the round of the pick that will fill it: your remaining
 * picks, in order, against the empty slots, in order.
 */
export function myTeamView({ userPicks, rosterSlots, order, userTeamIndex, currentOverall, teams, projOf = () => null }) {
  const slots = buildRoster(userPicks ?? [], rosterSlots).filter((s) => s.key !== BENCH || s.pick);
  const of = Object.values(rosterSlots).reduce((a, b) => a + b, 0);
  const future = [];
  for (let i = (currentOverall ?? order.length + 1) - 1; i < order.length; i += 1) {
    if (order[i] === userTeamIndex) future.push(Math.floor(i / teams) + 1);
  }
  let f = 0;
  const out = slots.map((s) => ({ key: s.key, label: s.label, pick: s.pick ?? null, emptyRound: s.pick ? null : (future[f++] ?? null) }));
  const missing = DEDICATED.filter((pos) => out.some((s) => s.key === pos && !s.pick));
  const projTotal = Math.round((userPicks ?? []).reduce((a, p) => a + (Number(projOf(p)) || 0), 0) * 10) / 10;
  return {
    count: (userPicks ?? []).length,
    of,
    projTotal,
    slots: out,
    missing,
    nextPick: currentOverall == null ? null : nextUserOverall(order, userTeamIndex, currentOverall - 1),
  };
}

/** "Still need a QB and a TE." / "Every position is covered." */
export function missingLine(missing) {
  if (!missing?.length) return 'Every position is covered.';
  const a = missing.map((p) => `a ${p}`);
  return `Still need ${a.length === 1 ? a[0] : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`}.`;
}
