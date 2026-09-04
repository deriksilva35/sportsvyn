// lib/daily/seasonBoardPlay.js — the season-roster board's PLAY state
// machine. PURE: no DOM, no clock, no network. This is deliberately NOT
// lib/daily/play.js - that file is the EXISTING week-guessing Daily's own
// rules (SLOTS = 6, drop-the-worst scoring, a season/week guess bonus), a
// different game this module does not touch, extend, or share a name with.
// This one is the twelve-team, eight-slot roster board (Step 2/3).
//
// COMMIT-ON-OPEN, NO CLOSE (ruling). This module has no "cancel" or "undo"
// operation anywhere in its surface - once a team is opened there is no
// state this file can return you to that doesn't have a player picked from
// it. The UI layer enforces the same rule by never wiring a dismiss handler
// to the team sheet; this file enforces it by never exposing one to wire.

import { eligibleForSlot, SLOTS as DEFAULT_SLOTS } from './boardShape.js';

/**
 * A fresh play state for one drawn board.
 * @param teams [{key, card:[{position, points, ...}]}] - see boardGenerator.js
 */
export function initBoardPlay(teams, slots = DEFAULT_SLOTS) {
  return {
    slots: slots.slice(),
    teams,
    roster: slots.map((pos) => ({ pos, pick: null })),
    used: new Set(),
  };
}

/** Open roster slot INDEXES a player at `position` could still fill. */
export function legalSlotIndexes(state, position) {
  const out = [];
  state.roster.forEach((r, i) => {
    if (r.pick) return;
    if (eligibleForSlot(position, r.pos)) out.push(i);
  });
  return out;
}

/**
 * Is `team` DEAD - already used, or none of its card's players can fill
 * anything still open? A dead team must render as unopenable on the chip
 * row, not as a chip that opens onto an empty sheet.
 */
export function teamIsDead(state, team) {
  if (state.used.has(team.key)) return true;
  return !team.card.some((p) => legalSlotIndexes(state, p.position).length > 0);
}

export function isRosterComplete(state) {
  return state.roster.every((r) => r.pick != null);
}

export function filledCount(state) {
  return state.roster.filter((r) => r.pick != null).length;
}

export function teamsLeft(state) {
  return state.teams.filter((t) => !teamIsDead(state, t)).length;
}

/**
 * The choice a picked player forces. PURE, and this is the ONLY function
 * that decides whether a slot-choice prompt is needed - the UI must not
 * re-derive this on its own, or the "auto-commit when only one slot fits"
 * rule and the prompt could disagree.
 *
 * @returns { ok:false } for a player with nowhere left to go (should be
 *   unreachable from a UI that greys out NO SLOT rows the same way the
 *   mock does), { ok:true, auto:true, slotIndex } when exactly one slot
 *   fits, or { ok:true, auto:false, slotIndexes } when the player must
 *   choose among more than one.
 */
export function pickOutcome(state, player) {
  const slotIndexes = legalSlotIndexes(state, player.position);
  if (!slotIndexes.length) return { ok: false };
  if (slotIndexes.length === 1) return { ok: true, auto: true, slotIndex: slotIndexes[0] };
  return { ok: true, auto: false, slotIndexes };
}

/**
 * Commit `player` (from `team`) into `slotIndex`. Returns a NEW state -
 * never mutates the one passed in, so a caller holding a reference to the
 * pre-commit state (e.g. for an undo the product does not offer) cannot
 * accidentally see it change out from under them.
 */
export function commitPick(state, team, player, slotIndex) {
  const roster = state.roster.map((r, i) => (i === slotIndex ? { ...r, pick: { player, teamKey: team.key } } : r));
  const used = new Set(state.used);
  used.add(team.key);
  return { ...state, roster, used };
}
