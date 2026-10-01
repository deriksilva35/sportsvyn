// lib/eplWeekly5/rules.js - EPL Weekly 5's rules, in one place, PURE.
//
// THE CARD AND THE SERVER ASK THE SAME FUNCTION. Every refusal a pick can hit
// is decided by refuseReason() below: the card greys a row with it and the
// save door (lib/eplWeekly5/entry.js) refuses with it, so the sentence a reader
// sees beside a MAX row and the one the server returns cannot disagree.
//
//   1. FIVE SLOTS: DEF/GK, MID, FWD, FLEX, FLEX. A FLEX takes any position.
//   2. AT MOST TWO PLAYERS FROM ONE CLUB on a card.
//   3. EACH SLOT LOCKS AT ITS OWN PLAYER'S KICKOFF - the CURRENT
//      matches.kickoff_at, read at decision time. A fixture moved earlier
//      locks earlier and one moved later stays open later: unlike October's
//      frozen board (067), this game was ruled to follow the live time.
//      Before its kickoff a slot can be swapped freely.
//   4. A POSTPONED OR CANCELLED FIXTURE is not pickable, and a slot already on
//      one never seals - the reader can swap the player out.

import { posOf } from './scoring.js';
import { gameweekLabel, gameweekShort } from '../soccer/roundLabel.js';

export const GAME_KEY = 'epl_weekly_5';
export const GAME_NAME = 'EPL Weekly 5';
export const SPORT = 'epl';
export const SLOTS = Object.freeze(['defgk', 'mid', 'fwd', 'flex1', 'flex2']);
export const SLOT_LABEL = Object.freeze({ defgk: 'DEF/GK', mid: 'MID', fwd: 'FWD', flex1: 'FLEX', flex2: 'FLEX' });
const ACCEPTS = Object.freeze({
  defgk: ['GK', 'DEF'], mid: ['MID'], fwd: ['FWD'],
  flex1: ['GK', 'DEF', 'MID', 'FWD'], flex2: ['GK', 'DEF', 'MID', 'FWD'],
});
export const MAX_PER_CLUB = 2;
export const CARD_SIZE = SLOTS.length;

export const isSlot = (s) => SLOTS.includes(s);
export const slotAccepts = (slot, position) => (ACCEPTS[slot] ?? []).includes(posOf(position));

/** The round, as this game says it (thu-36): "Gameweek 6" / "GW 6". */
export const roundLabel = (week) => gameweekLabel(week);
export const roundShort = (week) => gameweekShort(week);

const NOT_PLAYED = new Set(['postponed', 'cancelled', 'not_needed']);
const get = (m, k) => m?.get?.(String(k)) ?? m?.[String(k)] ?? null;

/** Will this fixture not be played as scheduled? PURE. */
export const isOff = (statusBy, matchId) => NOT_PLAYED.has(String(get(statusBy, matchId) ?? ''));

/**
 * THE KICKOFF A LOCK TURNS ON: the live kickoff when the caller read one, the
 * board's only when it did not (a fixture missing from the live read).
 */
export function kickoffOf(boardGame, kickoffBy) {
  const live = get(kickoffBy, boardGame?.match_id);
  const t = new Date(live ?? boardGame?.kickoff_at ?? NaN).getTime();
  return Number.isFinite(t) ? t : NaN;
}

const gameOf = (board, matchId) => (board ?? []).find((g) => String(g.match_id) === String(matchId)) ?? null;

/** Which slots are sealed: a pick whose fixture has kicked off (and is on). */
export function lockedSlots(lineup = {}, board = [], now = new Date(), { kickoffBy = null, statusBy = null } = {}) {
  const t = new Date(now).getTime();
  const out = new Set();
  for (const slot of SLOTS) {
    const pick = lineup?.[slot];
    if (!pick?.playerId) continue;
    if (isOff(statusBy, pick.matchId)) continue;
    const g = gameOf(board, pick.matchId);
    const ko = g ? kickoffOf(g, kickoffBy) : NaN;
    if (Number.isFinite(ko) && ko <= t) out.add(slot);
  }
  return out;
}

/** How many on the card (other than `exceptSlot`) are from this club. PURE. */
export function clubCount(lineup = {}, clubId, exceptSlot = null) {
  return SLOTS.filter((s) => s !== exceptSlot)
    .filter((s) => lineup?.[s]?.playerId && String(lineup[s].clubId ?? '') === String(clubId)).length;
}

/**
 * EVERY REFUSAL, in one function.
 *
 * @param lineup  the card as it stands, { slot: { playerId, matchId, clubId, pos } }
 * @param slot    the slot being filled
 * @param player  { playerId, matchId, clubId, pos }
 * @param opts    { board, now, kickoffBy, statusBy }
 * @returns null, or a reason key (REASON_TEXT below says it in words)
 */
export function refuseReason(lineup, slot, player, { board = [], now = new Date(), kickoffBy = null, statusBy = null } = {}) {
  if (!isSlot(slot)) return 'bad_slot';
  if (player?.playerId == null || player?.matchId == null || player?.clubId == null) return 'bad_player';
  if (!slotAccepts(slot, player.pos)) return 'wrong_position';
  const g = gameOf(board, player.matchId);
  if (!g) return 'not_this_week';
  if (isOff(statusBy, player.matchId)) return 'not_played';
  const t = new Date(now).getTime();
  if (lockedSlots(lineup, board, now, { kickoffBy, statusBy }).has(slot)) return 'slot_locked';
  if (!(kickoffOf(g, kickoffBy) > t)) return 'game_started';
  for (const s of SLOTS) {
    if (s !== slot && String(lineup?.[s]?.playerId ?? '') === String(player.playerId)) return 'already_on_card';
  }
  if (clubCount(lineup, player.clubId, slot) >= MAX_PER_CLUB) return 'max_from_club';
  return null;
}

/** Clearing a slot: only before its own lock. */
export function clearRefusal(lineup, slot, opts = {}) {
  if (!isSlot(slot)) return 'bad_slot';
  if (lockedSlots(lineup, opts.board ?? [], opts.now ?? new Date(), opts).has(slot)) return 'slot_locked';
  return null;
}

export const REASON_TEXT = Object.freeze({
  signed_out: 'Sign in to play.',
  bad_slot: 'That slot does not exist.',
  bad_player: 'That player could not be found.',
  wrong_position: 'That slot takes a different position.',
  not_this_week: 'That player has no fixture this gameweek.',
  not_played: 'That fixture will not be played as scheduled.',
  slot_locked: 'That slot locked at its kickoff.',
  game_started: 'That fixture has kicked off.',
  already_on_card: 'That player is already in your five.',
  max_from_club: `At most ${MAX_PER_CLUB} players from one club.`,
  settled: 'This gameweek is already graded.',
  not_open: 'This gameweek has not opened yet.',
  no_contest: 'There is no gameweek open.',
  unreachable: 'That pick did not reach the server. Tap it again.',
});

/** Pips and counts for the dock and the lock bar. */
export function cardProgress(lineup = {}, board = [], now = new Date(), opts = {}) {
  const locked = lockedSlots(lineup, board, now, opts);
  const pips = SLOTS.map((s) => (locked.has(s) ? 'locked' : lineup?.[s]?.playerId ? 'picked' : 'open'));
  return {
    pips,
    filled: pips.filter((p) => p !== 'open').length,
    locked: locked.size,
    picked: pips.filter((p) => p === 'picked').length,
    open: pips.filter((p) => p === 'open').length,
    total: CARD_SIZE,
  };
}

/** The next kickoff still ahead among fixtures that will be played. */
export function nextLock(board = [], now = new Date(), { kickoffBy = null, statusBy = null } = {}) {
  const t = new Date(now).getTime();
  return (board ?? [])
    .filter((g) => !isOff(statusBy, g.match_id))
    .map((g) => ({ ...g, ms: kickoffOf(g, kickoffBy) }))
    .filter((g) => Number.isFinite(g.ms) && g.ms > t)
    .sort((a, b) => a.ms - b.ms)[0] ?? null;
}
