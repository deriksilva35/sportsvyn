// lib/eplWeekly5/rules.js - EPL Weekly 5's rules, in one place, PURE.
//
// THE CARD AND THE SERVER ASK THE SAME FUNCTION. Every refusal a pick can hit
// is decided by refuseReason() below: the card greys a row with it and the
// save door (lib/eplWeekly5/entry.js) refuses with it, so the sentence a reader
// sees beside a MAX row and the one the server returns cannot disagree.
//
//   1. FIVE SLOTS: DEF/GK, MID, FWD, FLEX, FLEX. A FLEX takes any OUTFIELD
//      player (DEF/MID/FWD); a keeper only fills DEF/GK (thu-42).
//   2. AT MOST TWO PLAYERS FROM ONE CLUB on a card.
//   3. EACH SLOT LOCKS AT ITS OWN PLAYER'S KICKOFF - the CURRENT
//      matches.kickoff_at, read at decision time. A fixture moved earlier
//      locks earlier and one moved later stays open later: unlike October's
//      frozen board (067), this game was ruled to follow the live time.
//      Before its kickoff a slot can be swapped freely.
//   4. A POSTPONED OR CANCELLED FIXTURE is not pickable, and a slot already on
//      one never seals - the reader can swap the player out.
//   5. DOUBLE GAMEWEEKS (ruling sat-5 E2): a club with two fixtures on the
//      board scores BOTH. His slot locks at his club's FIRST fixture still to
//      be played (current kickoff), and a postponement of that one moves the
//      lock to the next. pickFixtures() / pickLockAt() below are the rule.
//   6. A FIXTURE MOVED OUT OF ITS GAMEWEEK (ruling sat-5 E1). A postponed
//      fixture the league re-dates weeks later keeps its round number in the
//      feed, so it is still on this board - but it is no longer this
//      gameweek's. When its current kickoff is more than MOVED_OUT_H after the
//      latest kickoff of the board's OTHER fixtures it is 'moved': off for
//      this gameweek exactly like a postponement (not pickable, a slot on it
//      never seals, it scores 0, the settle does not wait for it). If it is
//      re-dated into a later gameweek's window it joins THAT board - when that
//      gameweek opens, or, if it is already open, on the next cron run any
//      time before it settles (ruling sun-1; lib/eplWeekly5/create.js
//      carriedRows / appendCarried) - a double gameweek for its two clubs,
//      the FPL convention.

import { posOf } from './scoring.js';
import { instantsOf } from '../util/scoresOf.js';
import { gameweekLabel, gameweekShort } from '../soccer/roundLabel.js';

export const GAME_KEY = 'epl_weekly_5';
export const GAME_NAME = 'EPL Weekly 5';
export const SPORT = 'epl';
export const SLOTS = Object.freeze(['defgk', 'mid', 'fwd', 'flex1', 'flex2']);
export const SLOT_LABEL = Object.freeze({ defgk: 'DEF/GK', mid: 'MID', fwd: 'FWD', flex1: 'FLEX', flex2: 'FLEX' });
const ACCEPTS = Object.freeze({
  defgk: ['GK', 'DEF'], mid: ['MID'], fwd: ['FWD'],
  // FLEX IS OUTFIELD ONLY (ruling thu-42): a keeper fills DEF/GK and nothing else.
  flex1: ['DEF', 'MID', 'FWD'], flex2: ['DEF', 'MID', 'FWD'],
});
export const MAX_PER_CLUB = 2;
export const CARD_SIZE = SLOTS.length;

export const isSlot = (s) => SLOTS.includes(s);
export const slotAccepts = (slot, position) => (ACCEPTS[slot] ?? []).includes(posOf(position));

/** The round, as this game says it (thu-36): "Gameweek 6" / "GW 6". */
export const roundLabel = (week) => gameweekLabel(week);
export const roundShort = (week) => gameweekShort(week);

const NOT_PLAYED = new Set(['postponed', 'cancelled', 'not_needed', 'moved']);
export const OFF_STATUSES = Object.freeze([...NOT_PLAYED]);
const get = (m, k) => m?.get?.(String(k)) ?? m?.[String(k)] ?? null;

/** Will this fixture not be played as scheduled? PURE. */
export const isOff = (statusBy, matchId) => NOT_PLAYED.has(String(get(statusBy, matchId) ?? ''));
export const isOffStatus = (status) => NOT_PLAYED.has(String(status ?? ''));

/** Hours past the rest of the gameweek after which a re-dated fixture is no longer this gameweek's. */
export const MOVED_OUT_H = 72;

/**
 * IS THIS KICKOFF OUT OF THE GAMEWEEK? PURE. `others` are the kickoffs of the
 * gameweek's OTHER fixtures (the board snapshot's, or the round's own rows
 * when no board exists yet - create.js asks the same question). A round of
 * one fixture has nothing to be moved away from.
 */
export function movedOutOf(kickoff, others = []) {
  const [t] = instantsOf([kickoff]);
  const ends = instantsOf(others ?? []);
  if (t == null || !ends.length) return false;
  return t > Math.max(...ends) + MOVED_OUT_H * 3600e3;
}

/**
 * THE FIXTURES AS THIS GAMEWEEK SEES THEM. PURE. `rows` is Map(id -> matches
 * row) as read; a fixture moved out of the gameweek comes back with status
 * 'moved' (its own status kept as raw_status). Every reader of a board's
 * fixtures - the card, the save door, the settle - goes through this.
 */
export function effectiveFixtures(board = [], rows = new Map()) {
  const out = new Map();
  for (const g of board ?? []) {
    const k = String(g.match_id);
    const m = rows.get(k);
    if (!m) continue;
    const others = (board ?? []).filter((x) => String(x.match_id) !== k).map((x) => x.kickoff_at);
    out.set(k, movedOutOf(m.kickoff_at, others) ? { ...m, raw_status: m.status, status: 'moved' } : m);
  }
  for (const [k, m] of rows) if (!out.has(k)) out.set(k, m);
  return out;
}

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

/**
 * EVERY BOARD FIXTURE A PICK SCORES IN (ruling sat-5 E2): his club's, in board
 * order. A board without team ids (or a pick without a club) falls back to
 * the one fixture the pick names. PURE.
 */
export function pickFixtures(pick, board = []) {
  const club = pick?.clubId == null ? null : String(pick.clubId);
  const mine = club == null ? [] : (board ?? []).filter((g) => String(g.home?.id ?? '') === club || String(g.away?.id ?? '') === club);
  if (mine.length) return mine;
  const g = gameOf(board, pick?.matchId);
  return g ? [g] : [];
}

/**
 * WHEN A PICK LOCKS: the earliest CURRENT kickoff among his fixtures that will
 * be played. NaN when every one is off (the slot never seals). PURE.
 */
export function pickLockAt(pick, board = [], { kickoffBy = null, statusBy = null } = {}) {
  const ks = pickFixtures(pick, board).filter((g) => !isOff(statusBy, g.match_id))
    .map((g) => kickoffOf(g, kickoffBy)).filter(Number.isFinite);
  return ks.length ? Math.min(...ks) : NaN;
}

/** Which slots are sealed: a pick whose first fixture still on has kicked off. */
export function lockedSlots(lineup = {}, board = [], now = new Date(), { kickoffBy = null, statusBy = null } = {}) {
  const t = new Date(now).getTime();
  const out = new Set();
  for (const slot of SLOTS) {
    const pick = lineup?.[slot];
    if (!pick?.playerId) continue;
    const ko = pickLockAt(pick, board, { kickoffBy, statusBy });
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
  const fixtures = pickFixtures(player, board);
  if (!fixtures.length) return 'not_this_week';
  if (fixtures.every((g) => isOff(statusBy, g.match_id))) return 'not_played';
  const t = new Date(now).getTime();
  if (lockedSlots(lineup, board, now, { kickoffBy, statusBy }).has(slot)) return 'slot_locked';
  if (!(pickLockAt(player, board, { kickoffBy, statusBy }) > t)) return 'game_started';
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
